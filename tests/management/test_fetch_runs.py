import asyncio
import importlib
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from feedparser import FeedParserDict

from src import db, web
from src.management import diagnostics
from src.monitor._monitor import Monitor
from src.monitor._notifier import Notifier
from conftest import ORIGIN, token


@pytest.fixture(autouse=True)
def isolated_monitor(monkeypatch):
    monkeypatch.setattr(Monitor, '_singleton', None)


@pytest.fixture(autouse=True)
def journal_is_active(logged):
    diagnostics.install(logged.store)  # the console's start() does this in production
    yield
    diagnostics.uninstall(logged.store)


def reply(feed, entries, status=200):
    return SimpleNamespace(status=status, url=feed.link, error=None,
                           rss_d=SimpleNamespace(entries=entries, feed=SimpleNamespace(title='Example')),
                           web_response=SimpleNamespace(etag=None, last_modified=datetime.now(timezone.utc)),
                           calc_next_check_as_per_server_side_cache=lambda: None)


async def runs(context, **query):
    response = await context.client.get(f'/api/feeds/{context.feed.id}/fetch-runs', params=query)
    assert response.status == 200
    return await response.json()


async def test_routine_checks_are_recorded_with_time_duration_and_counts(logged, monkeypatch):
    module = importlib.import_module('src.monitor._monitor')
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=reply(logged.feed, [{'title': str(i)} for i in range(36)])))
    monkeypatch.setattr(module.inner.utils, 'calculate_update', lambda *args: ([1], []))  # nothing new
    await Monitor()._do_monitor_a_feed(logged.feed, datetime.now(timezone.utc))
    data = await runs(logged)
    assert data['total'] == 1 and data['feed']['id'] == str(logged.feed.id)
    run = data['items'][0]
    assert run['status'] == 'unchanged' and run['entries'] == 36 and run['new_entries'] == 0
    assert run['duration_ms'] >= 0 and run['manual'] is False and run['at'] and run['count'] == 1
    assert run['http_status'] == 200 and run['feed_title'] == 'Example'
    # ... yet the event log still ignores them, so failures are not buried.
    events = await (await logged.client.get('/api/diagnostics')).json()
    assert not [e for e in events['items'] if e['code'] == 'fetch.unchanged']


async def test_updates_failures_and_cached_checks_are_distinct(logged, monkeypatch):
    module = importlib.import_module('src.monitor._monitor')
    entries = [{'title': 'a'}, {'title': 'b'}]
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=reply(logged.feed, entries)))
    monkeypatch.setattr(module, 'ensure_plain', AsyncMock(return_value='Example'))
    monkeypatch.setattr(module.inner.utils, 'calculate_update', lambda *args: ([1], entries[:1]))
    monkeypatch.setattr(Notifier, 'notify_all', AsyncMock())
    await Monitor()._do_monitor_a_feed(logged.feed, datetime.now(timezone.utc))
    cached = reply(logged.feed, [], status=304)
    cached.rss_d = None
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=cached))
    await Monitor()._do_monitor_a_feed(logged.feed, datetime.now(timezone.utc))
    failed = SimpleNamespace(status=-1, rss_d=None, url=logged.feed.link,
                             error=SimpleNamespace(error_name='network error', base_error=TimeoutError('https://u:secret@x.example/feed')))
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=failed))
    await Monitor()._do_monitor_a_feed(logged.feed, datetime.now(timezone.utc))
    items = (await runs(logged))['items']  # newest first
    assert [r['status'] for r in items] == ['failed', 'not_modified', 'updated']
    assert items[2]['new_entries'] == 1 and items[2]['entries'] == 2
    assert items[0]['entries'] is None and 'TimeoutError' in items[0]['detail'] and 'secret' not in items[0]['detail']
    assert [r['status'] for r in (await runs(logged, status='failed'))['items']] == ['failed']
    assert [r['status'] for r in (await runs(logged, status='ok'))['items']] == ['not_modified', 'updated']
    assert [r['status'] for r in (await runs(logged, status='updated'))['items']] == ['updated']
    assert (await logged.client.get(f'/api/feeds/{logged.feed.id}/fetch-runs?status=nope')).status == 400


async def test_identical_consecutive_checks_share_one_row(logged):
    journal = logged.store.diagnostics
    for duration in (8000, 8400, 8200):
        journal.emit_run(logged.feed.id, 'unchanged', duration_ms=duration, entries=5)
    await journal.flush()
    journal.emit_run(logged.feed.id, 'unchanged', duration_ms=9000, entries=5)  # a later flush folds in as well
    await journal.flush()
    data = await runs(logged)
    assert data['total'] == 1
    row = data['items'][0]
    assert row['count'] == 4 and row['entries'] == 5 and row['new_entries'] == 0
    assert (row['duration_min'], row['duration_max'], row['duration_ms']) == (8000, 9000, 8400)
    assert row['at'] <= row['last_at']
    # Any difference starts a new row: another post count, a failure, a manual check.
    journal.emit_run(logged.feed.id, 'unchanged', duration_ms=100, entries=6)
    journal.emit_run(logged.feed.id, 'failed', http_status=403, duration_ms=100, detail='status code error')
    journal.emit_run(logged.feed.id, 'failed', http_status=403, duration_ms=300, detail='status code error')
    journal.emit_run(logged.feed.id, 'failed', http_status=403, duration_ms=100, detail='status code error', manual=True)
    await journal.flush()
    rows = (await runs(logged))['items']
    assert [(r['status'], r['entries'], r['count'], r['manual']) for r in rows] == [
        ('failed', None, 1, True), ('failed', None, 2, False), ('unchanged', 6, 1, False), ('unchanged', 5, 4, False)]


