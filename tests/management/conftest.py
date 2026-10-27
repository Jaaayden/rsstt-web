import asyncio
import os
import sys
import tempfile
from types import SimpleNamespace

import pytest
from tortoise import Tortoise

TEST_CONFIG = tempfile.TemporaryDirectory(prefix='rsstt-console-tests-')
os.environ.update(TOKEN='test', MANAGER='1', MULTIPROCESSING='0')
_argv = sys.argv
sys.argv = [sys.argv[0], '-c', TEST_CONFIG.name]
from src import db, env, web as upstream_web
from src.management.server import create_app
from src.management.store import Store
from src.management.service import Problem
sys.argv = _argv

PASSWORD = 'console-test-password'
ORIGIN = 'http://console.test'


class Gateway:
    denied = False
    left = []

    async def inspect(self, ident):
        if self.denied:
            raise Problem('无发布权限', 409)
        return dict(id=str(ident), title=f'会话 {ident}', kind='channel' if ident < 0 else 'private', username=None, membership='available')

    async def leave(self, ident):
        if self.denied:
            raise Problem('退出失败', 502)
        self.left.append(ident)

    def status(self):
        return {'name':'Test bot', 'username':'test_bot', 'connected':True}


@pytest.fixture
async def context(tmp_path, aiohttp_client, monkeypatch):
    env.loop = asyncio.get_running_loop()
    await Tortoise.init(db_url='sqlite://:memory:', modules={'models':['src.db.models']})
    await Tortoise.generate_schemas()
    await db.EffectiveOptions.cache()
    await db.EffectiveTasks.init(flush=True)
    store = await Store(tmp_path / 'console.sqlite3').open()
    gateway = Gateway()
    gateway.left = []
    app = await create_app(store, PASSWORD, ORIGIN, gateway)
    client = await aiohttp_client(app)
    for ident in (1, 2, -1001, -1002):
        await db.User.create(id=ident, state=50 if ident < 0 else 1)
        await store.target(ident, f'Target {ident}', None, 'channel' if ident < 0 else 'private', 'available')
    feed = await db.Feed.create(link='https://example.com/rss', title='Example')
    sub = await db.Sub.create(user_id=-1001, feed=feed)
    other = await db.Sub.create(user_id=-1002, feed=feed)
    await db.EffectiveTasks.init(flush=True)
    # Never allow a test to make real network requests to RSS or Telegram.
    async def no_network(*args, **kwargs):
        raise AssertionError('External network is not allowed in console tests')
    monkeypatch.setattr(upstream_web, 'feed_get', no_network)
    ctx = SimpleNamespace(client=client, store=store, gateway=gateway, feed=feed, sub=sub, other=other)
    yield ctx
    await client.close()
    await store.close()
    await Tortoise.close_connections()


@pytest.fixture
async def logged(context):
    response = await context.client.post('/api/login', json={'password':PASSWORD}, headers={'Origin':ORIGIN})
    assert response.status == 200
    return context


async def token(context, permission='write', targets=None):
    _, secret = await context.store.issue('Integration', 'token', permission, targets if targets is not None else ['-1001'])
    return {'Authorization': f'Bearer {secret}'}
