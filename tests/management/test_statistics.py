import asyncio
import json
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from src import db
from src.management import statistics
from src.management.store import Store
from conftest import token


def clock(monkeypatch, value):
    now = datetime.fromisoformat(value.replace('Z', '+00:00'))
    monkeypatch.setattr(statistics, 'now_utc', lambda: now)
    return now


async def test_hour_day_boundaries_offsets_empty_buckets_and_concurrency(tmp_path, monkeypatch):
    clock(monkeypatch, '2026-01-01T00:00:00Z')
    store = await Store(tmp_path / 'stats.db').open()
    await store.set_setting('started_at', '2026-01-01T00:00:00Z')
    clock(monkeypatch, '2026-01-03T00:30:00Z')
    await store.increment(fetched=3, at='2026-01-01T23:59:59Z')
    await asyncio.gather(*(store.increment(delivered=1, at='2026-01-01T16:00:00-08:00') for _ in range(40)))
    result = await store.statistics_window('hour', '2026-01-01T23:00:00Z', '2026-01-02T03:00:00Z')
    assert [r['delivered'] for r in result['buckets']] == [0, 40, 0, 0]
    assert [r['fetched'] for r in result['buckets']] == [3, 0, 0, 0]
    daily = await store.statistics_window('day', '2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z')
    assert [r['delivered'] for r in daily['buckets']] == [0, 40, 0]
    assert daily['buckets'][-1]['availability'] == 'partial'
    assert daily['totals'] == result['totals'] == dict(fetched=3, delivered=40, failed=0)
    await store.close()


async def test_retention_read_cleanup_and_lifetime_survive(tmp_path, monkeypatch):
    now = clock(monkeypatch, '2026-01-01T00:00:00Z')
    path = tmp_path / 'stats.db'
    store = await Store(path).open()
    for i in range(100):
        clock(monkeypatch, (now + timedelta(days=i)).isoformat())
        await store.increment(fetched=1, delivered=2)
    assert len(await store.rows('SELECT * FROM metrics_hourly')) == 31
    assert len(await store.rows("SELECT * FROM metrics WHERE day!='total'")) == 90
    totals = (await store.statistics())['totals']
    clock(monkeypatch, '2027-01-01T00:00:00Z')
    await store.statistics_window()
    assert await store.rows('SELECT * FROM metrics_hourly') == []
    assert (await store.statistics())['daily'] == []
    assert (await store.statistics())['totals'] == totals
    await store.close()
    store = await Store(path).open()
    assert (await store.statistics())['totals'] == totals
    await store.close()


