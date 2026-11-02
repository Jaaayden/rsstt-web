"""Bounded per-destination history without Telegram text or raw request bodies.

Bot capture is opt-in through install(). Web callers pass their Store explicitly.
Audit failures degrade history but never fail an otherwise valid action.
"""
import asyncio
import json
import logging
import re
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from weakref import WeakValueDictionary

active_store = None
_degraded = False
_chat_locks = WeakValueDictionary()
PER_CHAT_LIMIT = 100
TOTAL_LIMIT = 2000
PAYLOAD_LIMIT = 4096
SNAPSHOT_LIMIT = 200
TEXT_LIMIT = 256
LOGGER = logging.getLogger('RSStT.management.chat_audit')
OPTIONS = ('interval', 'notify', 'send_mode', 'length_limit', 'link_preview',
           'display_author', 'display_via', 'display_title', 'display_entry_tags',
           'style', 'display_media')
USER_FIELDS = ('state', 'lang', 'sub_limit', *OPTIONS)
SUB_FIELDS = ('id', 'feed_id', 'title', 'tags', 'state', *OPTIONS)
FIELDS = {
    'user': frozenset((*USER_FIELDS, 'exists', 'role')),
    'subscription': frozenset((*SUB_FIELDS, 'exists')),
    'destination': frozenset(('membership', 'kind', 'exists')),
    'summary': frozenset(('subscriptions_count',)),
}
MUTATING = frozenset((
    'subscriptions.add', 'subscriptions.remove', 'subscriptions.update',
    'subscriptions.batch', 'subscriptions.import', 'subscriptions.reset',
    'settings.update', 'role.update', 'language.update', 'recipients.update',
    'destination.settings', 'destination.leave', 'destination.join', 'destination.register',
))
ACTIONS = MUTATING | frozenset((
    'subscriptions.list', 'subscriptions.export', 'subscriptions.settings',
    'destination.refresh', 'role.view', 'language.view', 'settings.view',
    'bot.start', 'bot.help', 'bot.version', 'bot.test', 'bot.inline',
    'bot.callback', 'bot.other', 'bot.lifecycle',
))
_SECRET = re.compile(
    r'\b(?:rst|rss)_[A-Za-z0-9_-]{12,}|\b\d{4,}:[A-Za-z0-9_-]{20,}'
    r'|\bBearer\s+[A-Za-z0-9._~-]+', re.I)
_SECRET_VALUE = re.compile(
    r'\b(password|passwd|token|api[_-]?key|secret|access[_-]?token)\s*[=:]\s*[^\s&]+', re.I)
_URL_CREDENTIAL = re.compile(r'(https?://)[^/@\s]+:[^/@\s]+@', re.I)


def _failure():
    global _degraded
    if not _degraded:
        LOGGER.warning('Destination history is degraded; an audit operation failed')
    _degraded = True


def mark_degraded():
    _failure()


def status():
    return {'enabled': active_store is not None, 'degraded': _degraded,
            'per_chat_limit': PER_CHAT_LIMIT, 'total_limit': TOTAL_LIMIT}


def install(store):
    global active_store
    active_store = store


def uninstall(store=None):
    global active_store
    if store is None or active_store is store:
        active_store = None


async def initialize(store):
    try:
        async with store.lock:
            await store.db.executescript('''
                CREATE TABLE IF NOT EXISTS chat_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id TEXT NOT NULL,
                    payload TEXT NOT NULL CHECK(length(CAST(payload AS BLOB)) <= 4096)
                );
                CREATE INDEX IF NOT EXISTS chat_events_chat_id_id ON chat_events(chat_id, id);
            ''')
            await store.db.commit()
        return True
    except Exception:
        _failure()
        return False


def _ident(value):
    if isinstance(value, bool) or not re.fullmatch(r'-?\d{1,16}', str(value)):
        return None
    ident = int(value)
    return str(ident) if ident and abs(ident) <= 2**53 - 1 else None


def _text(value):
    value = _SECRET.sub('[redacted]', value)
    value = _SECRET_VALUE.sub(lambda match: match[1] + '=[redacted]', value)
    value = _URL_CREDENTIAL.sub(r'\1[redacted]@', value)
    value = ''.join(char for char in value if char >= ' ' and char != '\x7f')
    return value.encode('utf-8')[:TEXT_LIMIT].decode('utf-8', errors='ignore')


