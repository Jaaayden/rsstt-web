import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from telethon import errors, events, utils
from telethon.tl import types

from src import db, env
from src.management import chat_lifecycle as lifecycle, notifications
from src.management.server import NOTIFICATIONS_KEY

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)
SELF = 700


class Client:
    def __init__(self):
        self.handlers = []
        self.entities = {}
        self.lookups = []
        self.get_permissions = AsyncMock(side_effect=errors.ChatAdminRequiredError(None))

    def add_event_handler(self, callback, builder):
        self.handlers.append((callback, builder))

    def remove_event_handler(self, callback, builder):
        self.handlers = [(cb, event) for cb, event in self.handlers
                         if cb != callback or type(event) is not type(builder)]

    async def get_entity(self, ident):
        self.lookups.append(ident)
        value = self.entities.get(ident, ValueError('No cached entity'))
        if isinstance(value, BaseException):
            raise value
        return value


def group(ident=1001, **kwargs):
    return types.Chat(ident, 'Test group', types.ChatPhotoEmpty(), 3, NOW, 1, **kwargs)


def channel(ident, **kwargs):
    return types.Channel(ident, 'Test channel', types.ChatPhotoEmpty(), NOW, broadcast=True, **kwargs)


def action(ident=-1001, *, users=SELF, joined=False, kicked=False, entity=None):
    peer = types.PeerChat(-ident) if isinstance(entity, types.Chat) or ident > -10**12 else types.PeerChannel(-ident-10**12)
    result = events.ChatAction.Event(peer, users=users, added_by=True if joined else None,
                                    kicked_by=999 if kicked else None)
    result._chat = entity
    return result


def private(ident, *, cached=True, name='New person', out=False):
    result = events.NewMessage.Event(types.Message(
        id=1, peer_id=types.PeerUser(ident), from_id=types.PeerUser(ident),
        message='hello', date=NOW, out=out))
    user = types.User(ident, first_name=name, username='example_user')
    result._chat = user if cached else None
    result._sender = user if cached else None
    result.get_chat = AsyncMock(return_value=user)
    return result


@pytest.fixture(autouse=True)
async def isolate_lifecycle(context, monkeypatch):
    # The ordinary create_app fixture starts a notification worker. Stop it so
    # only our explicitly offline engine sees jobs; never allow a real sender.
    await context.client.app[NOTIFICATIONS_KEY].close()
    monkeypatch.setattr(notifications, 'active', None)
    monkeypatch.setattr(notifications.Notifications, 'send', AsyncMock(side_effect=AssertionError('No network')))
    audit = AsyncMock(return_value=True)
    monkeypatch.setattr(lifecycle.chat_audit, 'record', audit)
    await lifecycle.stop()
    yield audit
    await lifecycle.stop()


async def engine(context, monkeypatch, *, enabled=True, new_users=True):
    result = await notifications.Notifications(context.store, offline=True).open()
    await result.configure({'policy': {'enabled': enabled, 'new_users': new_users, 'cooldown': 1},
                            'channels': {'webhook': {'enabled': True, 'url': 'https://example.invalid/notify'}}})
    await result.baseline()
    monkeypatch.setattr(notifications, 'active', result)
    return result


async def test_self_departure_is_idempotent_and_keeps_roles_and_records(context, monkeypatch):
    client = Client()
    observer = lifecycle.ChatLifecycle(context.store, client, SELF)
    user = await db.User.get(id=-1001)
    user.state = -1
    await user.save(update_fields=['state'])
    pause = AsyncMock(wraps=lifecycle.subscription_utils.activate_or_deactivate_all_subs)
    monkeypatch.setattr(lifecycle.subscription_utils, 'activate_or_deactivate_all_subs', pause)
    event = action(kicked=True)
    await observer.observe(event)
    await observer.observe(event)
    pause.assert_awaited_once_with(-1001, activate=False)
    assert (await db.User.get(id=-1001)).state == -1
    assert (await db.Sub.get(id=context.sub.id)).state == 0
    assert (await db.Sub.get(id=context.other.id)).state == 1
    assert await db.Feed.filter(id=context.feed.id).exists()
    assert (await context.store.target_map([-1001]))['-1001']['membership'] == 'left'
    await asyncio.sleep(0)  # Let the upstream interval-update task finish.


