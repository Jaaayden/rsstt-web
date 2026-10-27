"""Scoped, transactional recipient editing and filtered OPML export."""
from aiohttp import web
from lxml import etree
from tortoise.transactions import in_transaction
from tortoise.expressions import Subquery

from .. import db
from ..command import inner
from .service import Problem, integer, options


async def source(service, ident, principal):
    ident = integer(ident, '来源 ID', 1, 2**31 - 1)
    if not await service.scope(db.Sub.filter(feed_id=ident), principal).exists():
        raise Problem('找不到来源，或授权不包含该来源。', 404)
    return await db.Feed.get(id=ident)


async def recipients(service, feed, principal):
    archived = list(map(int, await service.store.archived_ids()))
    subs = await service.scope(db.Sub.filter(feed_id=feed.id), principal).exclude(user__state=-1).exclude(user_id__in=archived).select_related('feed', 'user')
    return {'feed_id': feed.id, 'scope': 'all' if principal['targets'] is None else 'authorized_targets',
            'items': await service.sub_data(subs)}


async def replace_recipients(service, feed, principal, values):
    mode, targets = values.get('mode'), values.get('targets')
    if mode not in ('append', 'replace') or not isinstance(targets, list) or len(targets) > 100:
        raise Problem('mode 必须为 append 或 replace；targets 最多 100 个会话。')
    # Resolve and authorize every destination before any relation mutation.
    users = {u.id: u for u in [await service.user(t, principal) for t in targets]}
    archived = list(map(int, await service.store.archived_ids()))
    if set(users) & set(archived):
        raise Problem('已归档会话不能作为新的接收会话。请先从已归档列表恢复，再重试。', 409, code='CHAT_ARCHIVED')
    for user in users.values():
        if user.state == -1:
            raise Problem('该会话已被封禁，无法添加订阅。请先在会话设置中解除封禁，再重试。', 409, code='TARGET_BANNED')
        meta = (await service.store.target_map([user.id])).get(str(user.id), {})
        if meta.get('membership') in ('left', 'banned', 'disabled'):
            raise Problem('接收会话已退出或禁用。', 409)
        await service.gateway.inspect(user.id)
    try:
        async with in_transaction():
            await db.Feed.filter(id=feed.id).select_for_update().get()
            # Stable lock ordering also protects concurrent web batches on PostgreSQL.
            for ident in sorted(users):
                user = await db.User.filter(id=ident).select_for_update().get()
                if user.state == -1:
                    raise Problem('该会话已被封禁，无法添加订阅。请先在会话设置中解除封禁，再重试。', 409, code='TARGET_BANNED')
            existing = set(await db.Sub.filter(feed_id=feed.id).values_list('user_id', flat=True))
            for ident in users.keys() - existing:
                reached, *_ = await inner.utils.check_sub_limit(ident)
                if reached:
                    raise Problem('接收会话已达到订阅上限；没有修改任何接收关系。', 409)
            defaults = {key: -100 for key in options(next(iter(users.values())))} if users else {}
            defaults['interval'] = None
            for ident in users.keys() - existing:
                await db.Sub.create(user_id=ident, feed_id=feed.id, **defaults)
            if mode == 'replace':
                await service.scope(db.Sub.filter(feed_id=feed.id), principal).exclude(user_id__in=Subquery(db.User.filter(state=-1).values('id'))).exclude(user_id__in=archived).exclude(user_id__in=list(users)).delete()
            await inner.utils.update_interval(await db.Feed.get(id=feed.id), update_tasks=False)
            committed = await db.Feed.get_or_none(id=feed.id)
    except BaseException:
        # Reconcile against committed state after rollback, including injected failures.
        await inner.utils.update_interval(feed.id)
        raise
    # Publish the in-memory schedule only after the transaction commits.
    if committed is None or committed.state == 0:
        db.EffectiveTasks.delete(feed.id)
    else:
        db.EffectiveTasks.update(feed.id, committed.interval or db.EffectiveOptions.default_interval)
    return await recipients(service, feed, principal)


async def export_filtered(service, principal, query):
    qs = service.sub_query(principal, query)
    if query.get('attention') == '1':
        qs = qs.filter(state=1, feed__error_count__gte=await service.threshold())
    if 'ids' in query:
        ids = query['ids'].split(',')
        if not 1 <= len(ids) <= 100:
            raise Problem('最多导出 100 条选中订阅。')
        ids = [integer(i, '订阅 ID', 1, 2**31 - 1) for i in ids]
        for ident in ids:
            await service.subscription(ident, principal)
        qs = qs.filter(id__in=ids)
    root = etree.Element('opml', version='2.0')
    etree.SubElement(etree.SubElement(root, 'head'), 'title').text = 'RSStT'
    body = etree.SubElement(root, 'body')
    seen = set()
    async for sub in qs.select_related('feed').order_by('id'):
        if sub.feed_id in seen:
            continue
        seen.add(sub.feed_id)
        etree.SubElement(body, 'outline', type='rss', text=sub.title or sub.feed.title,
                         title=sub.title or sub.feed.title, xmlUrl=sub.feed.link)
    return etree.tostring(root, encoding='UTF-8', xml_declaration=True)


def install(routes, service, read_body, require_admin):
    @routes.get('/api/subscriptions/opml')
    async def export(request):
        return web.Response(body=await export_filtered(service, request['principal'], request.query),
                            content_type='text/xml', headers={'Content-Disposition': 'attachment; filename="rsstt.opml"'})

    @routes.get('/api/feeds/{id}/recipients')
    async def get_recipients(request):
        feed = await source(service, request.match_info['id'], request['principal'])
        return web.json_response(await recipients(service, feed, request['principal']))

    @routes.put('/api/feeds/{id}/recipients')
    async def put_recipients(request):
        values = await read_body(request)
        async with service.mutation:
            feed = await source(service, request.match_info['id'], request['principal'])
            result = await replace_recipients(service, feed, request['principal'], values)
        await service.store.audit(request['principal']['name'], '修改来源接收者', str(feed.id))
        return web.json_response(result)

    @routes.get('/api/feeds/{id}/fetch-options')
    @routes.patch('/api/feeds/{id}/fetch-options')
    async def fetch_options(request):
        require_admin(request)
        feed = await source(service, request.match_info['id'], request['principal'])
        if request.method == 'PATCH':
            values = await read_body(request)
            ua = values.get('user_agent')
            if set(values) != {'user_agent'} or (ua is not None and (
                    not isinstance(ua, str) or len(ua) > 512 or any(ord(c) < 32 or ord(c) > 126 for c in ua))):
                raise Problem('User-Agent 应为最多 512 个可打印 ASCII 字符，不允许换行。')
            ua = ua.strip() if ua else None
            async with service.mutation:
                if ua:
                    await service.store.execute('INSERT INTO feed_fetch_options VALUES (?,?) ON CONFLICT(url) DO UPDATE SET user_agent=excluded.user_agent', (feed.link, ua))
                else:
                    await service.store.execute('DELETE FROM feed_fetch_options WHERE url=?', (feed.link,))
            await service.store.audit(request['principal']['name'], '修改来源 UA', str(feed.id))
        rows = await service.store.rows('SELECT user_agent FROM feed_fetch_options WHERE url=?', (feed.link,))
        return web.json_response({'feed_id': feed.id, 'user_agent': rows[0]['user_agent'] if rows else None,
                                  'inherits_global': not bool(rows)})
