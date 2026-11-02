"""Real local databases and command wrappers; no Telegram or RSS transport."""
import asyncio
import gc
import json
import re
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from telethon import events, types

from src import db, env
from src.command import utils
from src.management import chat_audit as audit


@pytest.fixture(autouse=True)
def isolate_capture(monkeypatch):
    audit.uninstall()
    monkeypatch.setattr(audit, '_degraded', False)
    yield
    audit.uninstall()


async def test_web_changes_are_actual_and_scoped(context):
    assert await audit.initialize(context.store)
    async with audit.audit_call(-1001, 'role.update', actor='preview-admin', store=context.store):
        await db.User.filter(id=-1001).update(state=-1)
        await db.Sub.filter(id=context.sub.id).update(state=0)
    history = await audit.events(context.store, -1001)
    assert history['total'] == 1 and history['degraded'] is False
    row = history['items'][0]
    assert row['source'] == 'web' and row['actor'] == 'preview-admin' and row['outcome'] == 'completed'
    assert {'entity': 'user', 'id': '-1001', 'field': 'state', 'before': 50, 'after': -1} in row['changes']
    assert {'entity': 'subscription', 'id': str(context.sub.id), 'field': 'state', 'before': 1, 'after': 0} in row['changes']
    assert (await audit.events(context.store, -1002))['items'] == []
    assert context.feed.link not in json.dumps(row)


async def test_disabled_capture_and_read_commands_do_not_snapshot(context, monkeypatch):
    monkeypatch.setattr(db.User, 'filter', lambda *a, **k: pytest.fail('unexpected user snapshot'))
    monkeypatch.setattr(db.Sub, 'filter', lambda *a, **k: pytest.fail('unexpected subscription snapshot'))
    assert await audit.snapshot(-1001, 'subscriptions.update') is None
    assert await audit.record(-1001, 'subscriptions.list', source='bot') is False
    async with audit.audit_call(-1001, 'subscriptions.update', source='bot') as call:
        assert call is None
    assert await audit.initialize(context.store)
    audit.install(context.store)
    async with audit.audit_call(-1001, 'subscriptions.list', source='bot', actor=2):
        pass
    row = (await audit.events(context.store, -1001))['items'][0]
    assert row['action'] == 'subscriptions.list' and row['changes'] == []


async def test_snapshots_cap_rows_and_target_old_subscription_or_feed(context):
    assert await audit.initialize(context.store)
    feeds = [db.Feed(id=100 + i, link=f'https://example.test/{i}', title='Feed') for i in range(205)]
    await db.Feed.bulk_create(feeds)
    await db.Sub.bulk_create([db.Sub(user_id=-1001, feed_id=feed.id) for feed in feeds])
    snapshot = await audit.snapshot(-1001, 'subscriptions.update', store=context.store)
    assert len(snapshot['subscriptions']) == 200 and snapshot['truncated'] is True
    assert str(context.sub.id) not in snapshot['subscriptions']
    async with audit.audit_call(-1001, 'subscriptions.update', actor='admin', store=context.store,
                                subscription_ids=[context.sub.id]):
        await db.Sub.filter(id=context.sub.id).update(tags='changed')
    row = (await audit.events(context.store, -1001))['items'][0]
    assert row['truncated'] is False
    assert {'entity': 'subscription', 'id': str(context.sub.id), 'field': 'tags', 'before': None, 'after': 'changed'} in row['changes']
    async with audit.audit_call(-1002, 'recipients.update', source='agent', actor='Agent',
                                store=context.store, feed_id=100):
        added = await db.Sub.create(user_id=-1002, feed_id=100)
    row = (await audit.events(context.store, -1002))['items'][0]
    assert row['source'] == 'agent'
    assert {'entity': 'subscription', 'id': str(added.id), 'field': 'exists', 'before': False, 'after': True} in row['changes']