async def test_other_members_and_irrelevant_actions_do_not_change_membership(context, monkeypatch):
    e = await engine(context, monkeypatch)
    client = Client()
    observer = lifecycle.ChatLifecycle(context.store, client, SELF)
    await observer.observe(action(users=999, kicked=True))
    await observer.observe(action(users=999, joined=True, entity=group()))
    await observer.observe(action(users=SELF))
    assert (await db.Sub.get(id=context.sub.id)).state == 1
    assert (await context.store.target_map([-1001]))['-1001']['membership'] == 'available'
    assert not client.lookups and not await e.history()


async def test_rejoin_updates_kind_without_unbanning_or_resuming(context, monkeypatch):
    e = await engine(context, monkeypatch)
    client = Client()
    observer = lifecycle.ChatLifecycle(context.store, client, SELF)
    await lifecycle.mark_departed(context.store, -1001)
    await db.User.filter(id=-1001).update(state=-1)
    await observer.observe(action(joined=True, entity=group()))
    meta = (await context.store.target_map([-1001]))['-1001']
    assert meta['kind'] == 'group' and meta['membership'] == 'joined'
    assert (await db.User.get(id=-1001)).state == -1
    assert (await db.Sub.get(id=context.sub.id)).state == 0
    assert not await e.history()  # Existing account was covered by startup baseline.
    await asyncio.sleep(0)


@pytest.mark.parametrize('error', [errors.ChannelPrivateError(None), errors.ChatAdminRequiredError(None),
                                  OSError('network unavailable'), asyncio.TimeoutError()])
async def test_unknown_network_or_permission_failures_never_mark_departure(context, error):
    client = Client()
    client.entities[-1001] = error
    observer = lifecycle.ChatLifecycle(context.store, client, SELF)
    await observer.observe(types.UpdateChat(1001))
    assert (await context.store.target_map([-1001]))['-1001']['membership'] == 'available'
    assert (await db.Sub.get(id=context.sub.id)).state == 1
    assert await db.User.filter(id=-1001).exists() and await db.Feed.filter(id=context.feed.id).exists()


async def test_precise_not_participant_rpc_and_dissolved_group_are_departures(context):
    client = Client()
    client.entities[-1001] = errors.UserNotParticipantError(None)
    client.entities[-1002] = group(1002, deactivated=True)
    observer = lifecycle.ChatLifecycle(context.store, client, SELF)
    await observer.observe(types.UpdateChat(1001))
    await observer.observe(types.UpdateChat(1002))
    metadata = await context.store.target_map([-1001, -1002])
    assert all(metadata[str(ident)]['membership'] == 'left' for ident in (-1001, -1002))
    assert (await db.Sub.get(id=context.sub.id)).state == 0
    assert (await db.Sub.get(id=context.other.id)).state == 0
    assert await db.Feed.filter(id=context.feed.id).exists()
    await asyncio.sleep(0)


async def test_restricted_participant_is_not_confused_with_removal(context):
    ident = utils.get_peer_id(types.PeerChannel(777))
    await db.User.create(id=ident, state=1)
    await context.store.target(ident, 'Channel', None, 'channel', 'available')
    sub = await db.Sub.create(user_id=ident, feed=context.feed)
    client = Client()
    client.entities[ident] = channel(777)
    observer = lifecycle.ChatLifecycle(context.store, client, SELF)
    member = types.ChannelParticipantSelf(SELF, 1, NOW)
    restricted = types.ChannelParticipantBanned(types.PeerUser(SELF), 1, NOW,
                                               types.ChatBannedRights(NOW, send_messages=True), left=False)
    update = types.UpdateChannelParticipant(777, NOW, 1, SELF, 1, prev_participant=member, new_participant=restricted)
    await observer.observe(update)
    assert (await db.Sub.get(id=sub.id)).state == 1
    kicked = types.ChannelParticipantBanned(types.PeerUser(SELF), 1, NOW,
                                           types.ChatBannedRights(NOW, view_messages=True), left=True)
    update.new_participant = kicked
    await observer.observe(update)
    assert (await db.Sub.get(id=sub.id)).state == 0
    assert (await context.store.target_map([ident]))[str(ident)]['membership'] == 'left'
    await asyncio.sleep(0)


async def test_migration_and_forbidden_entity_do_not_prove_departure(context):
    client = Client()
    client.entities[-1001] = group(deactivated=True, migrated_to=types.InputChannel(777, 1))
    client.entities[-1002] = types.ChannelForbidden(1002, 1, 'Hidden', broadcast=True)
    observer = lifecycle.ChatLifecycle(context.store, client, SELF)
    await observer.observe(types.UpdateChat(1001))
    await observer.observe(types.UpdateChat(1002))
    assert (await db.Sub.get(id=context.sub.id)).state == 1
    assert (await db.Sub.get(id=context.other.id)).state == 1
    assert (await context.store.target_map([-1002]))['-1002']['membership'] == 'available'
    assert client.get_permissions.await_count == 2


