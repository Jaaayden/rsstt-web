"""Observe the existing bot client; never start a Telegram client or send messages.

Only explicit self-membership changes, full entity flags and the precise
UserNotParticipant RPC error establish departure. Private contact establishes
``known``, not permission to send. A one-off, serial startup sweep fills historical
gaps; there is no periodic scan. Ambiguous failures never establish departure
or a new sending-permission check. A self-join is recorded as ``joined``.
"""
import asyncio
import contextlib
import logging
import os
from collections import OrderedDict
from weakref import WeakValueDictionary

from telethon import errors, events, utils
from telethon.tl import types

from .. import db, env
from ..command.inner import utils as subscription_utils
from . import chat_audit, notifications

LOGGER = logging.getLogger('RSStT.management.chat_lifecycle')
RPC_TIMEOUT = 10
BATCH_SIZE = 32
STARTUP_SPACING = 0.25
PRIVATE_CACHE_SIZE = 512
_active = None


def _profile(entity, previous, ident, kind_hint=None):
    kind = kind_hint or previous.get('kind', 'unknown')
    if isinstance(entity, types.User):
        kind = 'private'
    elif isinstance(entity, (types.Chat, types.ChatForbidden)):
        kind = 'group'
    elif isinstance(entity, (types.Channel, types.ChannelForbidden)):
        if entity.broadcast:
            kind = 'channel'
        elif entity.megagroup:
            kind = 'group'
    title = utils.get_display_name(entity) if entity is not None else ''
    username = getattr(entity, 'username', None) if entity is not None else previous.get('username')
    if getattr(entity, 'min', False) and username is None:
        username = previous.get('username')
    return title or previous.get('title') or str(ident), username, kind


def _departed(entity):
    if isinstance(entity, (types.Channel, types.Chat)) and entity.left:
        return True
    # Migrated basic groups are not treated as dissolved groups.
    return isinstance(entity, types.Chat) and entity.deactivated and not entity.migrated_to


def _participant_left(participant):
    return isinstance(participant, types.ChannelParticipantLeft) or (
        isinstance(participant, types.ChannelParticipantBanned)
        and (participant.left or participant.banned_rights.view_messages)
    )


def _can_send(entity, permissions):
    if permissions is None:
        return None
    if getattr(permissions, 'is_creator', False):
        return True
    if isinstance(entity, (types.Channel, types.ChannelForbidden)) and entity.broadcast:
        return bool(getattr(permissions, 'post_messages', False))
    if isinstance(entity, (types.Chat, types.Channel)):
        if getattr(permissions, 'is_admin', False):
            return True
        if not getattr(permissions, 'has_default_permissions', False):
            return False
        restrictions = getattr(entity, 'default_banned_rights', None)
        return not (getattr(restrictions, 'send_messages', False)
                    or getattr(restrictions, 'send_plain', False))
    return None


async def mark_departed(store, ident):
    """Keep the account/relationships and pause enabled subscriptions exactly once."""
    if not isinstance(ident, int) or ident >= 0:
        return False
    user = await db.User.get_or_none(id=ident)
    if user is None:
        return False
    paused = await db.Sub.filter(user_id=ident, state=1).exists()
    if paused:
        await subscription_utils.activate_or_deactivate_all_subs(ident, activate=False)
    previous = (await store.target_map([ident])).get(str(ident), {})
    changed = previous.get('membership') != 'left'
    if changed:
        await store.target(ident, *_profile(None, previous, ident), 'left')
        await chat_audit.record(ident, 'destination.leave', source='bot', actor='Telegram',
                                changes=[{'entity': 'destination', 'id': str(ident), 'field': 'membership',
                                          'before': previous.get('membership'), 'after': 'left'}])
    return changed or paused


