"""Scoped, transactional recipient editing and filtered OPML export."""
import time

from aiohttp import web
from lxml import etree
from tortoise.transactions import in_transaction
from tortoise.expressions import Subquery

from .. import db, web as upstream_web
from ..command import inner
from . import feed_options
from .service import Problem, integer, options


async def source(service, ident, principal):
    ident = integer(ident, '来源 ID', 1, 2**31 - 1)
    if not await service.scope(db.Sub.filter(feed_id=ident), principal).exists():
        raise Problem('找不到来源，或授权不包含该来源。', 404)
    return await db.Feed.get(id=ident)


async def recipients(service, feed, principal):
    departed = await service.store.departed_ids()
    subs = await service.scope(db.Sub.filter(feed_id=feed.id), principal).exclude(user__state=-1).exclude(user_id__in=departed).select_related('feed', 'user')
    return {'feed_id': feed.id, 'scope': 'all' if principal['targets'] is None else 'authorized_targets',
            'items': await service.sub_data(subs)}


async def replace_recipients(service, feed, principal, values):
    mode, targets = values.get('mode'), values.get('targets')
    if mode not in ('append', 'replace') or not isinstance(targets, list) or len(targets) > 100:
        raise Problem('mode 必须为 append 或 replace；targets 最多 100 个会话。')
    # Resolve and authorize every destination before any relation mutation.
    users = {u.id: u for u in [await service.user(t, principal) for t in targets]}
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
                departed = await service.store.departed_ids()
                await service.scope(db.Sub.filter(feed_id=feed.id), principal).exclude(
                    user_id__in=Subquery(db.User.filter(state=-1).values('id'))
                ).exclude(user_id__in=departed).exclude(user_id__in=list(users)).delete()
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
    qs = await service.sub_query(principal, query)
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

    def options_view(feed, user_agent):
        return {'feed_id': feed.id, 'user_agent': user_agent, 'inherits_global': user_agent is None,
                'proxy': feed_options.describe(feed.link)}

    def clean_proxy(value):
        """None = follow the global proxy rules; 'direct' = no proxy; otherwise a validated proxy URL."""
        if value is None:
            return None
        try:
            return feed_options.check(value)
        except ValueError:
            raise Problem(feed_options.INVALID, code='INVALID_PROXY') from None

    @routes.get('/api/feeds/{id}/fetch-options')
    @routes.patch('/api/feeds/{id}/fetch-options')
    async def fetch_options(request):
        require_admin(request)
        feed = await source(service, request.match_info['id'], request['principal'])
        if request.method == 'PATCH':
            values = await read_body(request)
            if not values or set(values) - {'user_agent', 'proxy'}:
                raise Problem('包含不支持的设置项。')
            ua = values.get('user_agent')
            if 'user_agent' in values and ua is not None and (
                    not isinstance(ua, str) or len(ua) > 512 or any(ord(c) < 32 or ord(c) > 126 for c in ua)):
                raise Problem('User-Agent 应为最多 512 个可打印 ASCII 字符，不允许换行。')
            proxy = clean_proxy(values.get('proxy')) if 'proxy' in values else None
            async with service.mutation:
                if 'user_agent' in values:
                    ua = ua.strip() if ua else None
                    if ua:
                        await service.store.execute('INSERT INTO feed_fetch_options VALUES (?,?) ON CONFLICT(url) DO UPDATE SET user_agent=excluded.user_agent', (feed.link, ua))
                    else:
                        await service.store.execute('DELETE FROM feed_fetch_options WHERE url=?', (feed.link,))
                    await service.store.audit(request['principal']['name'], '修改来源 UA', str(feed.id))
                if 'proxy' in values:
                    await feed_options.save_proxy(service.store, feed.link, proxy)
                    # Never record the proxy address: it may contain credentials.
                    await service.store.audit(request['principal']['name'], '修改来源代理', f'{feed.id} · {feed_options.describe(feed.link)["mode"]}')
        rows = await service.store.rows('SELECT user_agent FROM feed_fetch_options WHERE url=?', (feed.link,))
        return web.json_response(options_view(feed, rows[0]['user_agent'] if rows else None))

    @routes.post('/api/feeds/fetch-options/batch')
    async def batch_proxy(request):
        """Set one proxy mode on several feeds at once (e.g. all feeds the server cannot reach directly)."""
        require_admin(request)
        values = await read_body(request)
        ids, proxy = values.get('feeds'), values.get('proxy')
        if set(values) != {'feeds', 'proxy'} or not isinstance(ids, list) or not 1 <= len(ids) <= 100:
            raise Problem('请选择 1–100 个订阅源，并指定代理设置。')
        proxy = clean_proxy(proxy)
        async with service.mutation:
            # Authorize and resolve every feed before changing any of them.
            feeds = [await source(service, ident, request['principal']) for ident in dict.fromkeys(ids)]
            for feed in feeds:
                await feed_options.save_proxy(service.store, feed.link, proxy)
        mode = feed_options.describe(feeds[0].link)['mode']
        await service.store.audit(request['principal']['name'], '批量修改来源代理', f'{len(feeds)} 个 · {mode}')
        return web.json_response({'ok': True, 'updated': len(feeds), 'mode': mode})

    @routes.post('/api/feeds/{id}/proxy-test')
    async def proxy_test(request):
        """Fetch the feed once through a proxy (the one in the request, or the saved setting); nothing is delivered."""
        require_admin(request)
        feed = await source(service, request.match_info['id'], request['principal'])
        values = await read_body(request)
        if set(values) - {'proxy'}:
            raise Problem('包含不支持的设置项。')
        if service.demo:  # also true for the real-data snapshot preview
            raise Problem('离线预览和演示实例不联网，无法测试代理。', 409, code='OFFLINE')
        explicit = clean_proxy(values['proxy']) if values.get('proxy') is not None else None
        override = None if explicit is None else False if explicit == feed_options.DIRECT else explicit
        rows = await service.store.rows('SELECT user_agent FROM feed_fetch_options WHERE url=?', (feed.link,))
        headers = {'User-Agent': rows[0]['user_agent']} if rows else {}
        started = time.monotonic()
        result = await upstream_web.feed_get(feed.link, headers=headers, verbose=False, proxy=override)
        elapsed = round((time.monotonic() - started) * 1000)
        if result.rss_d is not None or result.status == 304:
            return web.json_response({'ok': True, 'status': result.status, 'duration_ms': elapsed,
                                      'entries': len(result.rss_d.entries) if result.rss_d is not None else None})
        error = getattr(result, 'error', None)
        base = getattr(error, 'base_error', None)
        # Only technical categories: error text can name the proxy or the site.
        return web.json_response({'ok': False, 'status': result.status if isinstance(result.status, int) else None,
                                  'duration_ms': elapsed, 'reason': getattr(error, 'error_name', 'fetch failed'),
                                  'exception_type': type(base).__name__ if base is not None else None})
