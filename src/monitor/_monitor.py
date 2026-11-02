#  RSS to Telegram Bot
#  Copyright (C) 2021-2024  Rongrong <i@rong.moe>
#
#  This program is free software: you can redistribute it and/or modify
#  it under the terms of the GNU Affero General Public License as
#  published by the Free Software Foundation, either version 3 of the
#  License, or (at your option) any later version.
#
#  This program is distributed in the hope that it will be useful,
#  but WITHOUT ANY WARRANTY; without even the implied warranty of
#  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#  GNU Affero General Public License for more details.
#
#  You should have received a copy of the GNU Affero General Public License
#  along with this program.  If not, see <https://www.gnu.org/licenses/>.

from __future__ import annotations
from typing import Union, Optional, Final
from collections.abc import Iterable

import enum
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from collections import defaultdict
from contextlib import asynccontextmanager
from itertools import islice, chain, repeat
from time import monotonic
from urllib.parse import urlsplit

from ._common import logger, TIMEOUT
from ._notifier import Notifier
from ._stat import MonitorStat
from .. import db, env, web, locks
from ..command import inner
from ..helpers.bg import bg
from ..helpers.singleton import Singleton
from ..helpers.timeout import BatchTimeout
from ..parsing.utils import ensure_plain
from ..management import diagnostics
from ..management import articles as article_history


def _technical_error(error):
    """Describe a transport error without URLs, request data or response bodies."""
    if error is None:
        return ''
    parts = [type(error).__name__]
    errno = getattr(getattr(error, 'os_error', error), 'errno', None)
    if isinstance(errno, int):
        parts.append(f'errno={errno}')
    return '; '.join(parts)


def _mark_diagnosed(error, feed_id):
    try:
        error._rsstt_diagnostic_feed = feed_id
    except Exception:
        pass


def _fetch_failure(wf):
    error = getattr(wf, 'error', None)
    name = getattr(error, 'error_name', '')
    known = {'status code error', 'network error', 'feed invalid', 'URL invalid', 'internal error'}
    detail = name if name in known else 'fetch failed'
    base = getattr(error, 'base_error', None)
    context = {'stage': 'parse' if name == 'feed invalid' else 'request'}
    if base is not None:
        detail += '; ' + _technical_error(base)
        context['exception_type'] = type(base).__name__
    parse = getattr(wf, 'parse_diagnostic', None)
    if isinstance(parse, dict) and name == 'feed invalid':
        if isinstance(parse.get('exception_type'), str):
            context['exception_type'] = parse['exception_type']
            detail += '; ' + parse['exception_type']
        for key in ('line', 'column'):
            if isinstance(parse.get(key), int):
                detail += f'; {key}={parse[key]}'
    return detail, context


class TaskState(enum.IntFlag):
    EMPTY = 0
    LOCKED = 1 << 0
    IN_PROGRESS = 1 << 1
    DEFERRED = 1 << 2


FEED_OR_ID = Union[int, db.Feed]