class ChatLifecycle:
    def __init__(self, store, client, self_id):
        self.store, self.client, self.self_id = store, client, self_id
        self.closed = False
        self.locks = WeakValueDictionary()
        self.private_seen = OrderedDict()
        self.task = None
        self.flooded = False
        self.scan_complete = False
        self.scan_counts = dict(examined=0, left=0, member=0, unknown=0)
        self.permission_checks = 0
        self.builders = (
            events.ChatAction(),
            events.Raw(types=(types.UpdateChannelParticipant, types.UpdateChannel, types.UpdateChat)),
            events.NewMessage(incoming=True, func=lambda event: event.is_private),
        )

    def attach(self):
        for builder in self.builders:
            self.client.add_event_handler(self.observe, builder)
        self.task = asyncio.create_task(self.reconcile_once())

    def status(self):
        return {'running': not self.closed,
                'reconciling': bool(self.task and not self.task.done()),
                'startup_scan_complete': self.scan_complete,
                'startup_scan_deferred': self.flooded,
                'startup_scan': dict(self.scan_counts),
                'posting_permission_checks': self.permission_checks,
                'cached_private_chats': len(self.private_seen)}

    async def stop(self):
        self.closed = True
        for builder in self.builders:
            self.client.remove_event_handler(self.observe, builder)
        if self.task:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task
        # Do not cancel Telethon dispatch tasks: its original command handlers
        # must still run. Wait for our bounded in-flight observer before DB close.
        for lock in tuple(self.locks.values()):
            async with lock:
                pass
        self.private_seen.clear()

    def _chat_lock(self, ident):
        lock = self.locks.get(ident)
        if lock is None:
            lock = self.locks[ident] = asyncio.Lock()
        return lock

    async def _metadata(self, ident, entity, membership, *, force=False, kind_hint=None):
        previous = (await self.store.target_map([ident])).get(str(ident), {})
        profile = _profile(entity, previous, ident, kind_hint)
        if force or (*profile, membership) != (
            previous.get('title'), previous.get('username'), previous.get('kind'), previous.get('membership')
        ):
            await self.store.target(ident, *profile, membership)

    async def _joined(self, ident, entity=None, *, announce=True, create=True, kind_hint=None):
        if create:
            await db.User.get_or_create(id=ident, defaults={'lang': 'null'})
        elif not await db.User.filter(id=ident).exists():
            return
        if not self.closed:
            previous = (await self.store.target_map([ident])).get(str(ident), {}).get('membership')
            await self._metadata(ident, entity, 'joined', kind_hint=kind_hint)
            if previous != 'joined':
                await chat_audit.record(ident, 'destination.join', source='bot', actor='Telegram',
                                        changes=[{'entity': 'destination', 'id': str(ident), 'field': 'membership',
                                                  'before': previous, 'after': 'joined'}])
            if announce:
                await notifications.user_seen(ident)

    async def _get_entity(self, ident):
        return await asyncio.wait_for(self.client.get_entity(ident), RPC_TIMEOUT)

    async def _unverified_member(self, ident, entity):
        previous = (await self.store.target_map([ident])).get(str(ident), {})
        if previous.get('membership') == 'available':
            # Refresh authoritative identity/type without rewriting the time of
            # the last successful permission check or claiming a new one.
            profile = _profile(entity, previous, ident)
            if profile != (previous.get('title'), previous.get('username'), previous.get('kind')):
                await self.store.execute('UPDATE targets SET title=?,username=?,kind=? WHERE id=?',
                                         (*profile, str(ident)))
        else:
            await self._metadata(ident, entity, 'joined', force=True)

    async def _probe(self, ident):
        if not await db.User.filter(id=ident).exists():
            return
        entity, member_evidence = None, False
        try:
            entity = await self._get_entity(ident)
            if self.closed:
                return
            if _departed(entity):
                await mark_departed(self.store, ident)
                return 'left'
            member_evidence = isinstance(entity, (types.Chat, types.Channel)) and not getattr(entity, 'min', False)
            permissions = await asyncio.wait_for(self.client.get_permissions(entity, 'me'), RPC_TIMEOUT)
            if self.closed:
                return
            if _participant_left(getattr(permissions, 'participant', None)):
                await mark_departed(self.store, ident)
                return 'left'
            if permissions is not None:
                self.permission_checks += 1
            can_send = _can_send(entity, permissions)
            if can_send is not None:
                await self._metadata(ident, entity, 'available' if can_send else 'joined', force=True)
                return 'member'
        except errors.UserNotParticipantError:
            if not self.closed:
                await mark_departed(self.store, ident)
                return 'left'
        except errors.FloodWaitError:
            self.flooded = True
            LOGGER.warning('Chat membership sweep deferred by Telegram flood control')
        except (errors.RPCError, OSError, asyncio.TimeoutError, ValueError, TypeError):
            # In particular, ChannelPrivate/ChatAdminRequired are not evidence
            # that the bot left; retain the last known state and subscriptions.
            pass
        if member_evidence and not self.closed:
            await self._unverified_member(ident, entity)
            return 'member'
        return 'unknown' if not self.closed else None

    async def reconcile_once(self):
        after = None
        try:
            while not self.closed:
                query = db.User.filter(id__lt=0)
                if after is not None:
                    query = query.filter(id__gt=after)
                ids = await query.order_by('id').limit(BATCH_SIZE).values_list('id', flat=True)
                if not ids:
                    self.scan_complete = True
                    return
                for ident in ids:
                    async with self._chat_lock(ident):
                        if self.closed:
                            return
                        outcome = await self._probe(ident)
                        if outcome is not None:
                            self.scan_counts['examined'] += 1
                            self.scan_counts[outcome] += 1
                    if self.flooded:
                        return
                    await asyncio.sleep(STARTUP_SPACING)
                after = ids[-1]
        except asyncio.CancelledError:
            raise
        except Exception as error:
            LOGGER.warning('Chat membership sweep incomplete (%s)', type(error).__name__)

    async def _private(self, event, ident):
        entity = event.chat or event.sender
        signature = _profile(entity, {}, ident, 'private')[:2] if entity is not None else None
        if ident in self.private_seen:
            previous = self.private_seen.pop(ident)
            self.private_seen[ident] = previous
            if signature is None or signature == previous:
                return
        await db.User.get_or_create(id=ident, defaults={'lang': 'null'})
        metadata = (await self.store.target_map([ident])).get(str(ident), {})
        if entity is None and not metadata:
            try:
                entity = await asyncio.wait_for(event.get_chat(), RPC_TIMEOUT)
            except (errors.RPCError, OSError, asyncio.TimeoutError, ValueError):
                pass
        if self.closed:
            return
        title, username, _ = _profile(entity, metadata, ident, 'private')
        membership = metadata.get('membership', 'known')
        if membership in ('unknown', 'snapshot', 'left'):
            membership = 'known'
        await self._metadata(ident, entity, membership, kind_hint='private')
        await notifications.user_seen(ident)
        self.private_seen[ident] = (title, username)
        while len(self.private_seen) > PRIVATE_CACHE_SIZE:
            self.private_seen.popitem(last=False)

    async def observe(self, event):
        if self.closed:
            return
        private = isinstance(event, events.NewMessage.Event)
        if private:
            if not event.is_private or event.out or not event.chat_id or event.chat_id <= 0 or event.chat_id == self.self_id:
                return
            ident = event.chat_id
        elif isinstance(event, events.ChatAction.Event):
            if self.self_id not in (event.user_ids or ()):
                return
            # Raw handles this update including non-empty banned participants;
            # do not process its derived ChatAction a second time.
            if isinstance(getattr(event, 'original_update', None), types.UpdateChannelParticipant):
                return
            ident = event.chat_id
        elif isinstance(event, types.UpdateChannelParticipant):
            if event.user_id != self.self_id:
                return
            ident = utils.get_peer_id(types.PeerChannel(event.channel_id))
        elif isinstance(event, types.UpdateChannel):
            ident = utils.get_peer_id(types.PeerChannel(event.channel_id))
        elif isinstance(event, types.UpdateChat):
            ident = utils.get_peer_id(types.PeerChat(event.chat_id))
        else:
            return
        if not private and (not ident or ident >= 0):
            return
        async with self._chat_lock(ident):
            if self.closed:
                return
            try:
                if private:
                    await self._private(event, ident)
                elif isinstance(event, events.ChatAction.Event):
                    if event.user_left or event.user_kicked:
                        await mark_departed(self.store, ident)
                    elif event.user_added or event.user_joined or event.created:
                        entity = event.chat
                        if entity is None:
                            with contextlib.suppress(errors.RPCError, OSError, asyncio.TimeoutError, ValueError):
                                entity = await self._get_entity(ident)
                        hint = 'group' if isinstance(event._chat_peer, types.PeerChat) else None
                        await self._joined(ident, entity, kind_hint=hint)
                elif isinstance(event, types.UpdateChannelParticipant):
                    new = event.new_participant
                    if _participant_left(new) or (new is None and event.prev_participant is not None):
                        await mark_departed(self.store, ident)
                    elif new is not None:
                        entity = getattr(event, '_entities', {}).get(ident)
                        if entity is None:
                            with contextlib.suppress(errors.RPCError, OSError, asyncio.TimeoutError, ValueError):
                                entity = await self._get_entity(ident)
                        if event.prev_participant is None:
                            await self._joined(ident, entity)
                        elif isinstance(new, types.ChannelParticipantBanned):
                            if await db.User.filter(id=ident).exists():
                                await self._metadata(ident, entity, 'joined', force=True)
                        else:
                            await self._probe(ident)
                else:
                    await self._probe(ident)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                # Keep the original Telegram command chain running on observer
                # failure, without logging private titles, message text or URLs.
                LOGGER.warning('Chat lifecycle observation failed (%s)', type(error).__name__)


async def start(store):
    """Called only by the live Web service, after notification baseline setup."""
    global _active
    await stop()
    if os.environ.get('WEB_ENABLED', '').lower() not in ('1', 'true', 'yes'):
        return None
    client, self_id = getattr(env, 'bot', None), getattr(env, 'bot_id', None)
    if client is None or type(self_id) is not int or self_id <= 0:
        return None
    _active = ChatLifecycle(store, client, self_id)
    _active.attach()
    return _active


async def stop():
    global _active
    observer, _active = _active, None
    if observer is not None:
        await observer.stop()


def status():
    if _active is not None:
        return _active.status()
    return {'running': False, 'reconciling': False, 'startup_scan_complete': False,
            'startup_scan_deferred': False, 'cached_private_chats': 0,
            'startup_scan': dict(examined=0, left=0, member=0, unknown=0),
            'posting_permission_checks': 0}