async def test_history_keeps_the_newest_rows_per_feed(logged, monkeypatch):
    journal = logged.store.diagnostics
    journal.run_rows = 5
    for number in range(8):
        journal.emit_run(logged.feed.id, 'unchanged', duration_ms=100, entries=number)  # each differs: 8 rows
    await journal.flush()
    data = await runs(logged)
    assert data['total'] == 5 and data['items'][0]['entries'] == 7 and data['items'][-1]['entries'] == 3
    assert not journal.emit_run(logged.feed.id, 'bogus') and not journal.emit_run('not-an-id', 'unchanged')


async def test_runs_are_admin_only_and_listed_across_feeds(logged, monkeypatch):
    logged.store.diagnostics.emit_run(logged.feed.id, 'unchanged', duration_ms=5, entries=1)
    everywhere = await (await logged.client.get('/api/fetch-runs')).json()
    assert everywhere['items'][0]['feed_title'] == 'Example'
    await logged.client.post('/api/logout', headers={'Origin': ORIGIN})
    assert (await logged.client.get('/api/fetch-runs')).status == 401
    headers = await token(logged)
    assert (await logged.client.get('/api/fetch-runs', headers=headers)).status == 403


async def test_rows_kept_per_feed_is_a_setting_with_bounds(logged):
    headers = {'Origin': ORIGIN}
    settings = await (await logged.client.get('/api/settings')).json()
    assert settings['console'].get('fetch_run_rows') in (None, '20')
    assert (await logged.client.patch('/api/settings', json={'fetch_run_rows': 4}, headers=headers)).status == 400
    assert (await logged.client.patch('/api/settings', json={'fetch_run_rows': 201}, headers=headers)).status == 400
    assert (await logged.client.patch('/api/settings', json={'fetch_run_rows': 3}, headers=headers)).status == 400
    assert (await logged.client.patch('/api/settings', json={'fetch_run_rows': 6}, headers=headers)).status == 200
    assert logged.store.diagnostics.run_rows == 6
    journal = logged.store.diagnostics
    for number in range(9):
        journal.emit_run(logged.feed.id, 'unchanged', duration_ms=1, entries=number)
    await journal.flush()
    data = await runs(logged)
    assert data['total'] == 6 and data['retention']['per_feed'] == 6
    assert (await (await logged.client.get('/api/settings')).json())['console']['fetch_run_rows'] == '6'


async def test_a_new_subscription_is_checked_right_away(logged, monkeypatch):
    url = 'https://new.example/feed'
    entries = [FeedParserDict(guid=f'e{i}', title=f'Post {i}', link=f'{url}/{i}') for i in range(3)]
    fetch = AsyncMock(return_value=reply(SimpleNamespace(link=url), entries))
    monkeypatch.setattr(web, 'feed_get', fetch)
    notify = AsyncMock()
    monkeypatch.setattr(Notifier, 'notify_all', notify)
    added = await logged.client.post('/api/subscriptions', json={'target': '-1001', 'urls': [url]}, headers={'Origin': ORIGIN})
    created = (await added.json())['results'][0]
    assert created['status'] == 'created'
    feed = await db.Feed.get(link=url)
    data = {'items': []}
    for _ in range(300):
        await logged.store.diagnostics.flush()
        data = await (await logged.client.get(f'/api/feeds/{feed.id}/fetch-runs')).json()
        if data['items']:
            break
        await asyncio.sleep(.01)
    # The read made to validate the address is followed by a real check: not an hour of empty log.
    assert fetch.await_count == 2
    run = data['items'][0]
    assert run['status'] == 'unchanged' and run['entries'] == 3 and run['new_entries'] == 0
    notify.assert_not_awaited()  # what was already there is never pushed
    await logged.store.articles.flush()
    shown = await (await logged.client.get(f"/api/subscriptions/{created['id']}/articles")).json()
    assert len(shown['items']) == 3
    events = await (await logged.client.get('/api/diagnostics')).json()
    assert not [e for e in events['items'] if e['code'].startswith('manual.')]


async def test_adding_a_feed_that_is_already_watched_fetches_nothing_extra(logged, monkeypatch):
    fetch = AsyncMock(return_value=reply(logged.feed, [FeedParserDict(guid='e', title='One', link='https://x.example/1')]))
    monkeypatch.setattr(web, 'feed_get', fetch)
    added = await logged.client.post('/api/subscriptions', json={'target': '2', 'urls': [logged.feed.link]}, headers={'Origin': ORIGIN})
    assert (await added.json())['results'][0]['status'] == 'created'
    await asyncio.sleep(.2)
    assert fetch.await_count == 0
