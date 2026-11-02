"""Operational history is available only to the browser administrator."""
import asyncio
from aiohttp import web

from .. import db
from .diagnostics import text
from .service import Problem, integer


def install(routes, service, admin):
    journal = service.store.diagnostics

    async def names(result):
        feed_ids = {int(item['feed_id']) for item in result['items'] if item['feed_id'] is not None}
        target_ids = {item['target_id'] for item in result['items'] if item.get('target_id') is not None}
        feeds, targets = await asyncio.gather(
            db.Feed.filter(id__in=feed_ids).values('id', 'title'), service.store.target_map(target_ids))
        feed_titles = {str(feed['id']): feed['title'] for feed in feeds}
        for item in result['items']:
            title = feed_titles.get(item['feed_id'])
            item['feed_title'] = text(title, 400) if title is not None else None
            target = targets.get(item.get('target_id'))
            if 'target_id' in item:
                item['target_title'] = text(target['title'], 400) if target is not None else None
        return result

    @routes.get('/api/diagnostics')
    async def history(request):
        admin(request)
        return web.json_response(await names(await journal.history(request.query)))

    @routes.get('/api/feeds/{id}/diagnostics')
    async def feed_history(request):
        admin(request)
        feed_id = integer(request.match_info['id'], '订阅源 ID', 1, 2 ** 63 - 1)
        feed = await db.Feed.get_or_none(id=feed_id)
        if feed is None:
            raise Problem('订阅源不存在，可能已被删除。', 404)
        query = dict(request.query)
        if 'feed_id' in query and query['feed_id'] != str(feed_id):
            raise Problem('日志筛选的订阅源与当前订阅源不一致。')
        query['feed_id'] = str(feed_id)
        result = await names(await journal.history(query))
        result['feed'] = dict(id=str(feed.id), title=feed.title, errors=feed.error_count, state=feed.state,
                              next_check_time=feed.next_check_time.isoformat() if feed.next_check_time else None)
        return web.json_response(result)

    @routes.get('/api/fetch-runs')
    async def runs(request):
        admin(request)
        return web.json_response(await names(await journal.runs(request.query)))

    @routes.get('/api/feeds/{id}/fetch-runs')
    async def feed_runs(request):
        admin(request)
        feed_id = integer(request.match_info['id'], '订阅源 ID', 1, 2 ** 63 - 1)
        feed = await db.Feed.get_or_none(id=feed_id)
        if feed is None:
            raise Problem('订阅源不存在，可能已被删除。', 404)
        result = await names(await journal.runs({**request.query, 'feed_id': str(feed_id)}))
        result['feed'] = dict(id=str(feed.id), title=feed.title, errors=feed.error_count, state=feed.state,
                              interval=feed.interval, next_check_time=feed.next_check_time.isoformat() if feed.next_check_time else None)
        return web.json_response(result)