def _actor(value, source):
    if ident := _ident(value):
        return ident
    if isinstance(value, str) and source in ('web', 'agent'):
        return _text(value).encode()[:64].decode(errors='ignore')
    if source == 'bot' and value in ('Telegram', 'system', 'anonymous'):
        return value
    return 'administrator' if source in ('web', 'agent') else 'anonymous'


def _value(value):
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int) and abs(value) <= 2**53 - 1:
        return value
    if isinstance(value, str):
        return _text(value)
    return None


def _row(row, fields):
    return {key: _value(row[key]) for key in fields if key in row} if row else None


async def snapshot(chat_id, action, *, store=None, subscription_ids=None, feed_id=None):
    """Only known mutations inspect bounded settings; disabled Bot does no work."""
    store = store if store is not None else active_store
    ident = _ident(chat_id)
    if store is None or ident is None or action not in MUTATING:
        return None
    try:
        from .. import db
        user = await db.User.filter(id=int(ident)).first().values(*USER_FIELDS)
        query = db.Sub.filter(user_id=int(ident))
        total = await query.count()
        if feed_id is not None:
            query = query.filter(feed_id=int(_ident(feed_id) or 0))
        if subscription_ids is not None:
            ids = list(dict.fromkeys(int(value) for value in subscription_ids if _ident(value)))
            query = query.filter(id__in=ids[:SNAPSHOT_LIMIT])
            truncated = len(ids) > SNAPSHOT_LIMIT
        else:
            truncated = False
        selected = await query.order_by('-id').limit(SNAPSHOT_LIMIT + 1).values(*SUB_FIELDS)
        result = {'user': _row(user, USER_FIELDS), 'subscriptions_count': total,
                  'subscriptions': {str(row['id']): _row(row, SUB_FIELDS) for row in selected[:SNAPSHOT_LIMIT]},
                  'truncated': truncated or len(selected) > SNAPSHOT_LIMIT}
        if action.startswith('destination.'):
            rows = await store.rows('SELECT membership,kind FROM targets WHERE id=?', (ident,))
            result['destination'] = _row(rows[0], ('membership', 'kind')) if rows else None
        return result
    except Exception:
        _failure()
        return {'truncated': True, 'failed': True}


def differences(before, after, chat_id):
    changes = []
    if before is None or after is None or before.get('failed') or after.get('failed'):
        return changes

    def compare(entity, ident, old, new):
        if (old is None) != (new is None):
            changes.append({'entity': entity, 'id': str(ident), 'field': 'exists',
                            'before': old is not None, 'after': new is not None})
        for field in sorted(FIELDS[entity] - {'exists', 'id'}):
            previous, current = (old or {}).get(field), (new or {}).get(field)
            if previous != current:
                changes.append({'entity': entity, 'id': str(ident), 'field': field,
                                'before': previous, 'after': current})

    compare('user', chat_id, before.get('user'), after.get('user'))
    if 'destination' in before or 'destination' in after:
        compare('destination', chat_id, before.get('destination'), after.get('destination'))
    old, new = before.get('subscriptions', {}), after.get('subscriptions', {})
    for ident in sorted(old.keys() | new.keys(), key=int):
        # A capped sample changing does not prove deletion outside its window.
        if ident not in old and before.get('truncated'):
            continue
        if ident not in new and after.get('truncated'):
            continue
        compare('subscription', ident, old.get(ident), new.get(ident))
    if before['subscriptions_count'] != after['subscriptions_count']:
        changes.append({'entity': 'summary', 'id': str(chat_id), 'field': 'subscriptions_count',
                        'before': before['subscriptions_count'], 'after': after['subscriptions_count']})
    return changes


def _safe_changes(changes):
    result, truncated = [], False
    if not isinstance(changes, (list, tuple)):
        return result, changes is not None
    for change in changes[:100]:
        if not isinstance(change, dict):
            truncated = True
            continue
        entity, field, ident = change.get('entity'), change.get('field'), _ident(change.get('id'))
        if entity not in FIELDS or field not in FIELDS[entity] or ident is None:
            truncated = True
            continue
        values = [change.get('before'), change.get('after')]
        if any(not (value is None or isinstance(value, (str, int, bool))) for value in values):
            truncated = True
            continue
        result.append({'entity': entity, 'id': ident, 'field': field,
                       'before': _value(values[0]), 'after': _value(values[1])})
        if any(isinstance(value, str) and _text(value) != value for value in values):
            truncated = True
    return result, truncated or len(changes) > 100