async def test_new_private_group_and_channel_contact_notify_once(context, monkeypatch):
    e = await engine(context, monkeypatch)
    client = Client()
    observer = lifecycle.ChatLifecycle(context.store, client, SELF)
    message = private(501)
    await observer.observe(message)
    await observer.observe(message)
    group_event = action(-222, joined=True, entity=group(222))
    await observer.observe(group_event)
    await observer.observe(group_event)
    ident = utils.get_peer_id(types.PeerChannel(333))
    update = types.UpdateChannelParticipant(333, NOW, 1, SELF, 1,
                                           new_participant=types.ChannelParticipantSelf(SELF, 1, NOW))
    update._entities = {ident: channel(333)}
    await observer.observe(update)
    await observer.observe(update)
    jobs = await e.history()
    assert {row['subject'] for row in jobs} == {'501', '-222', str(ident)} and len(jobs) == 3
    for user_id in (501, -222, ident):
        user = await db.User.get(id=user_id)
        assert user.lang == 'null' and user.state == 0
    metadata = await context.store.target_map([501, -222, ident])
    assert metadata['501']['kind'] == 'private' and metadata['501']['membership'] == 'known'
    assert metadata['-222']['kind'] == 'group' and metadata[str(ident)]['kind'] == 'channel'
    assert metadata['-222']['membership'] == metadata[str(ident)]['membership'] == 'joined'
    message.get_chat.assert_not_awaited()
    assert not client.lookups


@pytest.mark.parametrize('enabled,new_users', [(False, True), (True, False)])
async def test_notification_switches_prevent_jobs_and_do_not_replay_later(context, monkeypatch, enabled, new_users):
    e = await engine(context, monkeypatch, enabled=enabled, new_users=new_users)
    observer = lifecycle.ChatLifecycle(context.store, Client(), SELF)
    await observer.observe(private(501))
    assert not await e.history()
    await e.configure({'policy': {'enabled': True, 'new_users': True}})
    await observer.observe(private(501))
    await observer.observe(private(502))
    assert [row['subject'] for row in await e.history()] == ['502']


async def test_existing_private_ban_and_missing_metadata_do_not_unban_or_notify(context, monkeypatch):
    e = await engine(context, monkeypatch)
    await db.User.filter(id=2).update(state=-1)
    await context.store.execute('DELETE FROM targets WHERE id=?', ('2',))
    observer = lifecycle.ChatLifecycle(context.store, Client(), SELF)
    await observer.observe(private(2))
    assert (await db.User.get(id=2)).state == -1
    assert not await e.history()
    assert (await context.store.target_map([2]))['2']['membership'] == 'known'


async def test_private_repeat_path_avoids_writes_and_rpc_and_cache_is_bounded(context, monkeypatch):
    monkeypatch.setattr(lifecycle, 'PRIVATE_CACHE_SIZE', 2)
    target = AsyncMock(wraps=context.store.target)
    monkeypatch.setattr(context.store, 'target', target)
    client = Client()
    observer = lifecycle.ChatLifecycle(context.store, client, SELF)
    first = private(501, cached=False)
    await observer.observe(first)
    for _ in range(5):
        await observer.observe(first)
    assert target.await_count == 1
    first.get_chat.assert_awaited_once()
    await observer.observe(private(502))
    await observer.observe(private(503))
    assert len(observer.private_seen) == 2 and not client.lookups
    await observer.observe(private(503, name='Updated name'))
    assert (await context.store.target_map([503]))['503']['title'] == 'Updated name'
    await observer.observe(private(504, out=True))
    assert not await db.User.filter(id=504).exists()


