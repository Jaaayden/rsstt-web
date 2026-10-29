import asyncio
import importlib
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from feedparser import FeedParserDict

from src import db, env, web
from src.command import inner
from src.command.inner.users import set_user_state
from src.management import articles, manual_fetch
from src.management.service import Service
from src.monitor._monitor import Monitor
from src.monitor._notifier import Notifier
from src.parsing.message import Message
from src import locks

notifier_module = importlib.import_module('src.monitor._notifier')


@pytest.fixture(autouse=True)
def no_global_state(monkeypatch):
    monkeypatch.setattr(articles, '_active', None)
    monkeypatch.setattr(Monitor, '_singleton', None)


def entries(count=1):
    return [FeedParserDict(guid=f'article-{index}', title=f'Article {index}',
                          summary=f'<p>Article body {index}</p>', link=f'https://example.invalid/{index}')
            for index in range(count)]


def fetched(feed, items):
    return SimpleNamespace(status=200, url=feed.link, error=None,
        rss_d=FeedParserDict(feed=FeedParserDict(title='Example'), entries=items),
        web_response=SimpleNamespace(etag=None, last_modified=None),
        calc_next_check_as_per_server_side_cache=lambda: None)


def transport(monkeypatch, result):
    send = AsyncMock(side_effect=result) if callable(result) else AsyncMock(return_value=result)
    post = SimpleNamespace(send_formatted_post_according_to_sub=send, link='https://example.invalid/1',
                           feed_link='https://example.invalid/rss', title='One', feed_title='Example', author=None)
    monkeypatch.setattr(notifier_module, 'get_post_from_entry', AsyncMock(return_value=post))
    monkeypatch.setattr(env, 'bot', SimpleNamespace(get_input_entity=AsyncMock(return_value=object())))
    return post


async def test_unchanged_feed_still_captures_twenty_without_inventing_delivery(context, monkeypatch):
    items = entries(25)
    context.feed.entry_hashes = list(inner.utils.calculate_update(None, items)[0])
    await context.feed.save()
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=fetched(context.feed, items)))
    monkeypatch.setattr(articles, '_active', context.store.articles)
    notify = AsyncMock()
    monkeypatch.setattr(Notifier, 'notify_all', notify)
    await Monitor()._do_monitor_a_feed(context.feed, datetime.now(timezone.utc))
    data = await context.store.articles.history(context.feed.id, context.sub.user_id)
    assert len(data['items']) == 20
    assert [item['title'] for item in data['items']] == [f'Article {index}' for index in range(20)]
    assert all(item['status'] == 'not_recorded' for item in data['items'])
    notify.assert_not_awaited()


async def test_two_destinations_receive_independent_confirmed_results(context, monkeypatch):
    journal = context.store.articles
    item = entries()[0]
    await journal.capture(context.feed.id, [item])
    async def send(sub):
        return sub.user_id == context.sub.user_id
    transport(monkeypatch, send)
    notifier = Notifier(context.feed, [context.sub, context.other], entries=[item], article_journal=journal)
    await asyncio.gather(notifier._notify_sub_with_entry_idx(0, context.sub),
                         notifier._notify_sub_with_entry_idx(0, context.other))
    first = (await journal.history(context.feed.id, context.sub.user_id))['items'][0]
    other = (await journal.history(context.feed.id, context.other.user_id))['items'][0]
    assert first['status'] == first['last_attempt_status'] == 'sent' and first['last_sent_at']
    assert other['status'] == other['last_attempt_status'] == 'unconfirmed' and not other['last_sent_at']


@pytest.mark.parametrize('result', [False, None, 'truthy-but-not-confirmed'])
async def test_only_literal_true_is_confirmed_delivery(context, monkeypatch, result):
    item = entries()[0]
    transport(monkeypatch, result)
    notifier = Notifier(context.feed, [context.sub], entries=[item], article_journal=context.store.articles)
    await notifier._notify_sub_with_entry_idx(0, context.sub)
    data = await context.store.articles.history(context.feed.id, context.sub.user_id)
    assert data['items'][0]['status'] == 'unconfirmed'
    assert data['items'][0]['last_sent_at'] is None