async def test_retention_pagination_and_bounded_payload(context, monkeypatch):
    assert await audit.initialize(context.store)
    monkeypatch.setattr(audit, 'PER_CHAT_LIMIT', 3)
    monkeypatch.setattr(audit, 'TOTAL_LIMIT', 5)
    for chat in (1, 2, 3):
        for _ in range(5):
            assert await audit.record(chat, 'subscriptions.list', store=context.store)
    assert (await context.store.rows('SELECT COUNT(*) AS n FROM chat_events'))[0]['n'] == 5
    assert (await audit.events(context.store, 3, page=1, size=2))['total'] == 3
    assert len((await audit.events(context.store, 3, page=2, size=2))['items']) == 1
    changes = [{'entity': 'subscription', 'id': str(i + 1), 'field': 'title', 'before': '中' * 300,
                'after': '😀' * 300} for i in range(100)]
    assert await audit.record(3, 'subscriptions.update', changes=changes, store=context.store)
    row = (await audit.events(context.store, 3))['items'][0]
    assert row['truncated'] is True and len(row['changes']) < len(changes)
    raw = (await context.store.rows('SELECT payload FROM chat_events ORDER BY id DESC LIMIT 1'))[0]['payload']
    assert len(raw.encode()) <= 4096


async def test_sensitive_values_and_unknown_fields_never_enter_history(context):
    assert await audit.initialize(context.store)
    secret = '123456:abcdefghijklmnopqrstuvwx'
    changes = [
        {'entity': 'user', 'id': '2', 'field': 'password', 'before': None, 'after': 'private-password'},
        {'entity': 'subscription', 'id': '1', 'field': 'title', 'before': None,
         'after': f'password=private-password token={secret} rst_abcdefghijklmnopqrstuvwxyz'},
        {'entity': 'subscription', 'id': '1', 'field': 'tags', 'before': None,
         'after': 'https://username:private-password@example.test/'},
    ]
    assert await audit.record(2, 'raw-command-containing-secret', changes=changes,
                               actor='token=' + secret, source='agent', store=context.store)
    raw = json.dumps((await audit.events(context.store, 2))['items'])
    for value in ('private-password', secret, 'rst_abcdefghijklmnopqrstuvwxyz', 'raw-command-containing-secret'):
        assert value not in raw
    assert '[redacted]' in raw and 'bot.other' in raw


async def test_audit_failure_does_not_replace_business_result_or_exception(context, monkeypatch):
    assert await audit.initialize(context.store)
    with monkeypatch.context() as patch:
        patch.setattr(context.store.db, 'execute', AsyncMock(side_effect=RuntimeError('private SQL detail')))
        async with audit.audit_call(-1001, 'subscriptions.list', store=context.store):
            completed = True
    assert completed and audit.status()['degraded'] is True
    original = ValueError('private exception detail')
    with pytest.raises(ValueError) as found:
        async with audit.audit_call(-1001, 'subscriptions.list', store=context.store):
            raise original
    assert found.value is original
    row = (await audit.events(context.store, -1001))['items'][0]
    assert row['outcome'] == 'error' and 'private exception detail' not in json.dumps(row)


async def test_chat_mutations_serialize_without_permanent_lock_growth(context):
    assert await audit.initialize(context.store)
    entered, release = asyncio.Event(), asyncio.Event()
    async def first():
        async with audit.audit_call(-1001, 'settings.update', actor='admin', store=context.store):
            entered.set()
            await release.wait()
            await db.User.filter(id=-1001).update(sub_limit=10)
    async def second():
        await entered.wait()
        async with audit.audit_call(-1001, 'settings.update', actor='preview-admin', store=context.store):
            await db.User.filter(id=-1001).update(sub_limit=20)
    task1, task2 = asyncio.create_task(first()), asyncio.create_task(second())
    await entered.wait()
    # Another destination is independent while this destination is locked.
    async with audit.audit_call(-1002, 'settings.update', store=context.store):
        await db.User.filter(id=-1002).update(sub_limit=30)
    release.set()
    await asyncio.gather(task1, task2)
    rows = (await audit.events(context.store, -1001))['items']
    assert any(change['before'] == 10 and change['after'] == 20 for change in rows[0]['changes'])
    assert any(change['before'] is None and change['after'] == 10 for change in rows[1]['changes'])
    gc.collect()
    assert len(audit._chat_locks) == 0


def event_for(chat_id=2, raw='/list'):
    return SimpleNamespace(chat_id=chat_id, sender_id=2, raw_text=raw, is_private=True,
                           is_group=False, is_channel=False, pattern_match=None,
                           get_sender=AsyncMock(return_value=types.User(id=2, first_name='Synthetic', lang_code='en')),
                           respond=AsyncMock())


