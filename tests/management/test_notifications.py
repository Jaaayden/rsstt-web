import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from src.management.notifications import Notifications
from src.management.store import Store
from conftest import ORIGIN, token

REAL_SEND = Notifications.send


@pytest.fixture(autouse=True)
def forbid_real_notifications(monkeypatch):
    async def forbidden(*args):
        raise AssertionError('Real notification transport forbidden')
    monkeypatch.setattr(Notifications, 'send', forbidden)


async def configured(store, offline=False, sender=None):
    engine = await Notifications(store, offline=offline, sender=sender).open()
    await engine.configure({'policy': {'enabled': True, 'cooldown': 1}, 'channels': {'webhook': {'enabled': True, 'url': 'https://example.invalid/secret', 'headers': {'Authorization': 'private-token'}}}})
    return engine


async def test_threshold_restart_recovery(context):
    e = await configured(context.store, offline=True)
    for count in (1, 2, 3, 4):
        await e.event('fetch', '1', count)
    assert len(await e.history()) == 1
    e = await configured(context.store, offline=True)
    await e.event('fetch', '1', 5)
    assert len(await e.history()) == 1
    await e.event('fetch', '1', 0)
    await context.store.execute('UPDATE notify_seen SET last_at=0')
    await e.event('fetch', '1', 3)
    assert len(await e.history()) == 2
    await e.drain_once()
    assert (await e.history())[-1]['status'] == 'simulated'


async def test_existing_user_first_appearance(context):
    e = await configured(context.store, offline=True)
    await e.baseline()
    for ident in ('1', '2', '-1001', '999', '999'):
        await e.event('user', ident, 0)
    jobs = await e.history()
    assert len(jobs) == 1 and jobs[0]['subject'] == '999'
    # Re-activation/deletion/re-addition never emits another first appearance.
    await context.store.execute('UPDATE notify_seen SET last_at=0')
    await e.event('user', '999', 0)
    assert len(await e.history()) == 1


async def test_no_blocking_and_bounded_retry(context):
    called = []
    async def fail(*args):
        called.append(True)
        raise RuntimeError('https://secret.invalid/private-token')
    e = await configured(context.store, sender=fail)
    await e.event('fetch', '1', 3)
    assert not called  # hook never invokes transport
    for _ in range(3):
        await context.store.execute('UPDATE notify_jobs SET due=0')
        await e.drain_once()
    assert len(called) == 3
    job = (await e.history())[0]
    assert job['status'] == 'failed' and job['attempts'] == 3
    assert 'private-token' not in json.dumps(job)
    for i in range(210):
        await e.event('user', str(i), 0)
    assert len(await e.history()) == 200


async def test_offline_transport_never_called(context):
    async def forbidden(*args):
        pytest.fail('offline sender invoked')
    e = await configured(context.store, offline=True, sender=forbidden)
    assert (await e.test('webhook'))['simulated'] is True
    await e.drain_once()
    assert (await e.history())[0]['status'] == 'simulated'


async def test_config_redaction_authorization(logged):
    c = logged.client
    headers = {'Origin': ORIGIN}
    r = await c.patch('/api/notifications', headers=headers, json={'channels': {'webhook': {'enabled': True, 'url': 'https://example.invalid/secret', 'headers': {'Authorization': 'private-token'}}}})
    assert r.status == 200
    body = await r.text()
    assert 'private-token' not in body and 'example.invalid' not in body
    assert await logged.store.rows('SELECT * FROM notify_jobs') == []
    for permission in ('read', 'write'):
        auth = await token(logged, permission)
        assert (await c.get('/api/notifications', headers=auth)).status == 403
        assert (await c.post('/api/notifications/test', headers=auth, json={'channel': 'webhook'})).status == 403
    for value in ({'url': 'file:///etc/passwd'}, {'headers': {'Host': 'evil'}}, {'headers': {'X-Key': 'x\ny'}}):
        assert (await c.patch('/api/notifications', headers=headers, json={'channels': {'webhook': value}})).status == 400


async def test_worker_shutdown_and_restart_persistence(tmp_path):
    store = await Store(tmp_path / 'console.sqlite3').open()
    e = await configured(store, offline=True)
    await e.event('fetch', '1', 3)
    await store.close()
    store = await Store(tmp_path / 'console.sqlite3').open()
    e = await Notifications(store, offline=True).open()
    assert len(await e.history()) == 1
    e.start()
    await asyncio.sleep(0.05)
    await e.close()
    assert e.task is None
    assert (await e.history())[0]['status'] == 'simulated'
    assert store.path.stat().st_mode & 0o777 == 0o600
    await store.close()


async def test_real_monitor_path(context, monkeypatch):
    from src.management import notifications
    from src.monitor._monitor import Monitor
    from src import web
    e = await configured(context.store, offline=True)
    monkeypatch.setattr(notifications, 'active', e)
    result = SimpleNamespace(status=500, rss_d=None, error='failure', url=context.feed.link)
    async def fetch(*args, **kwargs):
        return result
    monkeypatch.setattr(web, 'feed_get', fetch)
    monitor = Monitor()
    for _ in range(4):
        await monitor._do_monitor_a_feed(context.feed, datetime.now(timezone.utc))
    assert context.feed.error_count == 4
    assert len(await e.history()) == 1
    result.status = 304
    await monitor._do_monitor_a_feed(context.feed, datetime.now(timezone.utc))
    assert context.feed.error_count == 0
    await context.store.execute('UPDATE notify_seen SET last_at=0')
    result.status = 500
    for _ in range(3):
        await monitor._do_monitor_a_feed(context.feed, datetime.now(timezone.utc))
    assert len(await e.history()) == 2