class Monitor(Singleton):
    def __init__(self):
        self._stat: Final[MonitorStat] = MonitorStat()
        self._bg_task: Optional[asyncio.Task] = None
        # Synchronous operations are atomic from the perspective of asynchronous coroutines, so we can just use a map
        # plus additional prologue & epilogue to simulate an asynchronous lock.
        # In the meantime, the deferring logic is implemented using this map.
        self._subtask_defer_map: Final[defaultdict[int, TaskState]] = defaultdict(lambda: TaskState.EMPTY)
        self._lock_up_period: int = 0  # in seconds
        self._manual_feeds: set[int] = set()
        self._manual_pending: set[int] = set()
        self._manual_no_resubmit: set[int] = set()

        # update _lock_up_period on demand
        db.effective_utils.EffectiveOptions.add_set_callback('minimal_interval', self._update_lock_up_period_cb)

    def _update_lock_up_period_cb(self, key: str, value: int, expected_key: str = 'minimal_interval'):
        if key != expected_key:
            raise KeyError(f'Invalid key: {key}, expected: {expected_key}')
        if not isinstance(value, int):
            raise TypeError(f'Invalid type of value: {type(value)}, expected: int')
        if value <= 1:
            # The minimal scheduling interval is 1 minute, it is meaningless to lock.
            self._lock_up_period = 0  # which means locks are disabled
            return
        # Convert minutes to seconds, then subtract 10 seconds to prevent locks from being released too late
        # (i.e., released only after causing a new subtask being deferred).
        self._lock_up_period = value * 60 - 10

    async def _ensure_db_feeds(self, feeds: Iterable[FEED_OR_ID]) -> Optional[set[db.Feed]]:
        if not feeds:
            return None

        db_feeds: set[db.Feed] = set()
        feed_ids: set[int] = set()
        for feed in feeds:
            if isinstance(feed, db.Feed):
                if not self._defer_feed_id(feed.id, feed.link):
                    db_feeds.add(feed)
            else:
                feed_id = feed
                if not self._defer_feed_id(feed_id):
                    feed_ids.add(feed_id)
        if feed_ids:
            db_feeds_to_merge = await db.Feed.filter(id__in=feed_ids)
            db_feeds.update(db_feeds_to_merge)
            if len(db_feeds_to_merge) != len(feed_ids):
                feed_ids_not_found = feed_ids - {feed.id for feed in db_feeds_to_merge}
                logger.error(f'Feeds {feed_ids_not_found} not found, but they were submitted to the monitor queue.')

        return db_feeds

    def _on_subtask_canceled(self, err: BaseException, feed: db.Feed, *_):
        self._stat.cancelled()
        logger.error(f'Monitoring subtask failed due to CancelledError: {feed.id}: {feed.link}', exc_info=err)

    def _on_subtask_unknown_error(self, err: BaseException, feed: db.Feed, *_):
        self._stat.unknown_error()
        if getattr(err, '_rsstt_diagnostic_feed', None) != feed.id:
            diagnostics.emit('fetch', 'error', 'fetch.exception', '抓取任务发生异常，未完成本次检查。',
                             feed_id=feed.id, detail=_technical_error(err),
                             context={'exception_type': type(err).__name__, 'stage': 'process'})
        logger.error(f'Monitoring subtask failed due to an unknown error: {feed.id}: {feed.link}', exc_info=err)

    def _on_subtask_timeout(self, err: BaseException, feed: db.Feed, *_):
        self._stat.timeout()
        diagnostics.emit('fetch', 'error', 'fetch.timeout', '抓取任务超时，未完成本次检查。',
                         feed_id=feed.id, context={'duration_ms': TIMEOUT * 1000, 'stage': 'process'})
        logger.error(f'Monitoring subtask timed out after {TIMEOUT}s: {feed.id}: {feed.link}', exc_info=err)

    def _on_subtask_timeout_unknown_error(self, err: BaseException, feed: db.Feed, *_):
        self._stat.timeout_unknown_error()
        diagnostics.emit('fetch', 'error', 'fetch.timeout', '抓取任务超时，未完成本次检查。',
                         feed_id=feed.id, detail=_technical_error(err),
                         context={'exception_type': type(err).__name__, 'duration_ms': TIMEOUT * 1000,
                                  'stage': 'process'})
        logger.error(
            f'Monitoring subtask timed out after {TIMEOUT}s and caused an unknown error: {feed.id}: {feed.link}',
            exc_info=err
        )

    async def _do_monitor_subtask(self, feed: db.Feed, now: datetime):
        if feed.id in getattr(self, '_manual_feeds', ()):
            self._manual_pending.add(feed.id)
            self._stat.skipped()
            return
        self._subtask_defer_map[feed.id] |= TaskState.IN_PROGRESS
        self._stat.start()
        try:
            await self._do_monitor_a_feed(feed, now)
        finally:
            self._erase_state_for_feed_id(feed.id, TaskState.IN_PROGRESS)
            self._stat.finish()

    # In the foreseeable future, we may limit the number of concurrent monitoring tasks and use
    # helpers.queue.QueuedDecorator(PriorityQueue) to prioritize some jobs.
    # Since the execution of monitoring tasks is completely unlimited now, we can use the simpler `bg` decorator to
    # avoid the extra overhead of `queued`.
    @bg
    async def _do_monitor_task(self, feeds: Iterable[FEED_OR_ID], description: str):
        # Previously, this was a tail call (self._ensure_db_feeds() calls self._do_monitor_task() at the end).
        # It turned out that the tail call made the frame of self._ensure_db_feeds(), which keep referencing all db.Feed
        # objects produced there, persisted until self._do_monitor_task() was done.
        # The garbage collector was unable to collect any db.Feed objects in such a circumstance.
        # So it is now a head call to solve this issue.
        feeds: set[db.Feed] = await self._ensure_db_feeds(feeds)
        if not feeds:
            return

        feed_count = len(feeds)
        handle_id = id(feeds)
        logger.debug(f'Start monitoring {feed_count} feeds (handle: {handle_id}): {description}')

        now = datetime.now(timezone.utc)
        _do_monitor_subtask: BatchTimeout[[db.Feed, datetime], None]
        async with BatchTimeout[[db.Feed], None](
                func=self._do_monitor_subtask,
                timeout=TIMEOUT,
                loop=env.loop,
                on_canceled=self._on_subtask_canceled,
                on_error=self._on_subtask_unknown_error,
                on_timeout=self._on_subtask_timeout,
                on_timeout_error=self._on_subtask_timeout_unknown_error,
        ) as _do_monitor_subtask:
            for feed in feeds:
                self._lock_feed_id(feed.id)
                _do_monitor_subtask(feed, now, _task_name_suffix=feed.id)
            # It could take a long time waiting for all subtasks to finish or time out.
            # Release unnecessary references to heavy objects so that they can be garbage collected ASAP.
            del feed, feeds, now

        logger.debug(f'Finished monitoring {feed_count} feeds (handle: {handle_id}): {description}')

    _do_monitor_task_bg_sync = _do_monitor_task.bg_sync

    def _lock_feed_id(self, feed_id: int):
        if not self._lock_up_period:  # lock disabled
            return
        # Caller MUST ensure that self._subtask_defer_map[feed_id] can be overwritten safely.
        self._subtask_defer_map[feed_id] = TaskState.LOCKED
        # unlock after the lock-up period
        env.loop.call_later(
            self._lock_up_period,
            self._erase_state_for_feed_id,
            feed_id, TaskState.LOCKED
        )

    def _erase_state_for_feed_id(self, feed_id: int, flag_to_erase: TaskState):
        task_state = self._subtask_defer_map.get(feed_id, TaskState.EMPTY)
        if not task_state:
            logger.warning(f'Unexpected empty state ({repr(task_state)}): {feed_id}')
            return
        erased_state = task_state & ~flag_to_erase
        if erased_state == TaskState.DEFERRED:  # deferred with any other flag erased, resubmit it
            self._subtask_defer_map.pop(feed_id, None)
            self.submit_feed(feed_id, 'resubmit deferred subtask')
            self._stat.resubmitted()
            logger.debug(f'Resubmitted a deferred subtask ({repr(task_state)}): {feed_id}')
            return
        if erased_state:
            self._subtask_defer_map[feed_id] = erased_state
        else:
            # Completed/deleted feeds need no permanent EMPTY entry. Keep active
            # and deferred states until all flags clear, preserving resubmission.
            self._subtask_defer_map.pop(feed_id, None)

    def _defer_feed_id(self, feed_id: int, feed_link: str = None) -> bool:
        if feed_id in getattr(self, '_manual_feeds', ()):
            self._manual_pending.add(feed_id)
            self._stat.deferred()
            return True
        feed_description = f'{feed_id}: {feed_link}' if feed_link else str(feed_id)
        task_state = self._subtask_defer_map.get(feed_id, TaskState.EMPTY)
        if task_state == TaskState.DEFERRED:
            # This should not happen, but just in case.
            logger.warning(f'A deferred subtask ({repr(task_state)}) was never resubmitted: {feed_description}')
            # fall through
        elif task_state:  # defer if any other flag is set
            # Set the DEFERRED flag, this can be done for multiple times safely.
            self._subtask_defer_map[feed_id] = task_state | TaskState.DEFERRED
            self._stat.deferred()
            logger.debug(f'Deferred ({repr(task_state)}): {feed_description}')
            return True  # deferred, later operations should be skipped
        return False  # not deferred

    def submit_feeds(self, feeds: Iterable[FEED_OR_ID], description: str = ''):
        self._do_monitor_task_bg_sync(feeds, description)

    def submit_feed(self, feed: FEED_OR_ID, description: str = ''):
        self.submit_feeds((feed,), description)

    def manual_busy(self, feed_id):
        return feed_id in self._manual_feeds or bool(
            self._subtask_defer_map.get(feed_id, TaskState.EMPTY) & TaskState.IN_PROGRESS)

    def stop_manual_resubmission(self, feed_ids):
        """Do not revive scheduled work while its owning Web app is closing."""
        self._manual_no_resubmit.update(set(feed_ids) & self._manual_feeds)

    @asynccontextmanager
    async def manual_slot(self, feed_id):
        """Exclude scheduled work while a bounded manual operation owns a feed.

        A completed cooldown may be bypassed, while an actual in-flight request
        must finish first. Scheduled callbacks already queued before this claim
        also check the set in _do_monitor_subtask.
        """
        from ..management.service import Problem
        if self.manual_busy(feed_id):
            raise Problem('这个订阅源正在抓取，请等待当前任务完成后重试。', 409, code='MANUAL_FETCH_BUSY')
        self._manual_feeds.add(feed_id)
        try:
            yield
        finally:
            self._manual_feeds.discard(feed_id)
            pending = feed_id in self._manual_pending
            self._manual_pending.discard(feed_id)
            stopping = feed_id in self._manual_no_resubmit
            self._manual_no_resubmit.discard(feed_id)
            if pending and not stopping:
                self.submit_feed(feed_id, 'resubmit scheduled check after manual task')

    async def run_periodic_task(self):
        self._stat.print_summary()
        Notifier.on_periodic_task()
        feed_ids_set = db.effective_utils.EffectiveTasks.get_tasks()
        if not feed_ids_set:
            return

        # Assuming the method is called once per minute, let's divide feed_ids into 60 chunks and submit one by one
        # every second.
        feed_ids: list[int] = list(feed_ids_set)
        feed_count = len(feed_ids)
        chunk_count = 60
        larger_chunk_count = feed_count % chunk_count
        smaller_chunk_size = feed_count // chunk_count
        smaller_chunk_count = chunk_count - larger_chunk_count
        larger_chunk_size = smaller_chunk_size + 1
        pos = 0
        for delay, count in enumerate(chain(
                repeat(larger_chunk_size, larger_chunk_count),
                repeat(smaller_chunk_size, smaller_chunk_count)
        )):
            if count == 0:
                break
            env.loop.call_later(delay, self.submit_feeds, feed_ids[pos:pos + count], 'periodic task')
            pos += count
        assert pos == feed_count

    async def _do_monitor_a_feed(self, feed: db.Feed, now: datetime, *, force=False,
                               subscription_provider=None, result=None, request_headers=None,
                               article_journal=None, article_source='scheduled', resolve_subscription=None):
        """
        Monitor the update of a feed.

        :param feed: Feed object to be monitored
        :param now: A datetime object representing the current time
        :return: None
        """
        stat = self._stat
        if not force and feed.next_check_time and now < feed.next_check_time:
            stat.skipped()
            return  # skip this monitor task

        subs = await subscription_provider(feed.id) if subscription_provider else await feed.subs.filter(state=1)
        if result is not None:
            result.update(outcome='skipped', new_entries=0, push_status='not_started', affected_recipients=len(subs))
        if not subs:  # nobody has subbed it
            logger.warning(f'Feed {feed.id} ({feed.link}) has no active subscribers.')
            await inner.utils.update_interval(feed)
            stat.skipped()
            return

        if all(locks.user_flood_lock(sub.user_id).locked() for sub in subs):
            if result is not None:
                result['outcome'] = 'rate_limited'
            stat.skipped()
            return  # all subscribers are experiencing flood wait, skip this monitor task

        headers = {} if force else {
            'If-Modified-Since': format_datetime(feed.last_modified or feed.updated_at)
        }
        if feed.etag and not force:
            headers['If-None-Match'] = feed.etag

        from ..management import feed_options
        headers.update(request_headers if request_headers is not None else await feed_options.headers(feed.link))
        started = monotonic()
        try:
            wf = await web.feed_get(feed.link, headers=headers, verbose=False)
        except Exception as error:
            await diagnostics.record('fetch', 'error', 'fetch.exception', '抓取任务发生异常，未完成本次检查。',
                                     feed_id=feed.id, detail=_technical_error(error),
                                     context={'exception_type': type(error).__name__, 'stage': 'request',
                                              'duration_ms': round((monotonic() - started) * 1000)})
            # BatchTimeout also observes the exception; it must not record it twice.
            _mark_diagnosed(error, feed.id)
            raise
        duration_ms = round((monotonic() - started) * 1000)
        rss_d = wf.rss_d

        previous_errors = feed.error_count
        diagnostic_id = feed.id
        diagnostic_context = {'duration_ms': duration_ms, 'stage': 'request'}
        if isinstance(wf.status, int) and 100 <= wf.status <= 599:
            diagnostic_context['http_status'] = wf.status
        try:
            diagnostic_context['source_host'] = urlsplit(feed.link).hostname
        except ValueError:
            pass
        outcome, outcome_message, outcome_level = 'fetch.unchanged', '抓取成功，没有新文章。', 'info'
        outcome_detail = ''
        new_error_count = 0
        new_next_check_time: Optional[datetime] = None  # clear next_check_time by default
        feed_updated_fields: set[str] = set()
        journal = article_journal if article_journal is not None else article_history.current()
        article_keys = set()
        try:
            if wf.status == 304:  # cached
                outcome, outcome_message = 'fetch.not_modified', '订阅源未发生变化，使用缓存。'
                diagnostic_context['status'] = 'cached'
                logger.debug(f'Fetched (not updated, cached): {feed.link}')
                stat.cached()
                return

            if rss_d is None:  # error occurred
                outcome, outcome_message, outcome_level = 'fetch.failed', '订阅源抓取失败。', 'error'
                outcome_detail, failure_context = _fetch_failure(wf)
                diagnostic_context.update(failure_context, status='failed')
                from ..management.metrics import record
                await record(failed=1)
                new_error_count = feed.error_count + 1
                if new_error_count >= 100:
                    outcome, outcome_message = 'fetch.deactivation_requested', '连续抓取失败达到上限，已触发停用处理。'
                    diagnostic_context['status'] = 'pending'
                    logger.error(
                        f'Deactivated due to too many ({new_error_count}) errors (current: {wf.error}): {feed.link}'
                    )
                    await Notifier(feed=feed, subs=subs, reason=wf.error).notify_all()
                    stat.failed()
                    return
                if new_error_count >= 10:  # too much error, defer next check
                    interval = feed.interval or db.EffectiveOptions.default_interval
                    # Equals: interval * (2 ** exp), clamp to 1 day
                    next_check_delay = min(interval << (new_error_count // 10), 1440)
                    new_next_check_time = now + timedelta(minutes=next_check_delay)
                logger.log(
                    logging.WARNING
                    if new_error_count % 20 == 0
                    else logging.DEBUG,
                    f'Fetch failed ({new_error_count}th retry, {wf.error}): {feed.link}',
                )
                stat.failed()
                return

            wr = wf.web_response
            assert wr is not None
            wr.now = now

            # Update even when etag is None, allowing clearing etag when the server no longer sends it.
            if (etag := wr.etag) != feed.etag:
                feed.etag = etag
                feed_updated_fields.add('etag')

            new_next_check_time = wf.calc_next_check_as_per_server_side_cache()

            if not rss_d.entries:  # empty
                outcome, outcome_message = 'fetch.empty', '抓取成功，订阅源暂时没有文章。'
                diagnostic_context['status'] = 'empty'
                logger.debug(f'Fetched (not updated, empty): {feed.link}')
                stat.empty()
                return

            title = rss_d.feed.title
            title = await ensure_plain(title) if title else ''
            if title != feed.title:
                logger.debug(f'Feed title changed ({feed.title} -> {title}): {feed.link}')
                feed.title = title
                feed_updated_fields.add('title')

            new_hashes, updated_entries = inner.utils.calculate_update(feed.entry_hashes, rss_d.entries)
            updated_entries = list(updated_entries)

            if not updated_entries:  # not updated
                diagnostic_context['status'] = 'unchanged'
                logger.debug(f'Fetched (not updated): {feed.link}')
                stat.not_updated()
                return

            logger.debug(f'Updated: {feed.link}')
            outcome, outcome_message = 'fetch.updated', '抓取成功，发现新文章。'
            diagnostic_context.update(status='updated', new_entries=len(updated_entries))
            feed.last_modified = wr.last_modified
            feed.entry_hashes = list(islice(new_hashes, max(len(rss_d.entries) * 2, 100))) or None
            feed_updated_fields.update({'last_modified', 'entry_hashes'})
        except asyncio.CancelledError:
            outcome = None
            raise
        except Exception as error:
            outcome, outcome_message, outcome_level = 'fetch.exception', '抓取任务发生异常，未完成本次检查。', 'error'
            outcome_detail = _technical_error(error)
            diagnostic_context.update(stage='process', status='failed', exception_type=type(error).__name__)
            _mark_diagnosed(error, diagnostic_id)
            raise
        finally:
            if outcome and outcome != 'fetch.exception':
                diagnostic_context['failures'] = new_error_count
            if new_next_check_time:
                diagnostic_context['next_retry_at' if new_error_count else 'next_check_at'] = new_next_check_time.isoformat()
            if outcome:
                # Preserve the source ID independently of later URL migration.
                await diagnostics.record('fetch', outcome_level, outcome, outcome_message,
                                         feed_id=diagnostic_id, detail=outcome_detail, context=diagnostic_context)
                if result is not None:
                    result.update(outcome=outcome.removeprefix('fetch.'),
                                  new_entries=diagnostic_context.get('new_entries', 0),
                                  http_status=diagnostic_context.get('http_status'),
                                  failures=diagnostic_context.get('failures'))
            if feed.error_count != new_error_count:
                feed.error_count = new_error_count
                feed_updated_fields.add('error_count')

            if feed.next_check_time != new_next_check_time:
                feed.next_check_time = new_next_check_time
                feed_updated_fields.add('next_check_time')

            try:
                if new_error_count == 0 and wf.url != feed.link:
                    new_url_feed = await inner.sub.migrate_to_new_url(feed, wf.url)
                    if isinstance(new_url_feed, db.Feed):
                        feed = new_url_feed
                        # Update has been done during the migration, skip it.
                        feed_updated_fields.clear()

                if feed_updated_fields:
                    await feed.save(update_fields=feed_updated_fields)
                from ..management.notifications import fetch_result
                await fetch_result(feed.id, new_error_count)
            except Exception as error:
                await diagnostics.record('fetch', 'error', 'fetch.state_save_failed', '抓取结果已返回，但订阅状态保存失败。',
                                         feed_id=diagnostic_id, detail=_technical_error(error),
                                         context={'stage': 'persist', 'status': 'failed',
                                                  'exception_type': type(error).__name__})
                _mark_diagnosed(error, diagnostic_id)
                raise
            finally:
                if journal and rss_d is not None:
                    # URL migration can replace the Feed object. Store the
                    # observed items under the same final ID used for delivery,
                    # including successful checks with no new entries.
                    await journal.capture(feed.id, rss_d.entries)
                    article_keys = {article_history.article_key(entry) for entry in islice(rss_d.entries, 20)}
            if outcome and previous_errors and not new_error_count and outcome_level == 'info':
                await diagnostics.record('fetch', 'info', 'fetch.recovered', '订阅源抓取已恢复。',
                                         feed_id=diagnostic_id,
                                         context={**diagnostic_context, 'status': 'recovered',
                                                  'previous_failures': previous_errors})

        from ..management.metrics import record
        await record(fetched=len(updated_entries))
        updated_entries.reverse()  # send the earliest entry first
        if subscription_provider:
            # Re-check service restrictions after the HTTP request, immediately
            # before queueing delivery. A web ban/pause during fetching wins.
            previous_targets = {sub.user_id for sub in subs}
            subs = await subscription_provider(feed.id)
            if journal:
                stopped_targets = previous_targets - {sub.user_id for sub in subs}
                for entry in updated_entries:
                    if article_history.article_key(entry) in article_keys:
                        for target in stopped_targets:
                            await journal.mark(feed.id, entry, target, 'failed',
                                detail='会话已被暂停、封禁或退出，未提交推送。', source=article_source)
        notifier_options = dict(article_journal=journal, article_source=article_source,
                                article_keys=article_keys) if journal or article_journal is False else {}
        if resolve_subscription is not None:
            notifier_options['resolve_subscription'] = resolve_subscription
        await Notifier(feed=feed, subs=subs, entries=updated_entries, **notifier_options).notify_all()
        if result is not None:
            result.update(push_status='submitted' if subs else 'not_started', affected_recipients=len(subs))
        stat.updated()
        return