async def test_parse_failure_updates_every_waiting_destination(context, monkeypatch):
    item = entries()[0]
    monkeypatch.setattr(notifier_module, 'get_post_from_entry', AsyncMock(side_effect=ValueError('private body')))
    error_notice = SimpleNamespace(send_formatted_post=AsyncMock())
    monkeypatch.setattr(notifier_module, 'Post', lambda *args, **kwargs: error_notice)
    notifier = Notifier(context.feed, [context.sub, context.other], entries=[item], article_journal=context.store.articles)
    await asyncio.gather(notifier._notify_sub_with_entry_idx(0, context.sub),
                         notifier._notify_sub_with_entry_idx(0, context.other))
    for sub in (context.sub, context.other):
        item = (await context.store.articles.history(context.feed.id, sub.user_id))['items'][0]
        assert item['status'] == 'failed' and item['last_attempt_status'] == 'failed'
        assert '解析失败' in item['detail'] and 'private body' not in item['detail']
    error_notice.send_formatted_post.assert_awaited_once()


async def test_blocked_retry_and_refetch_never_erase_sent_evidence(context, monkeypatch):
    item = entries()[0]
    transport(monkeypatch, True)
    notifier = Notifier(context.feed, [context.sub], entries=[item], article_journal=context.store.articles)
    await notifier._notify_sub_with_entry_idx(0, context.sub)
    original = (await context.store.articles.history(context.feed.id, context.sub.user_id))['items'][0]
    monkeypatch.setattr(env, 'bot', SimpleNamespace(get_input_entity=AsyncMock(side_effect=ValueError)))
    notifier._on_blocked = AsyncMock()
    await notifier._notify_sub_with_entry_idx(0, context.sub)
    await context.store.articles.capture(context.feed.id, [item])
    after = (await context.store.articles.history(context.feed.id, context.sub.user_id))['items'][0]
    assert after['status'] == 'sent' and after['last_attempt_status'] == 'failed'
    assert after['last_sent_at'] == original['last_sent_at']


@pytest.mark.parametrize('timeout', [False, True])
async def test_cancelled_or_timed_out_send_does_not_remain_queued(context, monkeypatch, timeout):
    started = asyncio.Event()
    async def waiting(sub):
        started.set()
        await asyncio.Event().wait()
    transport(monkeypatch, waiting)
    notifier = Notifier(context.feed, [context.sub], entries=entries(), article_journal=context.store.articles)
    task = asyncio.create_task(notifier._notify_sub_with_entry_idx(0, context.sub))
    await started.wait()
    if timeout:
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(task, .001)
    else:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    row = (await context.store.articles.history(context.feed.id, context.sub.user_id))['items'][0]
    assert row['status'] == 'unconfirmed' and row['last_attempt_status'] != 'queued'


async def test_manual_updates_capture_old_items_in_the_app_instance(context, monkeypatch):
    items = entries(25)
    context.feed.entry_hashes = list(inner.utils.calculate_update(None, items)[0])
    await context.feed.save()
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=fetched(context.feed, items)))
    manager = manual_fetch.ManualFetch(Service(context.store, context.gateway))
    job = {'mode':'updates', 'subscription_id':str(context.sub.id), 'affected_recipients':2}
    result = await manager.execute(job, {'targets':None}, Monitor())
    assert result['outcome'] == 'unchanged'
    rows = (await context.store.articles.history(context.feed.id, context.sub.user_id))['items']
    assert len(rows) == 20 and all(row['status'] == 'not_recorded' for row in rows)


