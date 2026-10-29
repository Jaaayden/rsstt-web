"""Offline Monitor/Notifier growth probe; JSONL evidence, never a production runner.

Synthetic RSS bytes pass through feedparser, Monitor, Notifier, Post formatting
and Message.send. Only RSS transport and the Telegram client are replaced.
Linux cgroup limits are supplied by the caller, not inferred from this workload.
"""
import argparse
import asyncio
from collections import Counter, defaultdict
from datetime import datetime, timezone
import gc
import json
import logging
import os
from pathlib import Path
import platform
import re
import resource
import socket
import sys
import tempfile
import time
from types import SimpleNamespace


def deny_network(event, args):
    if event in ('socket.getaddrinfo', 'socket.gethostbyname', 'socket.gethostbyaddr') or (
        event in ('socket.connect', 'socket.sendto', 'socket.sendmsg')
        and args[0].family in (socket.AF_INET, socket.AF_INET6)
    ):
        raise RuntimeError('Resource probe forbids network, including loopback')


def linux_value(name):
    path = Path('/sys/fs/cgroup') / name
    return path.read_text().strip() if path.is_file() else None


def resources():
    usage = resource.getrusage(resource.RUSAGE_SELF)
    rss = None
    if Path('/proc/self/statm').is_file():
        rss = int(Path('/proc/self/statm').read_text().split()[1]) * os.sysconf('SC_PAGE_SIZE')
    return {'rss_bytes': rss, 'peak_rss_bytes': usage.ru_maxrss * (1 if sys.platform == 'darwin' else 1024),
            'cpu_seconds': round(usage.ru_utime + usage.ru_stime, 3),
            'fds': len(os.listdir('/proc/self/fd')) if Path('/proc/self/fd').is_dir() else None}


def emit(data):
    print(json.dumps(data, sort_keys=True), flush=True)