async def test_start_disabled_registers_nothing_and_stop_preserves_other_handlers(context, monkeypatch):
    client = Client()
    monkeypatch.setattr(env, 'bot', client, raising=False)
    monkeypatch.setattr(env, 'bot_id', SELF, raising=False)
    monkeypatch.setenv('WEB_ENABLED', '0')
    assert await lifecycle.start(context.store) is None
    assert not lifecycle.status()['running']
    assert not client.handlers and not client.lookups
    monkeypatch.setenv('WEB_ENABLED', '1')
    marker = (lambda event: None, object())
    client.handlers.append(marker)
    entered = asyncio.Event()
    async def blocked(ident):
        entered.set()
        await asyncio.Future()
    client.get_entity = blocked
    observer = await lifecycle.start(context.store)
    await asyncio.wait_for(entered.wait(), 1)
    assert len(client.handlers) == 4
    assert lifecycle.status()['running'] and lifecycle.status()['reconciling']
    await lifecycle.stop()
    assert observer.closed and observer.task.cancelled()
    assert client.handlers == [marker]
    assert not lifecycle.status()['running']
    await observer.observe(action(kicked=True))
    assert (await db.Sub.get(id=context.sub.id)).state == 1


async def test_startup_sweep_is_one_pass_without_notifications_or_auto_resume(context, monkeypatch):
    e = await engine(context, monkeypatch)
    client = Client()
    client.entities[-1001] = group(left=True)
    client.entities[-1002] = group(1002)
    monkeypatch.setattr(env, 'bot', client, raising=False)
    monkeypatch.setattr(env, 'bot_id', SELF, raising=False)
    monkeypatch.setenv('WEB_ENABLED', '1')
    monkeypatch.setattr(lifecycle, 'STARTUP_SPACING', 0)
    observer = await lifecycle.start(context.store)
    await observer.task
    assert client.lookups == [-1002, -1001]
    assert (await db.Sub.get(id=context.sub.id)).state == 0
    assert (await db.Sub.get(id=context.other.id)).state == 1
    assert not await e.history()
    assert observer.status()['startup_scan_complete']
    assert observer.status()['startup_scan'] == dict(examined=2, left=1, member=1, unknown=0)
    assert observer.status()['posting_permission_checks'] == 0
    await asyncio.sleep(0)
    assert client.lookups == [-1002, -1001]  # No recurring scan.
    await lifecycle.stop()


async def test_actual_telethon_small_group_delete_event_tracks_only_self(context):
    observer = lifecycle.ChatLifecycle(context.store, Client(), SELF)
    other = events.ChatAction.build(types.UpdateChatParticipantDelete(1001, 999, 1), self_id=SELF)
    await observer.observe(other)
    assert (await db.Sub.get(id=context.sub.id)).state == 1
    removed = events.ChatAction.build(types.UpdateChatParticipantDelete(1001, SELF, 2), self_id=SELF)
    await observer.observe(removed)
    assert (await db.Sub.get(id=context.sub.id)).state == 0
    await asyncio.sleep(0)


async def test_raw_channel_update_requires_explicit_membership_evidence(context):
    ident = utils.get_peer_id(types.PeerChannel(777))
    await db.User.create(id=ident, state=0)
    await context.store.target(ident, 'Channel', None, 'channel', 'available')
    sub = await db.Sub.create(user_id=ident, feed=context.feed)
    client = Client()
    observer = lifecycle.ChatLifecycle(context.store, client, SELF)
    client.entities[ident] = errors.ChannelPrivateError(None)
    await observer.observe(types.UpdateChannel(777))
    assert (await db.Sub.get(id=sub.id)).state == 1
    client.entities[ident] = channel(777, left=True)
    await observer.observe(types.UpdateChannel(777))
    assert (await db.Sub.get(id=sub.id)).state == 0
    assert (await context.store.target_map([ident]))[str(ident)]['membership'] == 'left'
    await asyncio.sleep(0)


async def test_stop_waits_for_observer_without_late_database_mutation(context):
    client = Client()
    entered, release = asyncio.Event(), asyncio.Event()
    async def blocked(ident):
        entered.set()
        await release.wait()
        return group(left=True)
    client.get_entity = blocked
    observer = lifecycle.ChatLifecycle(context.store, client, SELF)
    observing = asyncio.create_task(observer.observe(types.UpdateChat(1001)))
    await entered.wait()
    stopping = asyncio.create_task(observer.stop())
    await asyncio.sleep(0)
    assert observer.closed and not stopping.done()
    release.set()
    await asyncio.gather(observing, stopping)
    assert (await db.Sub.get(id=context.sub.id)).state == 1
    assert (await context.store.target_map([-1001]))['-1001']['membership'] == 'available'