async def test_test_latest_captures_all_items_but_marks_only_one_chat(context, monkeypatch):
    items = entries(25)
    context.feed.entry_hashes = ['original-dedup-baseline']
    await context.feed.save()
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=fetched(context.feed, items)))
    post = SimpleNamespace(send_formatted_post_according_to_sub=AsyncMock(return_value=True))
    monkeypatch.setattr(manual_fetch, 'get_post_from_entry', AsyncMock(return_value=post))
    manager = manual_fetch.ManualFetch(Service(context.store, context.gateway))
    await manager.test_latest(context.sub, {}, {'targets':None})
    first = (await context.store.articles.history(context.feed.id, context.sub.user_id))['items']
    other = (await context.store.articles.history(context.feed.id, context.other.user_id))['items']
    assert len(first) == 20 and first[0]['status'] == 'sent' and first[0]['source'] == 'test'
    assert all(row['status'] == 'not_recorded' for row in first[1:])
    assert all(row['status'] == 'not_recorded' for row in other)
    await context.feed.refresh_from_db()
    assert context.feed.entry_hashes == ['original-dedup-baseline']


async def test_pause_after_manual_fetch_is_explicitly_recorded_as_not_sent(context, monkeypatch):
    async def fetching(*args, **kwargs):
        await db.Sub.filter(id=context.sub.id).update(state=0)
        return fetched(context.feed, entries())
    monkeypatch.setattr(web, 'feed_get', fetching)
    post = SimpleNamespace(send_formatted_post_according_to_sub=AsyncMock(return_value=True))
    monkeypatch.setattr(manual_fetch, 'get_post_from_entry', AsyncMock(return_value=post))
    manager = manual_fetch.ManualFetch(Service(context.store, context.gateway))
    from src.management.service import Problem
    with pytest.raises(Problem):
        await manager.test_latest(context.sub, {}, {'targets':None})
    row = (await context.store.articles.history(context.feed.id, context.sub.user_id))['items'][0]
    assert row['status'] == 'failed' and '暂停' in row['detail']
    post.send_formatted_post_according_to_sub.assert_not_awaited()


async def test_capture_and_delivery_share_the_migrated_feed_id(context, monkeypatch):
    items = entries()
    new_feed = await db.Feed.create(link='https://new.example.invalid/rss', title='New')
    result = fetched(context.feed, items)
    result.url = new_feed.link
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=result))
    async def migrate(*args):
        await db.Sub.filter(feed_id=context.feed.id).update(feed_id=new_feed.id)
        return new_feed
    monkeypatch.setattr(inner.sub, 'migrate_to_new_url', migrate)
    queued = []
    async def notify(self):
        queued.append(self)
    monkeypatch.setattr(Notifier, 'notify_all', notify)
    await Monitor()._do_monitor_a_feed(context.feed, datetime.now(timezone.utc),
        article_journal=context.store.articles)
    assert queued[0]._feed.id == new_feed.id
    assert (await context.store.articles.history(new_feed.id, context.sub.user_id))['items']
    assert (await context.store.articles.history(context.feed.id, context.sub.user_id))['items'] == []


async def test_stopped_pipeline_finalizes_started_item_and_leaves_later_items_unknown(context, monkeypatch):
    from src.helpers.pipeline import StopPipeline
    items = entries(2)
    await context.store.articles.capture(context.feed.id, items)
    transport(monkeypatch, True)
    monkeypatch.setattr(env, 'bot', SimpleNamespace(get_input_entity=AsyncMock(side_effect=ValueError)))
    notifier = Notifier(context.feed, [context.sub], entries=items, article_journal=context.store.articles)
    notifier._on_blocked = AsyncMock(side_effect=StopPipeline())
    await notifier._notify_sub(context.sub)
    rows = (await context.store.articles.history(context.feed.id, context.sub.user_id))['items']
    assert rows[0]['status'] == 'failed' and rows[0]['last_attempt_status'] != 'queued'
    assert rows[1]['status'] == 'not_recorded'


