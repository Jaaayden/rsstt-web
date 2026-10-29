"""Bounded, explicit administrator checks using the running bot's pipeline."""
import asyncio
import secrets
import time
import re
from collections import OrderedDict
from datetime import datetime, timezone

from aiohttp import web as http

from .. import db, web
from ..monitor._monitor import Monitor, _fetch_failure
from ..parsing.post import get_post_from_entry
from .service import Problem
from . import send_guard

ACTIVE_LIMIT = 3
HISTORY_LIMIT = 100
HISTORY_SECONDS = 15 * 60
TASK_TIMEOUT = 120
MODES = ('updates', 'test_latest')
DEPARTED = ('left', 'banned', 'disabled')


class ManualFetch:
    def __init__(self, service, *, snapshot=False):
        self.service = service
        self.store = service.store
        self.snapshot = snapshot
        self.jobs = OrderedDict()
        self.tasks = {}
        self.feed_jobs = {}
        self.closed = False
        self.lock = asyncio.Lock()

    def _prune(self):
        now = time.monotonic()
        for ident, job in tuple(self.jobs.items()):
            if ident not in self.tasks and (now - job['_updated'] > HISTORY_SECONDS or len(self.jobs) > HISTORY_LIMIT):
                self.jobs.pop(ident)
                if self.feed_jobs.get(job['feed_id']) == ident:
                    self.feed_jobs.pop(job['feed_id'], None)

    @staticmethod
    def public(job):
        return {key: value for key, value in job.items() if not key.startswith('_')}

    async def eligible(self, feed_id):
        departed = await self.store.departed_ids()
        return await db.Sub.filter(feed_id=feed_id, state=1).exclude(user__state=-1).exclude(
            user_id__in=departed).select_related('feed', 'user')

    async def subscription(self, ident, principal):
        sub = await self.service.subscription(ident, principal)
        if sub.user.state == -1:
            raise Problem('该会话已被封禁，无法抓取或测试推送。请先解除封禁。', 409,
                          code='MANUAL_FETCH_BANNED')
        target = (await self.store.target_map([sub.user_id])).get(str(sub.user_id), {})
        if target.get('membership') in DEPARTED:
            raise Problem('机器人已退出或无法服务这个会话，不能执行抓取或测试推送。', 409,
                          code='MANUAL_FETCH_DEPARTED')
        if sub.state != 1:
            raise Problem('此订阅已暂停，请先恢复订阅，再执行抓取或测试推送。', 409,
                          code='MANUAL_FETCH_PAUSED')
        if sub.feed.state != 1:
            raise Problem('此订阅源已停用，请先恢复订阅源，再执行抓取或测试推送。', 409,
                          code='MANUAL_FETCH_INACTIVE')
        return sub

    async def describe(self, ident, principal):
        sub = await self.service.subscription(ident, principal)
        reason, code = None, None
        try:
            self.offline_check()
            await self.subscription(ident, principal)
        except Problem as error:
            reason, code = error.message, error.code
        return dict(available=reason is None, reason=reason, code=code,
                    simulated=self.service.demo, modes=list(MODES), feed_id=str(sub.feed_id),
                    target_id=str(sub.user_id), affected_recipients=len(await self.eligible(sub.feed_id)))

    def offline_check(self):
        if self.snapshot:
            raise Problem('真实数据离线预览不执行 RSS 抓取或 Telegram 推送，请在联网测试实例中使用。', 409,
                          code='MANUAL_FETCH_OFFLINE')
        if self.closed:
            raise Problem('实例正在停止，无法创建新的抓取任务。', 409, code='MANUAL_FETCH_STOPPING')

    async def submit(self, ident, principal, values):
        async with self.lock:
            return await self._submit(ident, principal, values)

    async def _submit(self, ident, principal, values):
        self.offline_check()
        if set(values) != {'mode', 'confirm'} or values.get('mode') not in MODES or values.get('confirm') is not True:
            raise Problem('请选择抓取方式，并明确确认推送范围。', code='MANUAL_FETCH_CONFIRM_REQUIRED')
        sub = await self.subscription(ident, principal)
        self._prune()
        feed_id = str(sub.feed_id)
        existing = self.jobs.get(self.feed_jobs.get(feed_id))
        if existing and (existing['id'] in self.tasks or time.monotonic() - existing['_updated'] < 2):
            if existing['mode'] == values['mode'] and existing['subscription_id'] == str(sub.id):
                return self.public(existing)
            raise Problem('这个订阅源已有手动任务，请等待当前任务完成。', 409, code='MANUAL_FETCH_BUSY')
        if len(self.tasks) >= ACTIVE_LIMIT:
            raise Problem('正在处理的手动任务较多，请等待已有任务完成后重试。', 429,
                          code='MANUAL_FETCH_LIMIT')
        monitor = Monitor.get_instance()
        if monitor.manual_busy(sub.feed_id):
            raise Problem('这个订阅源正在抓取，请等待当前任务完成后重试。', 409,
                          code='MANUAL_FETCH_BUSY')
        job = dict(id=secrets.token_hex(12), status='queued', mode=values['mode'], feed_id=feed_id,
                   subscription_id=str(sub.id), target_id=str(sub.user_id), simulated=self.service.demo,
                   affected_recipients=len(await self.eligible(sub.feed_id)) if values['mode'] == 'updates' else 1,
                   result=None, error=None, code=None, _updated=time.monotonic())
        # No await between registration and task creation: repeated submissions
        # observe the same job before any transport can start.
        self.jobs[job['id']] = job
        self.feed_jobs[feed_id] = job['id']
        self.tasks[job['id']] = asyncio.create_task(self._run(job, principal, monitor))
        self._prune()
        await self.log(job, 'manual.requested', '已提交手动抓取任务。')
        return self.public(job)

    def get(self, ident):
        self._prune()
        job = self.jobs.get(ident)
        if job is None:
            raise Problem('找不到手动抓取任务，可能已超过记录保留时间。', 404,
                          code='MANUAL_FETCH_JOB_NOT_FOUND')
        return self.public(job)

    async def log(self, job, code, message, *, error=None):
        context = {'stage': 'manual', 'status': job['status']}
        if error:
            context['exception_type'] = type(error).__name__
        await self.store.diagnostics.record('fetch', 'error' if error else 'info', code, message,
                                            feed_id=job['feed_id'], target_id=job['target_id'], context=context)

    async def _run(self, job, principal, monitor):
        job['status'] = 'running'
        try:
            async with monitor.manual_slot(int(job['feed_id'])):
                job['result'] = await asyncio.wait_for(self.execute(job, principal, monitor), TASK_TIMEOUT)
            job['status'] = 'completed'
            await self.log(job, 'manual.completed', '手动抓取检查已完成。')
        except asyncio.CancelledError as error:
            job.update(status='failed', code='MANUAL_FETCH_CANCELLED',
                       error='实例停止，手动任务已中断；如已开始发送，请到目标会话确认送达情况。')
            await self.log(job, 'manual.cancelled', '实例停止，手动抓取任务已中断。', error=error)
            raise
        except Problem as error:
            job.update(status='failed', code=error.code or 'MANUAL_FETCH_FAILED', error=error.message)
            await self.log(job, 'manual.failed', '手动抓取或测试推送未完成。', error=error)
        except asyncio.TimeoutError as error:
            job.update(status='failed', code='MANUAL_FETCH_TIMEOUT',
                       error='手动任务超时；如已开始发送，请到目标会话和运行日志确认结果。')
            await self.log(job, 'manual.failed', '手动抓取或测试推送超时。', error=error)
        except Exception as error:
            job.update(status='failed', code='MANUAL_FETCH_FAILED',
                       error='手动抓取或测试推送未完成，请查看抓取日志及相关运行日志。')
            await self.log(job, 'manual.failed', '手动抓取或测试推送未完成。', error=error)
        finally:
            job['_updated'] = time.monotonic()
            self.tasks.pop(job['id'], None)

    async def execute(self, job, principal, monitor):
        sub = await self.subscription(job['subscription_id'], principal)
        if self.service.demo:
            await asyncio.sleep(0)
            return dict(outcome='simulated', new_entries=0, push_status='simulated',
                        affected_recipients=job['affected_recipients'])
        if job['mode'] == 'updates':
            result = {}
            headers = await self.headers(sub.feed.link)
            monitor._stat.start()
            try:
                await monitor._do_monitor_a_feed(sub.feed, datetime.now(timezone.utc), force=True,
                    subscription_provider=self.eligible, result=result, request_headers=headers,
                    article_journal=getattr(self.store, 'articles', False), article_source='manual',
                    resolve_subscription=lambda pending: self.subscription(pending.id, principal))
            finally:
                monitor._stat.finish()
            if result.get('outcome') in ('failed', 'deactivation_requested', 'exception'):
                raise Problem('抓取失败，请打开抓取日志查看 HTTP 状态、异常原因和重试安排。',
                              code='MANUAL_FETCH_FAILED')
            if result.get('outcome') == 'rate_limited':
                raise Problem('接收会话当前均受 Telegram 限流，未执行本次抓取；请等待限流结束后重试。',
                              code='MANUAL_FETCH_RATE_LIMITED')
            if result.get('outcome') == 'skipped':
                raise Problem('当前没有可以接收推送的启用订阅，未执行本次抓取。',
                              code='MANUAL_FETCH_NO_RECIPIENTS')
            return result
        return await self.test_latest(sub, job, principal)

    async def headers(self, url):
        # Read this instance's override directly; no process-global store is
        # installed by app creation in tests or offline previews.
        rows = await self.store.rows('SELECT user_agent FROM feed_fetch_options WHERE url=?', (url,))
        return {'User-Agent': rows[0]['user_agent']} if rows else {}

    async def test_latest(self, sub, job, principal):
        headers = await self.headers(sub.feed.link)
        started = time.monotonic()
        wf = await web.feed_get(sub.feed.link, headers=headers, verbose=False)
        context = {'stage': 'request', 'duration_ms': round((time.monotonic() - started) * 1000)}
        if isinstance(wf.status, int) and 100 <= wf.status <= 599:
            context['http_status'] = wf.status
        if wf.rss_d is None:
            detail, extra = _fetch_failure(wf)
            await self.store.diagnostics.record('fetch', 'error', 'fetch.failed', '订阅源抓取失败。',
                feed_id=sub.feed_id, detail=detail, context={**context, **extra})
            raise Problem('抓取失败，请打开抓取日志查看错误原因。', code='MANUAL_FETCH_FAILED')
        journal = getattr(self.store, 'articles', None)
        if journal:
            await journal.capture(sub.feed_id, wf.rss_d.entries)
        await self.store.diagnostics.record('fetch', 'info', 'manual.test_fetched', '测试抓取已完成。',
                                            feed_id=sub.feed_id, target_id=sub.user_id, context=context)
        if not wf.rss_d.entries:
            raise Problem('该订阅源当前没有文章，无法测试推送最新一篇。', code='MANUAL_FETCH_EMPTY')
        entry = wf.rss_d.entries[0]
        outcome = {'status': 'failed', 'detail': '测试推送未完成。'}
        if journal:
            await journal.mark(sub.feed_id, entry, sub.user_id, 'queued', source='test')
        try:
            await self.service.gateway.inspect(sub.user_id)
            try:
                post = await get_post_from_entry(entry, sub.feed.title, sub.feed.link)
            except Exception as error:
                await self.delivery_error(sub, 'delivery.parse_failed', '文章解析失败，未能生成推送内容。', error, 'parse')
                raise
            # A pause or ban while fetching/formatting takes effect before send.
            sub = await self.subscription(sub.id, principal)
            outcome.update(status='unconfirmed', detail='Telegram 未确认完整发送。')
            try:
                with send_guard.enforce(lambda: self.subscription(sub.id, principal), sub.user_id):
                    confirmed = await post.send_formatted_post_according_to_sub(sub)
            except send_guard.SendStopped as error:
                outcome.update(status=error.status, detail=error.detail)
                raise Problem(error.detail, code='MANUAL_PUSH_STOPPED') from error
            except Exception as error:
                outcome.update(status='failed', detail=type(error).__name__)
                await self.delivery_error(sub, 'delivery.failed', 'Telegram 推送失败。', error, 'send')
                raise
            if confirmed is not True:
                await self.store.diagnostics.record('delivery', 'warning', 'delivery.unconfirmed',
                    'Telegram 未确认完整发送，不能计为成功推送。', feed_id=sub.feed_id, target_id=sub.user_id,
                    context={'stage':'send', 'status':'unconfirmed'})
                raise Problem('Telegram 未确认完整发送，请到目标会话和运行日志确认结果。',
                              code='MANUAL_PUSH_UNCONFIRMED')
            outcome.update(status='sent', detail='')
            from . import metrics
            await metrics.record(delivered=1)
            await self.store.diagnostics.record('delivery', 'info', 'manual.test_delivered', '测试文章已确认推送。',
                                                feed_id=sub.feed_id, target_id=sub.user_id,
                                                context={'stage': 'send', 'status': 'sent'})
            return dict(outcome='test_delivered', new_entries=0, push_status='confirmed', affected_recipients=1)
        except asyncio.CancelledError:
            if outcome['status'] != 'sent':
                outcome['detail'] = '测试推送已中断，请到目标会话确认送达情况。'
            raise
        except Exception as error:
            if outcome['status'] == 'failed':
                outcome['detail'] = error.message if isinstance(error, Problem) else type(error).__name__
            raise
        finally:
            if journal:
                await journal.mark(sub.feed_id, entry, sub.user_id, outcome['status'],
                                   detail=outcome['detail'], source='test')

    async def delivery_error(self, sub, code, message, error, stage):
        detail = type(error).__name__
        rpc = getattr(error, 'message', None)
        if isinstance(rpc, str) and re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}', rpc):
            detail += '; ' + rpc
        await self.store.diagnostics.record('delivery', 'error', code, message,
            feed_id=sub.feed_id, target_id=sub.user_id, detail=detail,
            context={'stage':stage, 'status':'failed', 'exception_type':type(error).__name__})

    async def close(self):
        self.closed = True
        tasks = dict(self.tasks)
        if tasks:
            Monitor.get_instance().stop_manual_resubmission(
                int(self.jobs[ident]['feed_id']) for ident in tasks if ident in self.jobs)
        for task in tasks.values():
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks.values(), return_exceptions=True)
        # A task cancelled before its coroutine first runs has no finally block.
        for ident in tasks:
            job = self.jobs.get(ident)
            if job and job['status'] in ('queued', 'running'):
                job.update(status='failed', code='MANUAL_FETCH_CANCELLED',
                           error='实例停止，手动任务已中断；如已开始发送，请到目标会话确认送达情况。',
                           _updated=time.monotonic())
            self.tasks.pop(ident, None)


def install(routes, service, admin, body, *, snapshot=False):
    manager = ManualFetch(service, snapshot=bool(snapshot))

    @routes.get('/api/subscriptions/{id}/fetch-now')
    async def describe(request):
        admin(request)
        return http.json_response(await manager.describe(request.match_info['id'], request['principal']))

    @routes.post('/api/subscriptions/{id}/fetch-now')
    async def submit(request):
        admin(request)
        job = await manager.submit(request.match_info['id'], request['principal'], await body(request))
        return http.json_response(job, status=202)

    @routes.get('/api/fetch-jobs/{id}')
    async def status(request):
        admin(request)
        return http.json_response(manager.get(request.match_info['id']))

    return manager