async def record(chat_id, action, *, source='web', actor=None, outcome='completed',
                 changes=None, before=None, after=None, truncated=False, store=None):
    store = store if store is not None else active_store
    ident = _ident(chat_id)
    if store is None or ident is None:
        return False
    try:
        if changes is None:
            changes = differences(before, after, ident)
        safe_changes, limited = _safe_changes(changes)
        payload = {'at': datetime.now(timezone.utc).isoformat(),
                   'source': source if source in ('bot', 'web', 'agent') else 'web',
                   'actor': _actor(actor, source), 'action': action if action in ACTIONS else 'bot.other',
                   'outcome': outcome if outcome in ('completed', 'denied', 'error') else 'error',
                   'changes': [], 'truncated': bool(truncated or limited or
                       (before or {}).get('truncated') or (after or {}).get('truncated'))}
        for change in safe_changes:
            payload['changes'].append(change)
            if len(json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode()) > PAYLOAD_LIMIT:
                payload['changes'].pop()
                payload['truncated'] = True
                break
        raw = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
        async with store.lock:
            try:
                await store.db.execute('INSERT INTO chat_events(chat_id,payload) VALUES (?,?)', (ident, raw))
                await store.db.execute('DELETE FROM chat_events WHERE chat_id=? AND id NOT IN '
                                       '(SELECT id FROM chat_events WHERE chat_id=? ORDER BY id DESC LIMIT ?)',
                                       (ident, ident, PER_CHAT_LIMIT))
                await store.db.execute('DELETE FROM chat_events WHERE id NOT IN '
                                       '(SELECT id FROM chat_events ORDER BY id DESC LIMIT ?)', (TOTAL_LIMIT,))
                await store.db.commit()
            except BaseException:
                await store.db.rollback()
                raise
        return True
    except Exception:
        _failure()
        return False


@dataclass
class AuditCall:
    store: object
    chat_id: str
    action: str
    actor: object
    source: str
    before: object
    subscription_ids: object = None
    feed_id: object = None
    outcome: str = 'completed'
    lock: object = None
    finished: bool = False


async def begin(chat_id, action, *, actor=None, source='web', store=None, subscription_ids=None, feed_id=None):
    store = store if store is not None else active_store
    ident = _ident(chat_id)
    if store is None or ident is None:
        return None
    lock = None
    if action in MUTATING:
        key = (id(store), ident)
        lock = _chat_locks.get(key)
        if lock is None:
            lock = _chat_locks[key] = asyncio.Lock()
        await lock.acquire()
    try:
        before = await snapshot(ident, action, store=store, subscription_ids=subscription_ids, feed_id=feed_id)
        return AuditCall(store, ident, action, actor, source, before, subscription_ids, feed_id, lock=lock)
    except BaseException:
        if lock is not None:
            lock.release()
        raise


async def finish(call, outcome=None):
    if call is None or call.finished:
        return False
    call.finished = True
    try:
        if call.source == 'bot' and active_store is not call.store:
            return False
        after = await snapshot(call.chat_id, call.action, store=call.store,
                               subscription_ids=call.subscription_ids, feed_id=call.feed_id)
        return await record(call.chat_id, call.action, actor=call.actor, source=call.source,
                            outcome=outcome or call.outcome, before=call.before, after=after, store=call.store)
    finally:
        if call.lock is not None:
            call.lock.release()
            call.lock = None


@asynccontextmanager
async def audit_call(chat_id, action, *, actor=None, source='web', store=None,
                     subscription_ids=None, feed_id=None):
    call = await begin(chat_id, action, actor=actor, source=source, store=store,
                       subscription_ids=subscription_ids, feed_id=feed_id)
    try:
        yield call
    except BaseException as error:
        outcome = 'denied' if getattr(error, 'status', None) in (401, 403) or type(error).__name__ == 'StopPropagation' else 'error'
        await finish(call, outcome)
        raise
    else:
        await finish(call)


async def events(store, chat_id, page=1, size=20):
    ident = _ident(chat_id)
    page, size = max(1, min(int(page), 100000)), max(1, min(int(size), PER_CHAT_LIMIT))
    result = {'items': [], 'total': 0, 'page': page, 'size': size, 'degraded': _degraded,
              'retention': {'per_chat': PER_CHAT_LIMIT, 'total': TOTAL_LIMIT, 'history': 'recorded_only'}}
    if ident is None:
        return result
    try:
        count = await store.rows('SELECT COUNT(*) AS total FROM chat_events WHERE chat_id=?', (ident,))
        rows = await store.rows('SELECT id,payload FROM chat_events WHERE chat_id=? ORDER BY id DESC LIMIT ? OFFSET ?',
                                (ident, size, (page - 1) * size))
        result.update(total=count[0]['total'], items=[dict(id=row['id'], **json.loads(row['payload'])) for row in rows])
    except Exception:
        _failure()
    result['degraded'] = _degraded
    return result