async def test_manual_updates_record_pause_after_http_as_not_sent(context, monkeypatch):
    async def fetching(*args, **kwargs):
        await db.Sub.filter(id=context.sub.id).update(state=0)
        return fetched(context.feed, entries())
    monkeypatch.setattr(web, 'feed_get', fetching)
    monkeypatch.setattr(Notifier, 'notify_all', AsyncMock())
    manager = manual_fetch.ManualFetch(Service(context.store, context.gateway))
    result = await manager.execute({'mode':'updates', 'subscription_id':str(context.sub.id)},
                                   {'targets':None}, Monitor())
    assert result['affected_recipients'] == 1
    row = (await context.store.articles.history(context.feed.id, context.sub.user_id))['items'][0]
    assert row['status'] == 'failed' and '未提交推送' in row['detail']


@pytest.mark.parametrize('change', ['ban', 'pause', 'delete'])
@pytest.mark.parametrize('record_history', [True, False])
async def test_manual_updates_revalidate_after_entry_parsing(context, monkeypatch, change, record_history):
    manager = manual_fetch.ManualFetch(Service(context.store, context.gateway))
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=fetched(context.feed, entries())))
    sent = []
    async def send(sub):
        sent.append(sub.user_id)
        return True
    post = transport(monkeypatch, send)
    async def parse(*args):
        if change == 'ban':
            await set_user_state(await db.User.get(id=context.sub.user_id), -1)
        elif change == 'pause':
            await manager.service.patch(context.sub, {'state':0})
        else:
            await manager.service.delete(context.sub)
        return post
    monkeypatch.setattr(notifier_module, 'get_post_from_entry', parse)
    async def immediate(self):
        await self._notify_all()
    monkeypatch.setattr(Notifier, 'notify_all', immediate)
    monitor = Monitor()
    if not record_history:
        original = monitor._do_monitor_a_feed
        async def without_history(*args, **kwargs):
            kwargs['article_journal'] = False
            return await original(*args, **kwargs)
        monkeypatch.setattr(monitor, '_do_monitor_a_feed', without_history)
    await manager.execute({'mode':'updates', 'subscription_id':str(context.sub.id)}, {'targets':None}, monitor)
    assert context.sub.user_id not in sent
    assert sent == [context.other.user_id]
    if record_history:
        row = (await context.store.articles.history(context.feed.id, context.sub.user_id))['items'][0]
        assert row['status'] == row['last_attempt_status'] == 'failed'
        assert '未发送' in row['detail']


@pytest.mark.parametrize('mode', ['updates', 'test_latest'])
@pytest.mark.parametrize('waiting_for', ['format', 'message_lock', 'flood_lock'])
async def test_manual_permission_check_runs_after_format_and_send_lock_waits(context, monkeypatch, mode, waiting_for):
    await db.Sub.filter(id=context.other.id).update(state=0)
    manager = manual_fetch.ManualFetch(Service(context.store, context.gateway))
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=fetched(context.feed, entries())))
    started, release = asyncio.Event(), asyncio.Event()
    message_lock, flood_lock = asyncio.Lock(), asyncio.Lock()
    if waiting_for == 'message_lock':
        await message_lock.acquire()
    if waiting_for == 'flood_lock':
        await flood_lock.acquire()
    monkeypatch.setattr(locks, 'user_msg_locks', lambda _: (message_lock, flood_lock))
    client_send = AsyncMock(return_value=object())
    monkeypatch.setattr(env, 'bot', SimpleNamespace(get_input_entity=AsyncMock(return_value=object()),
                                                  send_message=client_send))
    async def formatted_send(sub):
        started.set()
        if waiting_for == 'format':
            await release.wait()
        return bool(await Message(sub.user_id, plain_text='not sent').send())
    post = SimpleNamespace(send_formatted_post_according_to_sub=formatted_send,
                           link='https://example.invalid/1', feed_link=context.feed.link,
                           title='One', feed_title='Example', author=None)
    monkeypatch.setattr(notifier_module, 'get_post_from_entry', AsyncMock(return_value=post))
    monkeypatch.setattr(manual_fetch, 'get_post_from_entry', AsyncMock(return_value=post))
    async def immediate(self):
        await self._notify_all()
    monkeypatch.setattr(Notifier, 'notify_all', immediate)
    task = asyncio.create_task(manager.execute({'mode':mode, 'subscription_id':str(context.sub.id)},
                                               {'targets':None}, Monitor()))
    await started.wait()
    await set_user_state(await db.User.get(id=context.sub.user_id), -1)
    if waiting_for == 'format':
        release.set()
    elif waiting_for == 'message_lock':
        message_lock.release()
    else:
        flood_lock.release()
    if mode == 'test_latest':
        from src.management.service import Problem
        with pytest.raises(Problem) as stopped:
            await task
        assert stopped.value.code == 'MANUAL_PUSH_STOPPED'
    else:
        await task
    client_send.assert_not_awaited()
    row = (await context.store.articles.history(context.feed.id, context.sub.user_id))['items'][0]
    assert row['status'] == row['last_attempt_status'] == 'failed' and '未发送' in row['detail']


