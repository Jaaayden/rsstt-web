"""Bounded, persistent administrator notifications; no network in business hooks."""
import asyncio
import contextlib
import json
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

import aiohttp

from .service import Problem

active = None
KINDS = ('bark', 'telegram', 'webhook', 'ntfy')
DEFAULT_POLICY = dict(enabled=False, threshold=3, cooldown=3600, new_users=True)


class NotificationDeliveryError(RuntimeError):
    """Safe transport metadata, without endpoint, credentials or response body."""
    def __init__(self, reason, status=None, provider_code=None):
        super().__init__(reason)
        self.reason, self.status, self.provider_code = reason, status, provider_code


def _failure_detail(error):
    context = {'exception_type': type(error).__name__}
    detail = type(error).__name__
    status = getattr(error, 'status', None)
    if isinstance(status, int) and 100 <= status <= 599:
        context['http_status'] = status
    if isinstance(error, NotificationDeliveryError):
        detail += '; ' + error.reason
        if type(error.provider_code) is int:
            detail += f'; provider_code={error.provider_code}'
    errno = getattr(getattr(error, 'os_error', error), 'errno', None)
    if type(errno) is int:
        detail += f'; errno={errno}'
    return detail, context


async def fetch_result(feed_id, error_count):
    if active:
        await active.safe_event('fetch', str(feed_id), error_count)


async def user_seen(user_id):
    if active:
        await active.safe_event('user', str(user_id), 0)