@pytest.mark.parametrize('state,outcome,called_count', [(1, 'completed', 1), (-1, 'denied', 0)])
async def test_gatekeeper_preserves_execution_and_denials(context, state, outcome, called_count):
    assert await audit.initialize(context.store)
    audit.install(context.store)
    await db.User.filter(id=2).update(state=state)
    called = AsyncMock()
    guarded = utils.command_gatekeeper(called)
    event = event_for(raw='/list token=ordinary-secret')
    with pytest.raises(events.StopPropagation):
        await guarded(event)
    assert called.await_count == called_count
    row = (await audit.events(context.store, 2))['items'][0]
    assert row['outcome'] == outcome and row['action'] == 'subscriptions.list'
    assert 'ordinary-secret' not in json.dumps(row)


async def test_remote_command_is_attributed_to_target_not_sender(context, monkeypatch):
    assert await audit.initialize(context.store)
    audit.install(context.store)
    target = -1000000001001
    await db.User.create(id=target, state=50)
    sub = await db.Sub.create(user_id=target, feed_id=context.feed.id)
    raw = f'/set_interval {target} {sub.id} 7'
    event = event_for(raw=raw)
    event.pattern_match = re.match(r'/set_interval (?P<target>-100\d+)', raw)
    channel = types.Channel(id=1001, title='Synthetic channel', photo=types.ChatPhotoEmpty(),
                            date=datetime.now(timezone.utc), broadcast=True)
    monkeypatch.setattr(env, 'bot', SimpleNamespace(get_input_entity=AsyncMock(return_value=types.InputPeerChannel(1001, 0)),
                                                    get_entity=AsyncMock(return_value=channel)))
    monkeypatch.setattr(utils, 'is_self_admin', AsyncMock(return_value=True))
    monkeypatch.setattr(utils, 'is_user_admin', AsyncMock(return_value=(True, 'Admin')))
    async def cmd_set_interval(event, *, chat_id, **kwargs):
        await db.Sub.filter(id=sub.id, user_id=chat_id).update(interval=7)
    with pytest.raises(events.StopPropagation):
        await utils.command_gatekeeper(cmd_set_interval)(event)
    assert (await audit.events(context.store, 2))['items'] == []
    row = (await audit.events(context.store, target))['items'][0]
    assert row['actor'] == '2' and row['outcome'] == 'completed'
    assert any(change['field'] == 'interval' and change['after'] == 7 for change in row['changes'])


async def test_bot_stop_during_action_skips_further_audit_queries(context, monkeypatch):
    assert await audit.initialize(context.store)
    audit.install(context.store)
    call = await audit.begin(-1001, 'settings.update', source='bot')
    audit.uninstall(context.store)
    monkeypatch.setattr(db.Sub, 'filter', lambda *a, **k: pytest.fail('snapshot after stop'))
    assert await audit.finish(call) is False
    gc.collect()
    assert len(audit._chat_locks) == 0


async def test_gatekeeper_audit_hook_failure_does_not_skip_command(context, monkeypatch):
    assert await audit.initialize(context.store)
    audit.install(context.store)
    monkeypatch.setattr(audit, 'begin', AsyncMock(side_effect=RuntimeError('private detail')))
    called = AsyncMock()
    with pytest.raises(events.StopPropagation):
        await utils.command_gatekeeper(called)(event_for())
    assert called.await_count == 1 and audit.status()['degraded'] is True


async def test_gatekeeper_exception_preserves_original_response_and_partial_changes(context):
    assert await audit.initialize(context.store)
    audit.install(context.store)
    async def broken(event, **kwargs):
        await db.User.filter(id=2).update(sub_limit=44)
        raise ValueError('private-exception-secret')
    event = event_for(raw='/set_sub_limit 2 44')
    with pytest.raises(events.StopPropagation):
        await utils.command_gatekeeper(broken)(event)
    assert event.respond.await_count == 1
    row = (await audit.events(context.store, 2))['items'][0]
    assert row['outcome'] == 'error'
    assert any(change['field'] == 'sub_limit' and change['after'] == 44 for change in row['changes'])
    assert 'private-exception-secret' not in json.dumps(row)


async def test_cancelled_mutation_releases_lock_and_marks_error(context):
    assert await audit.initialize(context.store)
    entered = asyncio.Event()
    async def operation():
        async with audit.audit_call(-1001, 'settings.update', store=context.store):
            entered.set()
            await asyncio.Event().wait()
    task = asyncio.create_task(operation())
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert (await audit.events(context.store, -1001))['items'][0]['outcome'] == 'error'
    gc.collect()
    assert len(audit._chat_locks) == 0
