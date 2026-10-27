"""Attribute authenticated management changes to affected chats without logging requests."""
import sys
from contextlib import AsyncExitStack, asynccontextmanager

from .. import db
from .service import chat_id, integer


async def affected(request, service):
    resource = request.match_info.route.resource
    path = resource.canonical if resource else ''
    method = request.method
    ident = request.match_info.get('id')
    if path.startswith('/api/targets/{id}/') or path == '/api/targets/{id}':
        actions = {
            ('PATCH', '/api/targets/{id}'): 'settings.update',
            ('PATCH', '/api/targets/{id}/role'): 'role.update',
            ('POST', '/api/targets/{id}/leave'): 'destination.leave',
            ('POST', '/api/targets/{id}/refresh'): 'destination.refresh',
            ('POST', '/api/targets/{id}/opml'): 'subscriptions.add',
        }
        action = actions.get((method, path))
        return (action, [chat_id(ident)], None) if action else (None, [], None)
    if path == '/api/targets' and method == 'POST':
        values = await request.json()
        return 'destination.register', [chat_id(values.get('id'))], None
    if path == '/api/subscriptions' and method == 'POST':
        values = await request.json()
        return 'subscriptions.add', [chat_id(values.get('target'))], None
    if path == '/api/subscriptions/{id}' and method in ('PATCH', 'DELETE'):
        sub = await service.subscription(ident, request['principal'])
        return 'subscriptions.update' if method == 'PATCH' else 'subscriptions.remove', [sub.user_id], sub.feed_id
    if path == '/api/subscriptions/batch' and method == 'POST':
        values = await request.json()
        ids = values.get('ids')
        if not isinstance(ids, list) or not 1 <= len(ids) <= 100:
            return None, [], None
        ids = [integer(value, '订阅 ID', 1, 2**31 - 1) for value in ids]
        targets = await service.scope(db.Sub.filter(id__in=ids), request['principal']).values_list('user_id', flat=True)
        return 'subscriptions.batch', targets, None
    if path in ('/api/feeds/{id}/recipients', '/api/feeds/{id}/fetch-options') and method in ('PUT', 'PATCH'):
        feed_id = integer(ident, '来源 ID', 1, 2**31 - 1)
        targets = await service.scope(db.Sub.filter(feed_id=feed_id), request['principal']).distinct().limit(200).values_list('user_id', flat=True)
        if path.endswith('/recipients'):
            values = await request.json()
            additions = values.get('targets')
            if isinstance(additions, list) and len(additions) <= 100:
                targets.extend(chat_id(value) for value in additions)
        return 'recipients.update' if path.endswith('/recipients') else 'settings.update', targets, feed_id
    return None, [], None


@asynccontextmanager
async def trace(request, service, store):
    from . import chat_audit
    contexts = AsyncExitStack()
    if request.method not in ('POST', 'PATCH', 'PUT', 'DELETE'):
        yield
        return
    # Audit discovery and persistence must never block an existing operation.
    try:
        action, targets, feed_id = await affected(request, service)
        principal = request['principal']
        if action:
            targets = sorted(set(targets))[:200]
            for target in targets:
                service.allowed(principal, target)
                await contexts.enter_async_context(chat_audit.audit_call(
                    target, action, actor=principal['name'],
                    source='agent' if principal['kind'] == 'token' else 'web',
                    store=store, feed_id=feed_id))
    except Exception:
        # Close any entered contexts as failures, without propagating audit errors.
        await contexts.__aexit__(*sys.exc_info())
        contexts = AsyncExitStack()
    except BaseException:
        await contexts.__aexit__(*sys.exc_info())
        raise
    async with contexts:
        yield