@pytest.mark.parametrize('mode', ['updates', 'test_latest'])
async def test_manual_stop_after_first_chunk_reports_possible_partial_delivery(context, monkeypatch, mode):
    await db.Sub.filter(id=context.other.id).update(state=0)
    manager = manual_fetch.ManualFetch(Service(context.store, context.gateway))
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=fetched(context.feed, entries())))
    monkeypatch.setattr(locks, 'user_msg_locks', lambda _: (asyncio.Lock(), asyncio.Lock()))
    async def client_call(*args, **kwargs):
        await manager.service.patch(context.sub, {'state':0})
        return object()
    client_send = AsyncMock(side_effect=client_call)
    monkeypatch.setattr(env, 'bot', SimpleNamespace(get_input_entity=AsyncMock(return_value=object()), send_message=client_send))
    async def multipart(sub):
        await Message(sub.user_id, plain_text='first chunk').send()
        await Message(sub.user_id, plain_text='second chunk').send()
        return True
    post = SimpleNamespace(send_formatted_post_according_to_sub=multipart,
                           link='https://example.invalid/1', feed_link=context.feed.link,
                           title='One', feed_title='Example', author=None)
    monkeypatch.setattr(notifier_module, 'get_post_from_entry', AsyncMock(return_value=post))
    monkeypatch.setattr(manual_fetch, 'get_post_from_entry', AsyncMock(return_value=post))
    async def immediate(self):
        await self._notify_all()
    monkeypatch.setattr(Notifier, 'notify_all', immediate)
    operation = manager.execute({'mode':mode, 'subscription_id':str(context.sub.id)}, {'targets':None}, Monitor())
    if mode == 'test_latest':
        from src.management.service import Problem
        with pytest.raises(Problem):
            await operation
    else:
        await operation
    assert client_send.await_count == 1
    row = (await context.store.articles.history(context.feed.id, context.sub.user_id))['items'][0]
    assert row['status'] == row['last_attempt_status'] == 'unconfirmed'
    assert '可能已有部分消息送达' in row['detail'] and not row['last_sent_at']


@pytest.mark.parametrize('finish', ['normal', 'error', 'cancel'])
async def test_scheduled_ticks_during_manual_work_are_resubmitted_once(context, monkeypatch, finish):
    monitor = Monitor()
    resubmit = Mock()
    monkeypatch.setattr(monitor, 'submit_feed', resubmit)
    try:
        async with monitor.manual_slot(context.feed.id):
            for _ in range(20):
                assert monitor._defer_feed_id(context.feed.id) is True
                await monitor._do_monitor_subtask(context.feed, datetime.now(timezone.utc))
            assert monitor._manual_pending == {context.feed.id}
            if finish == 'error':
                raise RuntimeError('failed manual test')
            if finish == 'cancel':
                raise asyncio.CancelledError()
    except (RuntimeError, asyncio.CancelledError):
        pass
    resubmit.assert_called_once_with(context.feed.id, 'resubmit scheduled check after manual task')
    assert not monitor._manual_pending and not monitor._manual_feeds