def describe(event, handler, chat_id, *, is_callback=False):
    """Extract fixed action identifiers and numeric IDs; no raw text is retained."""
    sub_ids, target = None, chat_id
    raw = getattr(event, 'data', b'') if is_callback else getattr(event, 'raw_text', '')
    if isinstance(raw, bytes):
        raw = raw[:512].decode('utf-8', errors='ignore')
    raw = raw[:1024] if isinstance(raw, str) else ''
    head = raw.split(None, 1)[0].split('@', 1)[0] if raw else ''
    callback = raw.split('%', 1)[0].split('|', 1)[0] if is_callback else ''
    key = callback.split('=', 1)[0] if is_callback else head.lstrip('/')
    read = {'start': 'bot.start', 'help': 'bot.help', 'version': 'bot.version', 'test': 'bot.test',
            'list': 'subscriptions.list', 'get_list_page': 'subscriptions.list', 'export': 'subscriptions.export',
            'lang': 'language.view', 'user_info': 'role.view', 'set': 'subscriptions.settings',
            'get_set_page': 'subscriptions.settings', 'set_default': 'settings.view',
            'get_unsub_page': 'subscriptions.settings', 'get_activate_page': 'subscriptions.settings',
            'get_deactivate_page': 'subscriptions.settings'}
    action = read.get(key, 'bot.callback' if is_callback else 'bot.other')
    mutations = {'sub': 'subscriptions.add', 'add': 'subscriptions.add', 'unsub': 'subscriptions.remove',
                 'remove': 'subscriptions.remove', 'set_title': 'subscriptions.update',
                 'set_interval': 'subscriptions.update', 'set_hashtags': 'subscriptions.update',
                 'set_lang': 'language.update', 'set_user': 'role.update', 'set_sub_limit': 'settings.update',
                 'reset_sub_limit': 'settings.update', 'set_option': 'settings.update',
                 'reset': 'subscriptions.reset', 'reset_all': 'subscriptions.reset',
                 'activate_sub': 'subscriptions.update', 'deactivate_sub': 'subscriptions.update',
                 'activate_all_subs': 'subscriptions.batch', 'deactivate_all_subs': 'subscriptions.batch',
                 'del_subs_title': 'subscriptions.update'}
    if key in mutations:
        action = mutations[key]
    if is_callback and key == 'unsub_all':
        action = 'subscriptions.remove'
    if not is_callback and key in ('unsub_all', 'remove_all', 'activate_subs', 'deactivate_subs', 'import'):
        action = 'subscriptions.settings'  # These first show a chooser or confirmation.
    if is_callback and key in ('set', 'set_default') and ',' in callback:
        action = 'destination.settings' if key == 'set_default' else 'subscriptions.update'
    if is_callback and key == 'set_default' and '=' in callback:
        action = 'destination.settings'
    if handler == 'opml_import':
        action = 'subscriptions.import'
    elif handler == 'cmd_sub':
        action = 'subscriptions.add'  # Bare/replied URL still means subscribe.
    if is_callback and key in ('set_user', 'reset_sub_limit'):
        value = callback.partition('=')[2].split(',', 1)[0]
        target = _ident(value) or target
    elif not is_callback and key in ('set_sub_limit', 'user_info'):
        parts = raw.split(None, 2)
        if len(parts) > 1:
            target = _ident(parts[1]) or target
    if is_callback and key in ('set', 'reset', 'unsub', 'activate_sub', 'deactivate_sub'):
        value = callback.partition('=')[2].split(',', 1)[0]
        sub_ids = [int(value)] if _ident(value) else None
    elif not is_callback and key in ('set_title', 'set_interval', 'set_hashtags'):
        parts = raw.split()
        index = 2 if len(parts) > 1 and parts[1].startswith(('@', '-100', '+')) else 1
        if len(parts) > index:
            value = _ident(parts[index])
            if value and int(value) > 0:
                sub_ids = [int(value)]
            elif parts[index] == 'default':
                action = 'destination.settings'
    return action, sub_ids, target
