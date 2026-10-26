"""Run an editable, offline copy of a real RSStT database snapshot."""
import argparse
import asyncio
import fcntl
import hashlib
import json
import os
import shutil
import socket
import sqlite3
import sys
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit


def deny_network(event, args):
    if event in ('socket.getaddrinfo', 'socket.gethostbyname', 'socket.gethostbyaddr') or (
        (event == 'socket.connect' or
         (event in ('socket.sendto', 'socket.sendmsg') and args[0].type != socket.SOCK_STREAM))
        and args[0].family in (socket.AF_INET, socket.AF_INET6)
    ):
        raise RuntimeError('Offline snapshot preview does not allow outgoing network connections')


def prepare(snapshot, config):
    """Keep the immutable source separate from the editable working database."""
    metadata = json.loads((snapshot / 'metadata.json').read_text())
    source = snapshot / 'db.sqlite3'
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if metadata.get('format') != 1 or metadata.get('sha256') != digest:
        raise ValueError('Snapshot format or checksum is invalid')
    if snapshot == config or source.resolve() == (config / 'db.sqlite3').resolve():
        raise ValueError('The working directory must be separate from the snapshot')
    marker = config / 'snapshot.json'
    if marker.exists():
        if json.loads(marker.read_text()).get('sha256') != digest:
            raise ValueError('This working directory belongs to a different snapshot; use a new directory')
        if not (config / 'db.sqlite3').is_file():
            raise ValueError('Working database is missing; use a new working directory')
    else:
        if any(p.name != '.preview.lock' for p in config.iterdir()):
            raise ValueError('A new working directory must be empty')
        with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as db:
            if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise ValueError('Snapshot integrity check failed')
        shutil.copyfile(source, config / 'db.sqlite3')
        marker.write_text(json.dumps(metadata, ensure_ascii=False))
    return metadata


async def run(config, metadata, listener, port):
    # env.py loads .env from cwd and config. Both point at our private working
    # directory, whose contents we checked before importing any upstream code.
    if (config / '.env').exists():
        raise ValueError('Offline preview working directories must not contain .env files')
    os.chdir(config)
    os.environ.update(TOKEN='test', MANAGER='1', API_ID='1', API_HASH='0' * 32,
                      MULTIPROCESSING='0', NO_UVLOOP='1', EXECUTOR_NICENESS_INCREMENT='0',
                      DATABASE_URL=f'sqlite:{config / "db.sqlite3"}')
    sys.argv = [sys.argv[0], '-c', str(config)]
    sys.addaudithook(deny_network)

    from .backups import early_startup
    early_startup(f'sqlite:{config / "db.sqlite3"}', config)

    from aiohttp import web
    from feedparser import FeedParserDict
    from .. import db, env, aio_helper, web as upstream_web
    from .server import create_app
    from .service import Problem, kind
    from .store import Store

    # env.py normalizes URLs with yarl, which percent-encodes spaces in local
    # paths. Tortoise expects the literal SQLite filename (as in demo.py).
    env.DATABASE_URL = f'sqlite:{config / "db.sqlite3"}'
    db.config.TORTOISE_ORM['connections']['default'] = env.DATABASE_URL

    class SnapshotGateway:
        async def inspect(self, ident):
            user = await db.User.get_or_none(id=ident)
            if not user:
                raise Problem('这个会话不在快照中；离线预览无法向 Telegram 登记新会话。', 409)
            cached = (await store.target_map([ident])).get(str(ident), {})
            return dict(id=str(ident), title=cached.get('title') or f'会话 {ident}',
                        username=cached.get('username'), kind=kind(user), membership='snapshot')

        async def leave(self, ident):
            raise Problem('离线预览无法退出 Telegram 会话；可在本地副本中暂停或取消订阅。', 409)

        def status(self):
            return dict(connected=False, name='RSStT 真实数据副本', username=None)

    async def offline_feed(url, **kwargs):
        return SimpleNamespace(url=url, status=200, error=None, content=None,
                               rss_d=FeedParserDict(feed=FeedParserDict(title=f'{urlsplit(url).hostname} · 离线新增'), entries=[]),
                               web_response=SimpleNamespace(etag=None, last_modified=None),
                               calc_next_check_as_per_server_side_cache=lambda: None)

    env.loop = asyncio.get_running_loop()
    aio_helper.init()
    store = runner = None
    try:
        # Any schema migration is applied only to the working copy.
        async with asyncio.timeout(15):
            await db.init()
        store = await Store(config / 'console.sqlite3').open()
        if (await store.settings()).get('snapshot_loaded') != metadata['sha256']:
            names = {r['id']: r for r in metadata['targets']}
            for user in await db.User.all():
                cached = names.get(str(user.id), {})
                await store.target(user.id, cached.get('title') or f'会话 {user.id}',
                                   cached.get('username'), kind(user), 'snapshot')
            await store.set_setting('snapshot_loaded', metadata['sha256'])
        upstream_web.feed_get = offline_feed
        app = await create_app(store, 'rsstt-local-preview', f'http://127.0.0.1:{port}',
                               SnapshotGateway(), demo=True,
                               snapshot={'captured_at': metadata['captured_at'], 'counts': metadata['counts']})
        runner = web.AppRunner(app, access_log=None)
        await runner.setup()
        await web.SockSite(runner, listener).start()
        print(f'真实数据离线预览：http://127.0.0.1:{port}（仅编辑本地副本，不连接 Telegram 或 RSS）', flush=True)
        await asyncio.Event().wait()
    finally:
        if runner:
            await runner.cleanup()
        if store:
            await store.close()
        await db.close()
        aio_helper.shutdown()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True, type=Path, help='Extracted snapshot directory')
    parser.add_argument('--config', required=True, type=Path, help='Separate local working directory')
    parser.add_argument('--port', default=8731, type=int)
    args = parser.parse_args()
    snapshot, config = args.snapshot.resolve(), args.config.resolve()
    if snapshot == config or (snapshot / 'db.sqlite3').resolve() == (config / 'db.sqlite3').resolve():
        parser.error('The working directory must be separate from the snapshot')
    os.umask(0o077)
    config.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (config / '.preview.lock').open('a') as lock, socket.socket() as listener:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Reserve the loopback-only port before opening any database.
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(('127.0.0.1', args.port))
        listener.listen(128)
        listener.setblocking(False)
        metadata = prepare(snapshot, config)
        asyncio.run(run(config, metadata, listener, args.port))


if __name__ == '__main__':
    main()