async def test_upgrade_keeps_totals_without_inventing_hours(tmp_path, monkeypatch):
    path = tmp_path / 'legacy.db'
    with sqlite3.connect(path) as conn:
        conn.executescript("""CREATE TABLE metrics(day TEXT PRIMARY KEY, fetched INTEGER, delivered INTEGER, failed INTEGER);
            INSERT INTO metrics VALUES('total', 10, 20, 1);
            INSERT INTO metrics VALUES('2026-01-01', 10, 20, 1);
            CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT INTO meta VALUES('started_at','2026-01-01T00:00:00Z');""")
    clock(monkeypatch, '2026-01-02T12:15:00Z')
    store = await Store(path).open()
    result = await store.statistics_window('hour', '2026-01-02T11:00:00Z', '2026-01-02T13:00:00Z')
    assert result['buckets'][0]['delivered'] is None
    assert result['buckets'][0]['availability'] == 'unavailable'
    assert result['buckets'][1]['availability'] == 'partial'
    assert result['totals']['delivered'] == 20
    assert await store.rows('SELECT * FROM metrics_hourly') == []
    daily = await store.statistics_window('day', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')
    assert daily['buckets'][0]['delivered'] == 20
    await store.close()


async def test_partial_start_and_unavailable_future(tmp_path, monkeypatch):
    clock(monkeypatch, '2026-01-01T12:15:00Z')
    store = await Store(tmp_path / 'stats.db').open()
    result = await store.statistics_window('hour', '2026-01-01T11:00:00Z', '2026-01-01T14:00:00Z')
    assert [r['availability'] for r in result['buckets']] == ['unavailable', 'partial', 'unavailable']
    assert [r['fetched'] for r in result['buckets']] == [None, 0, None]
    await store.increment(delivered=9, day='2026-01-01')
    assert await store.rows('SELECT * FROM metrics_hourly') == []
    await store.close()


async def test_usage_banned_paused_source_unknown_and_distinct(logged):
    await db.User.filter(id=-1002).update(state=-1)
    await db.User.create(id=-300, state=0)
    await db.User.create(id=-400, state=51)
    await db.Sub.create(user_id=-300, feed=logged.feed)
    await db.Sub.create(user_id=-400, feed=logged.feed, state=0)
    extra = await db.Feed.create(link='https://example.test/extra', title='Extra')
    await db.Sub.create(user_id=-1001, feed=extra)
    data = await (await logged.client.get('/api/dashboard')).json()
    assert data['usage']['known'] == dict(private=2, channel=1, group=1, unknown=2, total=6)
    assert data['usage']['active'] == dict(private=0, channel=1, group=0, unknown=1, total=2)
    assert data['usage']['active_subscriptions'] == 3
    assert data['counts']['groups'] == 1
    await db.Feed.filter(id=logged.feed.id).update(state=0)
    assert (await statistics.usage())['active_subscriptions'] == 1
    await logged.store.increment(delivered=5)
    await db.Sub.all().delete()
    assert (await statistics.usage())['active']['total'] == 0
    assert (await logged.store.statistics())['totals']['delivered'] == 5


@pytest.mark.parametrize('params', [
    'granularity=minute', 'start=invalid', 'start=2026-01-01T00:00:00',
    'start=2026-01-01T00:01:00Z', 'start=2026-01-02T00:00:00Z&end=2026-01-01T00:00:00Z',
    'start=2026-01-01T00:00:00Z&end=2026-03-01T00:00:00Z'])
async def test_api_invalid_windows(logged, params):
    assert (await logged.client.get('/api/statistics?' + params)).status == 400


async def test_api_size_and_scope(logged):
    result = await logged.client.get('/api/statistics?start=2026-01-01T00:00:00Z&end=2026-02-01T00:00:00Z')
    assert result.status == 200
    body = await result.json()
    assert len(body['buckets']) == 744
    assert len(json.dumps(body)) < 150000
    headers = await token(logged)
    assert (await logged.client.get('/api/statistics', headers=headers)).status == 403


async def test_snapshot_unavailable(logged):
    result = await logged.store.statistics_window(unavailable=True)
    assert not result['available']
    assert all(r['availability'] == 'unavailable' and r['delivered'] is None for r in result['buckets'])
    assert result['totals']['delivered'] is None


async def test_transaction_rolls_back_all_aggregates(logged):
    await logged.store.execute("CREATE TRIGGER fail_hour BEFORE INSERT ON metrics_hourly BEGIN SELECT RAISE(ABORT, 'test failure'); END")
    with pytest.raises(sqlite3.IntegrityError):
        await logged.store.increment(delivered=1)
    assert (await logged.store.statistics())['totals']['delivered'] == 0
    assert (await logged.store.statistics())['daily'] == []


async def test_cancellation_rolls_back_and_two_connections_agree(tmp_path, monkeypatch):
    path = tmp_path / 'stats.db'
    store = await Store(path).open()
    execute = store.db.execute

    async def cancel_hour(sql, args=()):
        if 'INSERT INTO metrics_hourly' in sql:
            raise asyncio.CancelledError
        return await execute(sql, args)

    monkeypatch.setattr(store.db, 'execute', cancel_hour)
    with pytest.raises(asyncio.CancelledError):
        await store.increment(delivered=7)
    monkeypatch.setattr(store.db, 'execute', execute)
    assert (await store.statistics())['totals']['delivered'] == 0
    second = await Store(path).open()
    await asyncio.gather(*(target.increment(delivered=1) for _ in range(10) for target in (store, second)))
    result = await store.statistics_window()
    assert result['totals']['delivered'] == sum(b['delivered'] or 0 for b in result['buckets']) == 20
    await second.close()
    await store.close()