async def test_real_subscription_path(context, monkeypatch):
    from src.management import notifications
    from src.command import inner
    from src import db
    e = await configured(context.store, offline=True)
    await e.baseline()
    monkeypatch.setattr(notifications, 'active', e)
    await db.User.create(id=999, state=1)
    result = await inner.sub.sub(999, context.feed.link)
    assert result['sub'] is not None
    assert len(await e.history()) == 1
    await inner.sub.sub(999, context.feed.link)
    assert len(await e.history()) == 1


async def test_cooldown_and_concurrent_idempotency(context):
    e = await configured(context.store, offline=True)
    await asyncio.gather(*(e.event('fetch', '1', 3) for _ in range(10)))
    assert len(await e.history()) == 1
    await e.event('fetch', '1', 0)
    await e.event('fetch', '1', 3)
    assert len(await e.history()) == 1
    # Cooldown suppresses this whole failure episode, not a late repeat.
    await context.store.execute('UPDATE notify_seen SET last_at=0')
    await e.event('fetch', '1', 4)
    assert len(await e.history()) == 1


async def test_failed_persistence_does_not_break_business(context, monkeypatch):
    from src.management import notifications
    e = await configured(context.store, offline=True)
    monkeypatch.setattr(notifications, 'active', e)
    async def broken(*args):
        raise OSError('disk failure')
    monkeypatch.setattr(e, 'event', broken)
    await notifications.fetch_result(1, 3)
    await notifications.user_seen(999)
    assert e.degraded is True
    monkeypatch.setattr(notifications, 'active', None)
    await notifications.fetch_result(1, 3)
    await notifications.user_seen(999)


@pytest.mark.parametrize('kind', ['bark', 'telegram', 'webhook', 'ntfy'])
async def test_channel_payloads_without_network(context, monkeypatch, kind):
    import aiohttp
    captured = {}
    class Content:
        async def read(self, size):
            return b'{"ok":true,"code":200}'
    class Response:
        status = 200
        content = Content()
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
    class Session:
        def __init__(self, **kwargs):
            assert kwargs['trust_env'] is False
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        def post(self, url, **kwargs):
            captured.update(url=url, **kwargs)
            return Response()
    monkeypatch.setattr(aiohttp, 'ClientSession', Session)
    e = await Notifications(context.store).open()
    cfg = dict(url='https://example.invalid/key', token='123:fake', chat_id='1', topic='test', headers={'X-Test': 'value'})
    await REAL_SEND(e, kind, cfg, dict(event='test', subject='administrator', id=7))
    assert captured['allow_redirects'] is False
    payload = captured['json']
    if kind == 'telegram':
        assert payload['chat_id'] == '1' and captured['url'].endswith('/sendMessage')
    elif kind == 'ntfy':
        assert payload['topic'] == 'test'
        assert captured['headers']['Authorization'] == 'Bearer 123:fake'
    elif kind == 'webhook':
        assert payload['event_id'] == '7'
    else:
        assert payload['body'] == 'test · ID administrator'
    e.offline = True
    with pytest.raises(RuntimeError, match='Offline'):
        await REAL_SEND(e, kind, cfg, {})


async def test_real_bot_gatekeeper_first_use_and_denied(context, monkeypatch):
    from telethon import events
    from src import env
    from src.command import utils
    from src.management import notifications
    e = await configured(context.store, offline=True)
    await e.baseline()
    monkeypatch.setattr(notifications, 'active', e)
    monkeypatch.setattr(env, 'MULTIUSER', True)
    called = []
    async def sender():
        return SimpleNamespace(first_name='Test', last_name=None, lang_code='en')
    async def respond(*args, **kwargs):
        pass
    monkeypatch.setattr(utils, 'respond_or_answer', respond)
    event = SimpleNamespace(chat_id=999, sender_id=999, raw_text='/start', get_sender=sender, pattern_match=None, is_private=True)
    async def handler(event, **kwargs):
        called.append(True)
    denied = utils.command_gatekeeper(handler, only_manager=True)
    with pytest.raises(events.StopPropagation):
        await denied(event)
    assert await e.history() == []
    allowed = utils.command_gatekeeper(handler)
    for _ in range(2):
        with pytest.raises(events.StopPropagation):
            await allowed(event)
    assert len(called) == 2
    assert len(await e.history()) == 1


async def test_shutdown_during_send_leaves_recoverable_job(context):
    entered = asyncio.Event()
    async def slow(*args):
        entered.set()
        await asyncio.Event().wait()
    e = await configured(context.store, sender=slow)
    await e.event('fetch', '1', 3)
    e.start()
    await asyncio.wait_for(entered.wait(), 1)
    await asyncio.wait_for(e.close(), 1)
    assert (await e.history())[0]['status'] == 'pending'
    restarted = await Notifications(context.store, offline=True).open()
    await restarted.drain_once()
    assert (await restarted.history())[0]['status'] == 'simulated'


async def test_atomic_event_rollback(context, monkeypatch):
    e = await configured(context.store, offline=True)
    original = e.enqueue
    async def interrupted(*args):
        raise OSError('write interrupted')
    monkeypatch.setattr(e, 'enqueue', interrupted)
    await e.safe_event('fetch', '1', 3)
    assert e.degraded
    assert await context.store.rows("SELECT * FROM notify_seen WHERE subject='1'") == []
    monkeypatch.setattr(e, 'enqueue', original)
    await e.safe_event('fetch', '1', 3)
    assert len(await e.history()) == 1