async def run(config, args):
    import feedparser
    from telethon.tl import types
    from tortoise import Tortoise
    from src import db, env, locks, web, aio_helper
    from src.helpers.bg import bg
    from src.monitor import Monitor
    from src.monitor._notifier import Notifier
    from src.parsing.message import MessageDispatcher
    from src.management import diagnostics, metrics
    from src.management.service import Service
    from src.management.store import Store

    env.loop = asyncio.get_running_loop()
    aio_helper.init()
    await bg.init(env.loop)
    await Tortoise.init(db_url=f'sqlite://{config / "bot.sqlite3"}', modules={'models': ['src.db.models']})
    await Tortoise.generate_schemas()
    await db.EffectiveOptions.cache()
    await db.EffectiveTasks.init(flush=True)
    store = await Store(config / 'console.sqlite3').open()
    metrics.store = store
    diagnostics.install(store)
    service = Service(store)
    monitor = Monitor.get_instance()
    # Exercise actual dispatch immediately; cooldown transitions are separately
    # covered by lifecycle tests. No wall-clock scheduler or network is started.
    monitor._lock_up_period = 0
    state = SimpleNamespace(round=0, fetches=Counter(), sent=defaultdict(list), fetch_active=0,
                            fetch_peak=0, send_active=0, send_peak=0, id=0)

    class MockTelegram:
        async def get_input_entity(self, ident):
            return types.InputPeerUser(int(ident), 0)

        async def send_message(self, entity, message, **kwargs):
            assert not kwargs.get('file'), 'This probe intentionally excludes media'
            match = re.search(r'probe-(\d+)-(\d+)-(\d+)', message)
            assert match, 'Unexpected send (possibly an internal error notification)'
            feed, generation, entry = map(int, match.groups())
            assert generation == state.round
            for item in kwargs.get('formatting_entities') or ():
                bytes(item)  # real TL encoding, no transport
            state.send_active += 1
            state.send_peak = max(state.send_peak, state.send_active)
            try:
                await asyncio.sleep(args.latency_ms / 1000)
                state.sent[(int(entity), feed)].append(entry)
                state.id += 1
                return types.Message(id=state.id, peer_id=types.PeerUser(int(entity)),
                                     date=datetime.now(timezone.utc), message=message)
            finally:
                state.send_active -= 1

    async def synthetic_feed(url, **kwargs):
        feed = int(url.rsplit('/', 1)[1])
        # Use the same production locks around a simulated I/O wait. This proves
        # lock behavior, not HTTP client/transport performance.
        async with locks.overall_web_semaphore, locks.hostname_semaphore(url):
            state.fetch_active += 1
            state.fetch_peak = max(state.fetch_peak, state.fetch_active)
            state.fetches[feed] += 1
            try:
                await asyncio.sleep(args.latency_ms / 1000)
                entries = ''.join(
                    f'<item><guid>probe-{feed}-{state.round}-{i}</guid>'
                    f'<title>probe-{feed}-{state.round}-{i}</title>'
                    f'<link>https://post.invalid/{feed}/{state.round}/{i}</link>'
                    '<description>合成文本 &amp; emoji 😀；没有媒体。</description></item>'
                    for i in reversed(range(args.entries)))
                rss = ('<?xml version="1.0"?><rss version="2.0"><channel>'
                       f'<title>Synthetic {feed}</title><link>{url}</link><description>Probe</description>'
                       f'{entries}</channel></rss>').encode()
                parsed = feedparser.parse(rss)
                assert not parsed.bozo
                return SimpleNamespace(url=url, status=200, error=None, rss_d=parsed,
                                       web_response=SimpleNamespace(etag=None, last_modified=None),
                                       calc_next_check_as_per_server_side_cache=lambda: None)
            finally:
                state.fetch_active -= 1

    env.bot = MockTelegram()
    web.feed_get = synthetic_feed
    # Suppress routine per-feed logs; warnings/errors still identify failures.
    logging.getLogger('RSStT').setLevel(logging.WARNING)
    samples = []
    ticker = None
    try:
        emit({'kind': 'environment', 'python': platform.python_version(), 'os': platform.system(),
              'architecture': platform.machine(), 'parameters': vars(args),
              'limits': {name: linux_value(name) for name in ('memory.max', 'memory.swap.max', 'cpu.max', 'pids.max')},
              'resources': resources()})
        for generation in range(args.rounds):
            state.round = generation
            state.fetches.clear()
            state.sent.clear()
            state.fetch_peak = state.send_peak = 0
            if generation == 0 or args.churn:
                offset = generation * args.sources if args.churn else 0
                target_offset = generation * args.targets if args.churn else 0
                ids = list(range(offset + 1, offset + args.sources + 1))
                targets = list(range(target_offset + 1, target_offset + args.targets + 1))
                await db.User.bulk_create([db.User(id=ident, send_mode=2) for ident in targets])
                await db.Feed.bulk_create([db.Feed(id=ident, title=f'Synthetic {ident}',
                                                  link=f'https://host-{generation if args.churn else 0}-{ident % args.hosts}.invalid/{ident}') for ident in ids])
                for start in range(0, len(ids), 100):
                    await db.Sub.bulk_create([db.Sub(user_id=user, feed_id=ident) for ident in ids[start:start+100] for user in targets])
                await db.EffectiveTasks.init(flush=True)
            lag = []
            peak_tasks = 0

            async def tick():
                nonlocal peak_tasks
                while True:
                    before = time.perf_counter()
                    await asyncio.sleep(.05)
                    lag.append(max(0, time.perf_counter() - before - .05))
                    peak_tasks = max(peak_tasks, len(asyncio.all_tasks()))

            ticker = asyncio.create_task(tick())
            started = time.perf_counter()
            monitor.submit_feeds(ids, 'offline synthetic resource probe')
            # Concurrent real management read, with no HTTP listener/auth shortcut.
            query_start = time.perf_counter()
            page = await service.subscriptions({'targets': None}, {'size': '20'})
            query_ms = (time.perf_counter() - query_start) * 1000
            assert page['total'] == args.sources * args.targets
            async def drain():
                while any(helper._bg_tasks for helper in bg._helpers):
                    await asyncio.sleep(.01)
                await asyncio.sleep(0)  # run done callbacks
            await asyncio.wait_for(drain(), args.round_timeout)
            await store.diagnostics.flush()
            elapsed = time.perf_counter() - started
            ticker.cancel()
            await asyncio.gather(ticker, return_exceptions=True)
            ticker = None
            assert state.fetches == Counter({ident: 1 for ident in ids}), 'Repeated/missing fetch'
            assert len(state.sent) == args.sources * args.targets, 'Missing destinations'
            assert all(order == list(range(args.entries)) for order in state.sent.values()), 'Missing/duplicate/reordered entries'
            assert not metrics.last_error, metrics.last_error
            assert not store.diagnostics.degraded, 'Operational history could not be persisted'
            assert not store.diagnostics.pending, 'Operational history retained pending events after flush'
            diagnostic_count = (await store.rows('SELECT COUNT(*) AS n FROM diagnostic_events'))[0]['n']
            assert 0 < diagnostic_count <= diagnostics.RETENTION['max_entries'], 'Missing or unbounded operational history'
            assert monitor._stat._in_progress_count == Notifier._stat._in_progress_count == 0
            assert not monitor._subtask_defer_map, 'Monitor retained completed states'
            if args.churn:
                await db.Sub.all().delete()
                await db.Feed.all().delete()
                await db.User.all().delete()
                await db.EffectiveTasks.init(flush=True)
            state.fetches.clear()
            state.sent.clear()
            gc.collect()
            sample = {'kind': 'round', 'round': generation, 'wall_seconds': round(elapsed, 3),
                      'management_query_ms': round(query_ms, 3), 'loop_lag_max_ms': round(max(lag, default=0)*1000, 3),
                      'peak_tasks_sampled': peak_tasks, 'idle_tasks': len(asyncio.all_tasks()),
                      'fetch_peak': state.fetch_peak, 'send_peak': state.send_peak,
                      'sent': args.sources * args.targets * args.entries,
                      'diagnostics': {'retained': diagnostic_count, 'dropped': store.diagnostics.dropped,
                                      'pending': len(store.diagnostics.pending)},
                      'caches': {'monitor': len(monitor._subtask_defer_map), 'user_locks': len(locks._user_bucket),
                                 'host_locks': len(locks._hostname_semaphore_bucket),
                                 'dispatcher_user_locks': len(MessageDispatcher.user_sending_lock)},
                      'resources': resources()}
            samples.append(sample)
            emit(sample)
        rss = [row['resources']['rss_bytes'] for row in samples[min(5, len(samples)-1):]]
        emit({'kind': 'complete', 'rounds': len(samples), 'invariants_passed': True,
              'post_warmup_rss_growth_bytes': rss[-1] - rss[0] if rss and rss[0] is not None else None,
              'memory_events': linux_value('memory.events'), 'resources': resources(),
              'limitation': 'Finite synthetic run; not a production memory bound or Telegram verification'})
    finally:
        if ticker:
            ticker.cancel()
            await asyncio.gather(ticker, return_exceptions=True)
        await bg.close()
        metrics.store = None
        await store.close()
        await Tortoise.close_connections()
        aio_helper.shutdown()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=int, default=100)
    parser.add_argument('--targets', type=int, default=10)
    parser.add_argument('--hosts', type=int, default=8)
    parser.add_argument('--entries', type=int, default=2)
    parser.add_argument('--rounds', type=int, default=30)
    parser.add_argument('--latency-ms', type=int, default=10)
    parser.add_argument('--round-timeout', type=int, default=120)
    parser.add_argument('--require-cgroup-limits', action='store_true', help='Fail unless Linux cgroup v2 memory/CPU/pid limits are finite')
    parser.add_argument('--churn', action='store_true', help='Delete/recreate sources and destinations each round')
    args = parser.parse_args()
    if min(args.sources, args.targets, args.hosts, args.entries, args.rounds, args.round_timeout) < 1 or args.latency_ms < 0:
        parser.error('counts/timeouts must be positive; latency cannot be negative')
    if args.require_cgroup_limits:
        limits = [linux_value(name) for name in ('memory.max', 'cpu.max', 'pids.max')]
        if sys.platform != 'linux' or any(value is None or value.split()[0] == 'max' for value in limits):
            parser.error('Finite Linux cgroup v2 memory, CPU and pid limits are required')
    sys.addaudithook(deny_network)
    with tempfile.TemporaryDirectory(prefix='rsstt-resource-probe-') as temporary:
        config = Path(temporary)
        os.environ.update(TOKEN='test', MANAGER='1', MULTIPROCESSING='0', WEB_ENABLED='0',
                          HTTP_CONCURRENCY='32', HTTP_CONCURRENCY_PER_HOST='4', EXECUTOR_NICENESS_INCREMENT='0',
                          DATABASE_URL=f'sqlite:{config / "unused.sqlite3"}')
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        sys.argv = [sys.argv[0], '-c', str(config)]
        asyncio.run(run(config, args))


if __name__ == '__main__':
    main()
