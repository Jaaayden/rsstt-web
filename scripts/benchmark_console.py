"""Offline synthetic baseline. Run from the repository root; emits JSON to stdout.

Uses temporary SQLite databases and in-process handlers, no sockets or bot client.
No timings are assertions; compare repeated measurements on the same machine.
"""
import argparse
import asyncio
import json
import math
import os
import platform
import sqlite3
import statistics
import sys
import tempfile
import time
import tracemalloc
from pathlib import Path


def deny_network(event, args):
    if event in ('socket.connect', 'socket.getaddrinfo', 'socket.sendto'):
        raise RuntimeError('Benchmark forbids external network')


async def benchmark(config, sizes, repeats):
    from aiohttp.test_utils import make_mocked_request
    from tortoise import Tortoise, connections
    from src import db, env
    from src.command import inner
    from src.command.list_page import get_list_page
    from src.management.server import create_app
    from src.management.service import Service
    from src.management.store import Store
    from telethon import __version__ as telethon_version
    from telethon.extensions import html

    env.loop = asyncio.get_running_loop()
    report = {'environment': {'python': platform.python_version(), 'os': platform.system(),
                             'architecture': platform.machine(), 'sqlite': sqlite3.sqlite_version,
                             'telethon': telethon_version}, 'repeats': repeats, 'datasets': []}
    principal = {'targets': None, 'permission': 'admin', 'kind': 'session'}
    for size in sizes:
        await Tortoise.init(db_url=f'sqlite://{config / str(size)}.sqlite3', modules={'models': ['src.db.models']})
        await Tortoise.generate_schemas()
        await db.EffectiveOptions.cache()
        store = await Store(config / f'console-{size}.sqlite3').open()
        try:
            await db.User.bulk_create([db.User(id=i+1) for i in range(20)])
            feeds = size // 10
            await db.Feed.bulk_create([db.Feed(id=i+1, link=f'https://example.test/rss/{i}',
                                             title=f'Synthetic {i} 中文😀 ' * 8, error_count=i % 5) for i in range(feeds)])
            for start in range(0, feeds, 100):
                await db.Sub.bulk_create([db.Sub(user_id=(i+j) % 20 + 1, feed_id=i+1)
                                         for i in range(start, min(feeds, start+100)) for j in range(10)])
            for ident in range(1, 21):
                await store.target(ident, f'Synthetic {ident}', None, 'private', 'known')
            service = Service(store)
            gateway = type('OfflineGateway', (), {'status': lambda _: {'connected': False}})()
            app = await create_app(store, 'benchmark-password-123', 'http://localhost', gateway)
            request = make_mocked_request('GET', '/api/dashboard', app=app)
            request['principal'] = principal
            route = await app.router.resolve(request)

            async def old_list():
                _, _, rows, _ = await inner.utils.get_sub_list_by_page(1, 1, 99)
                markup = '<b>Subscriptions</b>\n' + '\n'.join(
                    f'<a href="{r.feed.link}">{inner.utils.escape_html(r.title or r.feed.title)}</a>' for r in rows)
                return html.parse(markup)[0]

            async def safe_list():
                result = await get_list_page(1, 1, 'Subscriptions')
                return html.parse(result[2])[0]

            cases = {
                'subscriptions_first': lambda: service.subscriptions(principal, {'size': '20'}),
                'subscriptions_last': lambda: service.subscriptions(principal, {'size': '20', 'page': str(max(1, size//20))}),
                'subscriptions_search': lambda: service.subscriptions(principal, {'size': '20', 'q': 'Synthetic 9'}),
                'targets': lambda: service.targets(principal, {'size': '20'}),
                'dashboard_handler': lambda: route.handler(request),
                'metrics_increment': lambda: store.increment(fetched=1, delivered=1),
                'list_old_99_rows': old_list,
                'list_safe': safe_list,
            }
            measurements = {}
            for name, operation in cases.items():
                await operation()  # warmup
                times = []
                for _ in range(repeats):
                    start = time.perf_counter()
                    await operation()
                    times.append((time.perf_counter() - start) * 1000)
                tracemalloc.start()
                await operation()
                _, peak = tracemalloc.get_traced_memory()
                tracemalloc.stop()
                measurements[name] = {'median_ms': round(statistics.median(times), 3),
                                      'p95_ms': round(sorted(times)[math.ceil(.95*len(times))-1], 3),
                                      'python_peak_kib': round(peak/1024, 1)}
            old = await old_list()
            safe = await get_list_page(1, 1, 'Subscriptions')
            parsed, entities = html.parse(safe[2])
            assert len(parsed.encode('utf-16-le')) // 2 <= 4096 and len(entities) <= 100
            sql = db.Sub.filter(user_id=1).order_by('-id').limit(256).values('id', 'title', 'feed__title', 'feed__link').sql(params_inline=True)
            plan = await connections.get('default').execute_query_dict('EXPLAIN QUERY PLAN ' + sql)
            report['datasets'].append({'subscriptions': size, 'sources': feeds, 'targets': 20,
                                       'list_target_subscriptions': safe[3], 'list_pages': safe[1],
                                       'old_list_utf16': len(old.encode('utf-16-le'))//2,
                                       'safe_list_utf16': len(parsed.encode('utf-16-le'))//2,
                                       'measurements': measurements, 'list_query_plan': plan})
        finally:
            await store.close()
            await Tortoise.close_connections()
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sizes', nargs='+', type=int, default=[1000, 10000])
    parser.add_argument('--repeats', type=int, default=20)
    args = parser.parse_args()
    if args.repeats < 1 or any(n < 100 or n % 10 for n in args.sizes):
        parser.error('sizes must be multiples of 10 >= 100; repeats must be positive')
    sys.addaudithook(deny_network)
    with tempfile.TemporaryDirectory(prefix='rsstt-benchmark-') as temporary:
        config = Path(temporary)
        os.environ.update(TOKEN='test', MANAGER='1', MULTIPROCESSING='0', WEB_ENABLED='0',
                          DATABASE_URL=f'sqlite:{config / "unused.sqlite3"}')
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        sys.argv = [sys.argv[0], '-c', str(config)]
        print(json.dumps(asyncio.run(benchmark(config, args.sizes, args.repeats)), indent=2))


if __name__ == '__main__':
    main()