class Notifications:
    def __init__(self, store, offline=False, sender=None):
        self.store, self.offline = store, offline
        self.sender = sender or self.send
        self.task = None
        self.lock = asyncio.Lock()
        self.degraded = False

    async def _diagnostic(self, *args, **kwargs):
        journal = getattr(self.store, 'diagnostics', None)
        if journal is not None:
            return await journal.record(*args, **kwargs)
        return False

    async def open(self):
        # Restrict newly created SQLite WAL/SHM files as well as the main database.
        for suffix in ('', '-wal', '-shm'):
            path = str(self.store.path) + suffix
            if os.path.exists(path):
                os.chmod(path, 0o600)
        await self.store.execute('CREATE TABLE IF NOT EXISTS notify_config (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
        await self.store.execute('CREATE TABLE IF NOT EXISTS notify_seen (kind TEXT, subject TEXT, latched INTEGER DEFAULT 0, last_at REAL DEFAULT 0, PRIMARY KEY(kind,subject))')
        await self.store.execute('CREATE TABLE IF NOT EXISTS notify_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT, event TEXT, subject TEXT, status TEXT, attempts INTEGER DEFAULT 0, due REAL, created REAL)')
        return self

    async def baseline(self):
        from .. import db
        # Existing users are never treated as newly arrived after enabling/upgrading.
        async for user in db.User.all():
            await self.store.execute("INSERT OR IGNORE INTO notify_seen(kind,subject,latched) VALUES ('user',?,1)", (str(user.id),))

    async def config(self):
        rows = await self.store.rows('SELECT value FROM notify_config WHERE id=1')
        return json.loads(rows[0]['value']) if rows else dict(policy=DEFAULT_POLICY.copy(), channels={})

    async def summary(self):
        cfg = await self.config()
        return dict(policy=cfg['policy'], channels={k: dict(enabled=v['enabled'], configured=True) for k, v in cfg['channels'].items()}, offline=self.offline, degraded=self.degraded)

    async def configure(self, values):
        async with self.lock:
            if set(values) - {'policy', 'channels'}:
                raise Problem('通知配置字段无效。')
            cfg = await self.config()
            policy = values.get('policy', {})
            if not isinstance(policy, dict) or set(policy) - set(DEFAULT_POLICY):
                raise Problem('通知策略字段无效。')
            for k, v in policy.items():
                if k in ('enabled', 'new_users'):
                    if type(v) is not bool:
                        raise Problem('通知开关必须为布尔值。')
                elif type(v) is not int or not (1 <= v <= (100 if k == 'threshold' else 604800)):
                    raise Problem('阈值为 1–100，冷却为 1–604800 秒。')
            cfg['policy'].update(policy)
            channels = values.get('channels', {})
            if not isinstance(channels, dict) or set(channels) - set(KINDS):
                raise Problem('通知渠道无效。')
            for kind, value in channels.items():
                if value is None:
                    cfg['channels'].pop(kind, None)
                    continue
                if not isinstance(value, dict):
                    raise Problem('渠道配置必须为对象。')
                channel = {**cfg['channels'].get(kind, {}), **value}
                allowed = {'enabled', 'url', 'headers'} if kind in ('bark', 'webhook') else {'enabled', 'token', 'chat_id'} if kind == 'telegram' else {'enabled', 'url', 'token', 'topic'}
                if set(channel) - allowed or type(channel.get('enabled')) is not bool:
                    raise Problem('渠道字段无效。')
                if any(not isinstance(v, str) or len(v) > 2048 for k, v in channel.items() if k not in ('enabled', 'headers')):
                    raise Problem('渠道文本字段无效。')
                if kind == 'telegram':
                    if not re.fullmatch(r'\d{1,20}:[A-Za-z0-9_-]{20,100}', channel.get('token', '')) or not re.fullmatch(r'-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,64}', channel.get('chat_id', '')):
                        raise Problem('Telegram Token 或接收者格式无效。')
                else:
                    url = channel.get('url', '')
                    try:
                        parsed = urlsplit(url)
                        valid = len(url) <= 2048 and parsed.scheme in ('http', 'https') and parsed.hostname and not (parsed.username or parsed.password or parsed.fragment)
                    except (ValueError, TypeError):
                        valid = False
                    if not valid:
                        raise Problem('请填写有效的 HTTP(S) 通知地址。')
                headers = channel.get('headers', {})
                if not isinstance(headers, dict) or len(headers) > 10:
                    raise Problem('最多设置 10 个自定义请求头。')
                for k, v in headers.items():
                    if not re.fullmatch(r'[A-Za-z0-9-]{1,64}', k) or k.lower() in ('host', 'content-length', 'transfer-encoding', 'connection', 'content-type') or k.lower().startswith('proxy-') or not isinstance(v, str) or len(v) > 1024 or any(c in v for c in '\r\n\0'):
                        raise Problem('自定义请求头无效。')
                if kind == 'ntfy' and (not re.fullmatch(r'[-_A-Za-z0-9]{1,64}', channel.get('topic', '')) or not isinstance(channel.get('token', ''), str) or not re.fullmatch(r'[\x21-\x7e]{0,256}', channel.get('token', ''))):
                    raise Problem('ntfy topic 或 Token 无效。')
                cfg['channels'][kind] = channel
            await self.store.execute('INSERT OR REPLACE INTO notify_config VALUES (1,?)', (json.dumps(cfg),))
        return await self.summary()

    async def safe_event(self, kind, subject, count):
        try:
            await self.event(kind, subject, count)
            self.degraded = False
        except Exception as error:
            # Never log exceptions containing endpoint credentials or source URLs.
            self.degraded = True
            detail, context = _failure_detail(error)
            await self._diagnostic('notification', 'error', 'notification.queue_failed', '通知任务处理失败。',
                                     detail=detail, feed_id=subject if kind == 'fetch' else None,
                                     target_id=subject if kind == 'user' else None,
                                     context={**context, 'stage': 'queue', 'status': 'failed'})

    async def event(self, kind, subject, count):
        async with self.lock:
            cfg = await self.config()
            p = cfg['policy']
            rows = await self.store.rows('SELECT * FROM notify_seen WHERE kind=? AND subject=?', (kind, subject))
            old = rows[0] if rows else dict(latched=0, last_at=0)
            if kind == 'user' and old['latched']:
                return
            reached = kind == 'user' or count >= p['threshold']
            trigger = reached and not old['latched'] and time.time() - old['last_at'] >= p['cooldown']
            now = time.time()
            # State and jobs commit together: crash cannot consume an event without its job.
            async with self.store.lock:
                try:
                    await self.store.db.execute('INSERT OR REPLACE INTO notify_seen VALUES (?,?,?,?)', (kind, subject, int(reached), now if trigger else old['last_at']))
                    if trigger and p['enabled'] and (kind != 'user' or p['new_users']):
                        await self.enqueue(cfg, 'user.first_seen' if kind == 'user' else 'fetch.failed', subject, now)
                    await self.store.db.commit()
                except BaseException:
                    await self.store.db.rollback()
                    raise

    async def enqueue(self, cfg, event, subject, now, only=None):
        for kind, channel in cfg['channels'].items():
            if channel['enabled'] and (only is None or only == kind):
                await self.store.db.execute('INSERT INTO notify_jobs(channel,event,subject,status,due,created) VALUES (?,?,?,?,?,?)', (kind, event, subject, 'pending', now, now))
        # Explicit lossy backpressure: retain newest 200 jobs, including pending jobs.
        await self.store.db.execute('DELETE FROM notify_jobs WHERE id NOT IN (SELECT id FROM notify_jobs ORDER BY id DESC LIMIT 200)')

    async def test(self, channel):
        if channel not in KINDS:
            raise Problem('通知渠道无效。')
        cfg = await self.config()
        if not cfg['channels'].get(channel, {}).get('enabled'):
            raise Problem('请先保存并启用此渠道。')
        async with self.store.lock:
            await self.enqueue(cfg, 'test', 'administrator', time.time(), channel)
            await self.store.db.commit()
        return dict(ok=True, simulated=self.offline, message='离线模式：仅模拟，不会外连。' if self.offline else '已加入测试队列。')

    async def history(self):
        return await self.store.rows('SELECT * FROM notify_jobs ORDER BY id DESC LIMIT 200')

    async def drain_once(self):
        rows = await self.store.rows("SELECT * FROM notify_jobs WHERE status='pending' AND due<=? ORDER BY id LIMIT 1", (time.time(),))
        if not rows:
            return False
        job = rows[0]
        cfg = await self.config()
        channel = cfg['channels'].get(job['channel'])
        attempts = job['attempts'] + 1
        status = 'cancelled'
        failure = None
        started = time.monotonic()
        if channel and channel['enabled'] and (cfg['policy']['enabled'] or job['event'] == 'test'):
            try:
                if self.offline:
                    status = 'simulated'
                else:
                    await asyncio.wait_for(self.sender(job['channel'], channel, job), timeout=10)
                    status = 'sent'
            except Exception as error:
                failure = error
                status = 'failed' if attempts >= 3 else 'pending'
        due = time.time() + 30 * attempts
        await self.store.execute('UPDATE notify_jobs SET status=?,attempts=?,due=? WHERE id=?', (status, attempts, due, job['id']))
        context = {'channel': job['channel'], 'attempt': attempts, 'status': status, 'stage': 'send',
                   'duration_ms': round((time.monotonic() - started) * 1000)}
        if channel and channel.get('url'):
            try:
                context['source_host'] = urlsplit(channel['url']).hostname
            except ValueError:
                pass
        detail = ''
        if failure is not None:
            detail, error_context = _failure_detail(failure)
            context.update(error_context)
        if status == 'pending':
            context['next_retry_at'] = datetime.fromtimestamp(due, timezone.utc).isoformat()
        code, message, level = {
            'pending': ('notification.retry', '通知投递失败，已安排重试。', 'warning'),
            'failed': ('notification.failed', '通知投递连续失败，已停止重试。', 'error'),
            'sent': ('notification.sent', '通知已发送。', 'info'),
            'simulated': ('notification.simulated', '离线模式：已模拟通知投递。', 'info'),
            'cancelled': ('notification.cancelled', '通知渠道已停用，取消本次投递。', 'info'),
        }[status]
        await self._diagnostic('notification', level, code, message, detail=detail, context=context,
                                 feed_id=job['subject'] if job['event'].startswith('fetch.') else None,
                                 target_id=job['subject'] if job['event'].startswith('user.') else None)
        return True

    async def run(self):
        while True:
            try:
                if not await self.drain_once():
                    await asyncio.sleep(1)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self.degraded = True
                detail, context = _failure_detail(error)
                await self._diagnostic('notification', 'error', 'notification.queue_failed', '通知任务处理失败。',
                                         detail=detail, context={**context, 'stage': 'queue', 'status': 'failed'})
                await asyncio.sleep(5)

    def start(self):
        self.task = asyncio.create_task(self.run())

    async def close(self):
        if self.task:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task
            self.task = None

    async def send(self, kind, cfg, job):
        if self.offline:
            raise RuntimeError('Offline transport disabled')
        title = 'RSStT 管理通知'
        text = f"{job['event']} · ID {job['subject']}"
        headers = cfg.get('headers', {})
        url = cfg.get('url')
        payload = dict(event=job['event'], title=title, body=text, event_id=str(job['id']))
        if kind == 'telegram':
            url = f"https://api.telegram.org/bot{cfg['token']}/sendMessage"
            payload = dict(chat_id=cfg['chat_id'], text=f'{title}\n{text}')
        elif kind == 'ntfy':
            payload = dict(topic=cfg['topic'], title=title, message=text)
            headers = {'Authorization': f"Bearer {cfg['token']}"} if cfg.get('token') else {}
        elif kind == 'bark':
            payload = dict(title=title, body=text)
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10), trust_env=False) as client:
            async with client.post(url, json=payload, headers=headers, allow_redirects=False) as response:
                if not 200 <= response.status < 300:
                    raise NotificationDeliveryError('HTTP response rejected', response.status)
                if kind in ('telegram', 'bark'):
                    raw = await response.content.read(65537)
                    if len(raw) > 65536:
                        raise NotificationDeliveryError('Response too large', response.status)
                    result = json.loads(raw)
                    if (kind == 'telegram' and result.get('ok') is not True) or (kind == 'bark' and result.get('code') != 200):
                        provider_code = result.get('error_code' if kind == 'telegram' else 'code')
                        raise NotificationDeliveryError('Provider response rejected', response.status, provider_code)
