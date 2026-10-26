"""Local offline preview: python -m src.management.demo (no Telegram traffic)."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / '.demo'
PORT = int(os.environ.get('DEMO_PORT', '8730'))
os.environ.update(TOKEN='test', MANAGER='1', MULTIPROCESSING='0', DATABASE_URL=f'sqlite:{CONFIG / "db.sqlite3"}')
sys.argv = [sys.argv[0], '-c', str(CONFIG)]

from aiohttp import web
from feedparser import FeedParserDict
from .. import db, env, aio_helper, web as upstream_web
from .server import create_app
from .store import Store

# Keep the demo isolated even when the checkout has a production .env file.
env.TOKEN = 'test'
env.MANAGER = {1}
env.DATABASE_URL = f'sqlite:{CONFIG / "db.sqlite3"}'
db.config.TORTOISE_ORM['connections']['default'] = env.DATABASE_URL


class DemoGateway:
    async def inspect(self, ident):
        meta = (await self.store.target_map([ident])).get(str(ident))
        return {'id': str(ident), 'title': meta['title'] if meta else f'示例会话 {ident}',
                'username': meta.get('username') if meta else None,
                'kind': meta['kind'] if meta else 'private' if ident > 0 else 'channel', 'membership': 'available'}

    async def leave(self, ident):
        pass

    def status(self):
        return {'connected': False, 'name': 'Lantern RSS', 'username': 'lantern_rss_bot'}


async def offline_feed(url, **kwargs):
    from urllib.parse import urlsplit
    return SimpleNamespace(url=url, status=200, error=None, content=None,
                           rss_d=FeedParserDict(feed=FeedParserDict(title=f'{urlsplit(url).hostname} · 示例订阅'), entries=[]),
                           web_response=SimpleNamespace(etag=None, last_modified=None),
                           calc_next_check_as_per_server_side_cache=lambda: None)


async def main():
    env.loop = asyncio.get_running_loop()
    aio_helper.init()
    await db.init()
    store = await Store(CONFIG / 'console.sqlite3').open()
    if not await db.User.all().exists():
        targets = [(1, 'Jayden', 'private', 'jayden'), (-1001001, '技术与创造', 'channel', 'build_and_read'),
                   (-1001002, '慢慢读书', 'channel', 'slow_reading'), (-1001003, '研究小组', 'group', None),
                   (10002, 'Alex Chen', 'private', 'alex'), (-1001004, '每日设计灵感', 'channel', 'design_daily')]
        names = [('少数派', 'sspai.com/feed'), ('阮一峰的网络日志', 'ruanyifeng.com/blog/atom.xml'),
                 ('Hacker News', 'hnrss.org/frontpage'), ('Simon Willison', 'simonwillison.net/atom/everything/'),
                 ('设计与体验', 'design.example.org/feed'), ('GitHub Blog', 'github.blog/feed/'),
                 ('Nature · Research', 'nature.com/nature.rss'), ('MIT Technology Review', 'technologyreview.com/feed/'),
                 ('The Verge', 'theverge.com/rss/index.xml'), ('机器之心', 'jiqizhixin.com/rss'),
                 ('Aeon', 'aeon.co/feed.rss'), ('A List Apart', 'alistapart.com/main/feed/')]
        for ident, title, target_kind, username in targets:
            await db.User.create(id=ident, state=50 if target_kind == 'channel' else 51 if target_kind == 'group' else 1)
            await store.target(ident, title, username, target_kind, 'available')
        for i, (title, url) in enumerate(names):
            feed = await db.Feed.create(title=title, link=f'https://{url}', error_count=4 if i == 4 else 7 if i == 9 else 0)
            for target in targets[:3 + i % 4]:
                await db.Sub.create(user_id=target[0], feed=feed, state=0 if i == 10 else 1)
        for i in range(30):
            day = (datetime.now(timezone.utc).date() - timedelta(days=29 - i)).isoformat()
            await store.increment(fetched=90 + (i * 47) % 150, delivered=200 + (i * 73) % 220, failed=1 if i % 4 == 0 else 0, day=day)
        for action, detail in [('添加订阅', '技术与创造 · Hacker News'), ('更新设置', '默认更新间隔 · 10 分钟'), ('导入 OPML', '慢慢读书 · 8 个订阅')]:
            await store.audit('管理员', action, detail)
    gateway = DemoGateway()
    gateway.store = store
    upstream_web.feed_get = offline_feed
    app = await create_app(store, 'rsstt-local-preview', f'http://127.0.0.1:{PORT}', gateway, demo=True)
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    try:
        await web.TCPSite(runner, '127.0.0.1', PORT).start()
        print(f'离线预览：http://127.0.0.1:{PORT}（仅示例数据，不连接 Telegram）', flush=True)
        await asyncio.Event().wait()
    finally:
        await runner.cleanup()
        await store.close()
        await db.close()
        aio_helper.shutdown()


if __name__ == '__main__':
    asyncio.run(main())