async def test_startup_flood_control_ends_sweep_without_false_departures(context, monkeypatch):
    client = Client()
    client.entities[-1002] = errors.FloodWaitError(None, capture=10)
    observer = lifecycle.ChatLifecycle(context.store, client, SELF)
    monkeypatch.setattr(lifecycle, 'STARTUP_SPACING', 0)
    await observer.reconcile_once()
    assert observer.flooded and client.lookups == [-1002]
    assert (await db.Sub.get(id=context.sub.id)).state == 1
    assert (await db.Sub.get(id=context.other.id)).state == 1


async def test_lifecycle_audit_only_records_membership_transitions(context, isolate_lifecycle):
    observer = lifecycle.ChatLifecycle(context.store, Client(), SELF)
    await observer.observe(action(kicked=True))
    await observer.observe(action(kicked=True))
    await observer.observe(action(joined=True, entity=group()))
    await observer.observe(action(joined=True, entity=group()))
    calls = isolate_lifecycle.await_args_list
    assert [call.args[1] for call in calls] == ['destination.leave', 'destination.join']
    assert all(call.kwargs['source'] == 'bot' and call.kwargs['actor'] == 'Telegram' for call in calls)
    assert calls[0].kwargs['changes'][0]['before'] == 'available'
    assert calls[0].kwargs['changes'][0]['after'] == 'left'
    assert calls[1].kwargs['changes'][0]['before'] == 'left'
    assert calls[1].kwargs['changes'][0]['after'] == 'joined'
    await asyncio.sleep(0)


async def test_probe_separates_membership_and_permissions_without_refreshing_old_evidence(context):
    ident = utils.get_peer_id(types.PeerChannel(777))
    await db.User.create(id=ident, state=0)
    await context.store.target(ident, 'Old title', None, 'unknown', 'available')
    old_time = '2001-01-01T00:00:00+00:00'
    await context.store.execute('UPDATE targets SET checked_at=? WHERE id=?', (old_time, str(ident)))
    client = Client()
    client.entities[ident] = channel(777)
    observer = lifecycle.ChatLifecycle(context.store, client, SELF)
    await observer.observe(types.UpdateChannel(777))
    metadata = (await context.store.target_map([ident]))[str(ident)]
    assert metadata['membership'] == 'available' and metadata['checked_at'] == old_time
    assert metadata['kind'] == 'channel' and metadata['title'] == 'Test channel'
    assert observer.status()['posting_permission_checks'] == 0
    permissions = SimpleNamespace(participant=types.ChannelParticipantSelf(SELF, 1, NOW),
                                  is_creator=False, post_messages=False)
    client.get_permissions = AsyncMock(return_value=permissions)
    await observer.observe(types.UpdateChannel(777))
    metadata = (await context.store.target_map([ident]))[str(ident)]
    assert metadata['membership'] == 'joined' and metadata['checked_at'] != old_time
    permissions.post_messages = True
    await observer.observe(types.UpdateChannel(777))
    assert (await context.store.target_map([ident]))[str(ident)]['membership'] == 'available'
    assert observer.status()['posting_permission_checks'] == 2


async def test_unverified_member_is_joined_and_real_group_permissions_can_confirm_send(context):
    client = Client()
    client.entities[-1001] = group()
    await context.store.execute("UPDATE targets SET membership='snapshot' WHERE id='-1001'")
    observer = lifecycle.ChatLifecycle(context.store, client, SELF)
    await observer.observe(types.UpdateChat(1001))
    assert (await context.store.target_map([-1001]))['-1001']['membership'] == 'joined'
    client.get_permissions = AsyncMock(return_value=SimpleNamespace(
        participant=types.ChatParticipant(SELF, 1, NOW), is_creator=False,
        is_admin=False, has_default_permissions=True))
    await observer.observe(types.UpdateChat(1001))
    assert (await context.store.target_map([-1001]))['-1001']['membership'] == 'available'


async def test_startup_channel_probe_does_not_delay_other_private_chats(context, monkeypatch):
    entered, release = asyncio.Event(), asyncio.Event()
    async def delayed(ident):
        entered.set()
        await release.wait()
        return group(-ident)
    client = Client()
    client.get_entity = delayed
    observer = lifecycle.ChatLifecycle(context.store, client, SELF)
    monkeypatch.setattr(lifecycle, 'STARTUP_SPACING', 0)
    observer.task = asyncio.create_task(observer.reconcile_once())
    try:
        await entered.wait()
        await asyncio.wait_for(observer.observe(private(9991)), 1)
        assert (await context.store.target_map([9991]))['9991']['kind'] == 'private'
    finally:
        release.set()
        await observer.stop()
    assert not observer.locks
