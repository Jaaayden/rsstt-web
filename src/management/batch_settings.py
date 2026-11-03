"""Batch counterpart of everything the console can change on one subscription.

A request carries only the settings the user touched; a key that is absent stays as it is on every
selected subscription. The values mean exactly what they mean in `PATCH /api/subscriptions/{id}`
(`-100` follows the chat default, `null` clears a title, tags or interval, ...), because they go
through the same validation and the same update.

Three groups, in the order they are applied to each subscription:
  * its own settings (`SUB_PATCH_KEYS`: title, hashtags, interval, length limit, every message option, state);
  * settings of the feed behind it (`FEED_KEYS`: User-Agent, proxy; administrators only), applied once per feed;
  * its recipients (`RECIPIENT_KEYS`): chats to add to, or to remove from, the feed, once per feed.
"""
import logging

from .. import db
from . import feed_options
from .service import Problem, SUB_PATCH_KEYS, chat_id
from .subscriptions import replace_recipients, source

LOGGER = logging.getLogger('RSStT.management')
FEED_KEYS = ('user_agent', 'proxy')
RECIPIENT_KEYS = ('add_recipients', 'remove_recipients')
SETTINGS_KEYS = (*SUB_PATCH_KEYS, *FEED_KEYS, *RECIPIENT_KEYS)
GROUPS = {'subscription': SUB_PATCH_KEYS, 'fetch_options': FEED_KEYS, 'recipients': RECIPIENT_KEYS}


def recipient_list(service, principal, changes, key):
    chats = changes.get(key, [])
    if not isinstance(chats, list) or len(chats) > 100:
        raise Problem('接收会话最多 100 个。')
    chats = list(dict.fromkeys(chat_id(chat) for chat in chats))
    for chat in chats:
        service.allowed(principal, chat)
    return chats


def validate(service, principal, changes, administrator):
    """Check the whole request before anything is written. Returns what to apply, per group."""
    if not isinstance(changes, dict) or not changes:
        raise Problem('请至少选择一项要修改的设置。')
    if set(changes) - set(SETTINGS_KEYS):
        raise Problem('包含不支持的设置项。')
    plan = {}
    own = {key: changes[key] for key in SUB_PATCH_KEYS if key in changes}
    if own:
        service.clean_patch(own, True)
        plan['subscription'] = own
    feed = {key: changes[key] for key in FEED_KEYS if key in changes}
    if feed:
        if not administrator:
            raise Problem('此操作需要管理台管理员权限。', 403)
        try:
            if 'user_agent' in feed:
                feed['user_agent'] = feed_options.check_user_agent(feed['user_agent'])
        except ValueError:
            raise Problem(feed_options.USER_AGENT_INVALID) from None
        if feed.get('proxy') is not None:
            try:
                feed['proxy'] = feed_options.check(feed['proxy'])
            except ValueError:
                raise Problem(feed_options.INVALID, code='INVALID_PROXY') from None
        plan['fetch_options'] = feed
    add = recipient_list(service, principal, changes, 'add_recipients')
    remove = recipient_list(service, principal, changes, 'remove_recipients')
    if set(add) & set(remove):
        raise Problem('同一个会话不能同时添加和移除。')
    if add or remove:
        plan['recipients'] = {'add': add, 'remove': remove}
    if not plan:
        raise Problem('请至少选择一项要修改的设置。')
    return plan


async def apply_feed(service, feed, principal, values):
    if 'user_agent' in values:
        await feed_options.save_user_agent(service.store, feed.link, values['user_agent'])
    if 'proxy' in values:
        await feed_options.save_proxy(service.store, feed.link, values['proxy'])


async def apply_recipients(service, feed, principal, values):
    if values['add']:
        await replace_recipients(service, feed, principal, {'mode': 'append', 'targets': values['add']})
    if values['remove']:
        subs = await service.scope(db.Sub.filter(feed_id=feed.id, user_id__in=values['remove']), principal).select_related('feed', 'user')
        for sub in subs:
            await service.delete(sub)


def failure(error):
    if isinstance(error, Problem):
        return {'error': error.message, 'code': error.code, 'status': error.status}
    LOGGER.exception('Batch settings failed unexpectedly', exc_info=error)
    return {'error': '保存失败，请刷新后重试。', 'code': 'INTERNAL_ERROR', 'status': 500}


async def apply(service, principal, subs, plan):
    """Apply the plan to every subscription; a failure on one never stops the others.

    The subscription's own settings go first, one by one. Feed settings and recipients follow once per
    feed (recipients last, since removing a chat deletes its subscription), and every selected
    subscription of that feed reports the outcome. Each result lists the groups that were saved, so a
    partly failed item says what did go through."""
    applied = {sub.id: [] for sub in subs}
    errors = {}
    if 'subscription' in plan:
        for sub in subs:
            try:
                await service.update_sub(sub, plan['subscription'], principal)
                applied[sub.id].append('subscription')
            except Exception as error:
                errors.setdefault(sub.id, failure(error))
    for group, run in (('fetch_options', apply_feed), ('recipients', apply_recipients)):
        if group not in plan:
            continue
        outcome = {}  # feed id -> None, or the failure
        for sub in subs:
            if sub.feed_id not in outcome:
                try:
                    await run(service, await source(service, sub.feed_id, principal), principal, plan[group])
                    outcome[sub.feed_id] = None
                except Exception as error:
                    outcome[sub.feed_id] = failure(error)
            if outcome[sub.feed_id] is None:
                applied[sub.id].append(group)
            else:
                errors.setdefault(sub.id, outcome[sub.feed_id])
    return [{'id': sub.id, 'ok': sub.id not in errors, **errors.get(sub.id, {}), 'applied': applied[sub.id]} for sub in subs]