async def test_manual_shutdown_does_not_revive_deferred_scheduler_work(context, monkeypatch):
    manager = manual_fetch.ManualFetch(Service(context.store, context.gateway))
    monitor = Monitor.get_instance()
    resubmit = Mock()
    monkeypatch.setattr(monitor, 'submit_feed', resubmit)
    started = asyncio.Event()
    async def waiting(*args):
        started.set()
        await asyncio.Event().wait()
    monkeypatch.setattr(manager, 'execute', waiting)
    await manager.submit(context.sub.id, {'targets':None}, {'mode':'test_latest','confirm':True})
    await started.wait()
    assert monitor._defer_feed_id(context.feed.id) is True
    await manager.close()
    resubmit.assert_not_called()
    assert not monitor._manual_pending and not monitor._manual_feeds and not monitor._manual_no_resubmit


@pytest.mark.parametrize('mode', ['updates', 'test_latest'])
async def test_manual_retries_check_permissions_again_before_next_rpc(context, monkeypatch, mode):
    from telethon.errors import FloodWaitError
    await db.Sub.filter(id=context.other.id).update(state=0)
    manager = manual_fetch.ManualFetch(Service(context.store, context.gateway))
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=fetched(context.feed, entries())))
    monkeypatch.setattr(locks, 'user_msg_locks', lambda _: (asyncio.Lock(), asyncio.Lock()))
    client_send = AsyncMock(side_effect=FloodWaitError(None, capture=1))
    monkeypatch.setattr(env, 'bot', SimpleNamespace(get_input_entity=AsyncMock(return_value=object()), send_message=client_send))
    async def stop_while_waiting(*args, **kwargs):
        await manager.service.patch(context.sub, {'state':0})
    monkeypatch.setattr(locks, 'user_flood_wait_background', stop_while_waiting)
    async def sending(sub):
        return bool(await Message(sub.user_id, plain_text='one').send())
    post = SimpleNamespace(send_formatted_post_according_to_sub=sending,
                           link='https://example.invalid/1', feed_link=context.feed.link,
                           title='One', feed_title='Example', author=None)
    monkeypatch.setattr(notifier_module, 'get_post_from_entry', AsyncMock(return_value=post))
    monkeypatch.setattr(manual_fetch, 'get_post_from_entry', AsyncMock(return_value=post))
    async def immediate(self):
        await self._notify_all()
    monkeypatch.setattr(Notifier, 'notify_all', immediate)
    operation = manager.execute({'mode':mode, 'subscription_id':str(context.sub.id)}, {'targets':None}, Monitor())
    if mode == 'test_latest':
        from src.management.service import Problem
        with pytest.raises(Problem):
            await operation
    else:
        await operation
    assert client_send.await_count == 1
    row = (await context.store.articles.history(context.feed.id, context.sub.user_id))['items'][0]
    assert row['status'] == 'unconfirmed' and '可能已有部分消息送达' in row['detail']


async def test_scheduled_delivery_has_no_manual_permission_queries(context, monkeypatch):
    from src.management import send_guard
    checked = AsyncMock(side_effect=AssertionError('Scheduled delivery should not query the manual gate'))
    monkeypatch.setattr(send_guard.Guard, 'check', checked)
    client_send = AsyncMock(return_value=object())
    monkeypatch.setattr(env, 'bot', SimpleNamespace(get_input_entity=AsyncMock(return_value=object()), send_message=client_send))
    monkeypatch.setattr(locks, 'user_msg_locks', lambda _: (asyncio.Lock(), asyncio.Lock()))
    async def sending(sub):
        return bool(await Message(sub.user_id, plain_text='scheduled').send())
    post = SimpleNamespace(send_formatted_post_according_to_sub=sending)
    monkeypatch.setattr(notifier_module, 'get_post_from_entry', AsyncMock(return_value=post))
    notifier = Notifier(context.feed, [context.sub], entries=entries(), article_journal=False)
    await notifier._notify_sub_with_entry_idx(0, context.sub)
    client_send.assert_awaited_once()
    checked.assert_not_awaited()
