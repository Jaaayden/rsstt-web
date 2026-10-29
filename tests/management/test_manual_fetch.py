import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from feedparser import FeedParserDict

from src import db, web
from src.management import manual_fetch
from src.management.server import create_app
from src.management.service import Service
from src.monitor._monitor import Monitor, TaskState
from src.monitor._notifier import Notifier
from conftest import ORIGIN, PASSWORD, token


@pytest.fixture(autouse=True)
def isolated_monitor(monkeypatch):
    monkeypatch.setattr(Monitor, '_singleton', None)


def response(feed, entries=None, status=200):
    return SimpleNamespace(status=status, url=feed.link, error=None,
        rss_d=FeedParserDict(feed=FeedParserDict(title='Example'), entries=entries or []),
        web_response=SimpleNamespace(etag='fresh-etag', last_modified=None),
        calc_next_check_as_per_server_side_cache=lambda: None)


async def submit(context, mode='updates', **values):
    return await context.client.post(f'/api/subscriptions/{context.sub.id}/fetch-now',
        json={'mode': mode, 'confirm': True, **values}, headers={'Origin': ORIGIN})


async def completed(context, job):
    for _ in range(200):
        result = await (await context.client.get('/api/fetch-jobs/' + job['id'])).json()
        if result['status'] not in ('queued', 'running'):
            return result
        await asyncio.sleep(.001)
    raise AssertionError('Manual job did not complete')


async def test_admin_confirmation_and_availability(context):
    path = f'/api/subscriptions/{context.sub.id}/fetch-now'
    assert (await context.client.get(path)).status == 401
    headers = await token(context)
    assert (await context.client.get(path, headers=headers)).status == 403
    assert (await context.client.post(path, json={'mode':'updates','confirm':True}, headers=headers)).status == 403
    await context.client.post('/api/login', json={'password':PASSWORD}, headers={'Origin':ORIGIN})
    details = await (await context.client.get(path)).json()
    assert details['available'] and details['affected_recipients'] == 2
    assert details['modes'] == ['updates', 'test_latest']
    assert (await submit(context, confirm=False)).status == 400
    assert (await submit(context, mode='unknown')).status == 400
    assert (await context.client.get('/api/fetch-jobs/not-known')).status == 404


async def test_updates_bypass_backoff_but_keep_baseline_and_shared_dedup(logged, monkeypatch):
    logged.feed.next_check_time = datetime.now(timezone.utc) + timedelta(days=1)
    logged.feed.etag = 'old-etag'
    await logged.feed.save()
    await logged.store.execute('INSERT INTO feed_fetch_options VALUES (?,?)', (logged.feed.link, 'Shared-Feed-UA'))
    entries = [FeedParserDict(guid='entry-1', title='One', link='https://example.invalid/one')]
    fetch = AsyncMock(return_value=response(logged.feed, entries))
    monkeypatch.setattr(web, 'feed_get', fetch)
    notify = AsyncMock()
    monkeypatch.setattr(Notifier, 'notify_all', notify)
    job = await (await submit(logged)).json()
    result = await completed(logged, job)
    assert result['status'] == 'completed'
    assert result['result']['new_entries'] == 1 and result['result']['push_status'] == 'submitted'
    assert result['result']['affected_recipients'] == 2
    headers = fetch.await_args.kwargs['headers']
    assert 'If-Modified-Since' not in headers and 'If-None-Match' not in headers
    assert headers['User-Agent'] == 'Shared-Feed-UA'
    notify.assert_awaited_once()
    await logged.feed.refresh_from_db()
    baseline = list(logged.feed.entry_hashes)
    # A second explicit check sees the same entry but never queues its delivery.
    manager = manual_fetch.ManualFetch(Service(logged.store, logged.gateway))
    try:
        again = await manager.submit(logged.sub.id, {'targets':None}, {'mode':'updates','confirm':True})
        await asyncio.gather(*tuple(manager.tasks.values()))
        result = manager.get(again['id'])
        assert result['result']['outcome'] == 'unchanged'
        assert result['result']['new_entries'] == 0 and result['result']['push_status'] == 'not_started'
        assert notify.await_count == 1
        await logged.feed.refresh_from_db()
        assert logged.feed.entry_hashes == baseline
    finally:
        await manager.close()


async def test_duplicate_requests_share_one_running_job(logged, monkeypatch):
    gate = asyncio.Event()

    async def waiting(*args, **kwargs):
        await gate.wait()
        return response(logged.feed)

    fetch = AsyncMock(side_effect=waiting)
    monkeypatch.setattr(web, 'feed_get', fetch)
    first, second = await asyncio.gather(submit(logged), submit(logged))
    a, b = await first.json(), await second.json()
    assert first.status == second.status == 202 and a['id'] == b['id']
    assert fetch.await_count <= 1
    conflict = await submit(logged, mode='test_latest')
    assert conflict.status == 409 and (await conflict.json())['code'] == 'MANUAL_FETCH_BUSY'
    gate.set()
    assert (await completed(logged, a))['status'] == 'completed'
    assert fetch.await_count == 1


async def test_scheduler_and_manual_work_do_not_overlap(logged, monkeypatch):
    monitor = Monitor.get_instance()
    resubmit = Mock()
    monkeypatch.setattr(monitor, 'submit_feed', resubmit)
    monitor._subtask_defer_map[logged.feed.id] = TaskState.IN_PROGRESS
    result = await submit(logged)
    assert result.status == 409 and (await result.json())['code'] == 'MANUAL_FETCH_BUSY'
    monitor._subtask_defer_map.clear()
    # A scheduled callback already queued before the manual claim also skips.
    async with monitor.manual_slot(logged.feed.id):
        assert monitor._defer_feed_id(logged.feed.id) is True
        await monitor._do_monitor_subtask(logged.feed, datetime.now(timezone.utc))
    assert not monitor._manual_feeds and not monitor._subtask_defer_map
    resubmit.assert_called_once_with(logged.feed.id, 'resubmit scheduled check after manual task')


@pytest.mark.parametrize('state,kind,code', [
    (-1, None, 'MANUAL_FETCH_BANNED'),
    (1, 'left', 'MANUAL_FETCH_DEPARTED'),
    (1, 'banned', 'MANUAL_FETCH_DEPARTED'),
    (1, 'disabled', 'MANUAL_FETCH_DEPARTED'),
])
async def test_banned_and_departed_recipients_cannot_send(logged, state, kind, code):
    await db.User.filter(id=logged.sub.user_id).update(state=state)
    if kind:
        await logged.store.execute('UPDATE targets SET membership=? WHERE id=?', (kind, str(logged.sub.user_id)))
    result = await submit(logged, mode='test_latest')
    assert result.status == 409 and (await result.json())['code'] == code


async def test_paused_subscription_and_inactive_feed_cannot_bypass_service_controls(logged):
    await db.Sub.filter(id=logged.sub.id).update(state=0)
    assert (await (await submit(logged)).json())['code'] == 'MANUAL_FETCH_PAUSED'
    await db.Sub.filter(id=logged.sub.id).update(state=1)
    await db.Feed.filter(id=logged.feed.id).update(state=0)
    assert (await (await submit(logged)).json())['code'] == 'MANUAL_FETCH_INACTIVE'


async def test_ban_during_fetch_is_rechecked_before_delivery(logged, monkeypatch):
    async def fetching(*args, **kwargs):
        await db.User.filter(id=logged.sub.user_id).update(state=-1)
        await logged.store.execute("UPDATE targets SET membership='left' WHERE id=?", (str(logged.other.user_id),))
        return response(logged.feed, [FeedParserDict(guid='new-entry', title='One')])

    monkeypatch.setattr(web, 'feed_get', fetching)
    notifier = AsyncMock()
    monkeypatch.setattr(Notifier, 'notify_all', notifier)
    result = await completed(logged, await (await submit(logged)).json())
    assert result['result']['affected_recipients'] == 0
    assert result['result']['push_status'] == 'not_started'


async def test_latest_test_targets_one_chat_preserves_hashes_and_uses_source_ua(logged, monkeypatch):
    logged.feed.entry_hashes = ['old-baseline']
    await logged.feed.save()
    await logged.store.execute('INSERT INTO feed_fetch_options VALUES (?,?)', (logged.feed.link, 'Feed-Test-UA'))
    fetch = AsyncMock(return_value=response(logged.feed, [FeedParserDict(guid='new-entry', title='One')]))
    monkeypatch.setattr(web, 'feed_get', fetch)
    send = AsyncMock(return_value=True)
    monkeypatch.setattr(manual_fetch, 'get_post_from_entry', AsyncMock(return_value=SimpleNamespace(send_formatted_post_according_to_sub=send)))
    result = await completed(logged, await (await submit(logged, mode='test_latest')).json())
    assert result['status'] == 'completed' and result['result']['push_status'] == 'confirmed'
    assert result['affected_recipients'] == 1
    assert send.await_args.args[0].id == logged.sub.id and send.await_count == 1
    assert fetch.await_args.kwargs['headers'] == {'User-Agent':'Feed-Test-UA'}
    await logged.feed.refresh_from_db()
    assert logged.feed.entry_hashes == ['old-baseline']


async def test_unconfirmed_test_and_private_exceptions_never_claim_delivery(logged, monkeypatch):
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=response(logged.feed, [FeedParserDict(guid='new-entry')])) )
    monkeypatch.setattr(manual_fetch, 'get_post_from_entry', AsyncMock(return_value=SimpleNamespace(
        send_formatted_post_according_to_sub=AsyncMock(return_value=False))))
    result = await completed(logged, await (await submit(logged, mode='test_latest')).json())
    assert result['status'] == 'failed' and result['code'] == 'MANUAL_PUSH_UNCONFIRMED'
    manager = manual_fetch.ManualFetch(Service(logged.store, logged.gateway))
    monkeypatch.setattr(web, 'feed_get', AsyncMock(side_effect=RuntimeError('private-body-and-token')))
    try:
        job = await manager.submit(logged.sub.id, {'targets':None}, {'mode':'test_latest','confirm':True})
        await asyncio.gather(*tuple(manager.tasks.values()))
        assert manager.get(job['id'])['status'] == 'failed'
        assert 'private-body-and-token' not in json.dumps(await logged.store.diagnostics.history({}))
    finally:
        await manager.close()


async def test_snapshot_refuses_and_demo_simulates_without_transport(context, aiohttp_client, monkeypatch):
    async def app_client(snapshot):
        origin = 'http://127.0.0.1:8787'
        app = await create_app(context.store, PASSWORD, origin, context.gateway, demo=True, snapshot=snapshot)
        client = await aiohttp_client(app)
        await client.post('/api/login', json={'password':PASSWORD}, headers={'Origin':origin})
        return client, origin

    client, origin = await app_client({'captured_at':'2026-10-28','counts':{}})
    path = f'/api/subscriptions/{context.sub.id}/fetch-now'
    result = await client.post(path, json={'mode':'updates','confirm':True}, headers={'Origin':origin})
    assert result.status == 409 and (await result.json())['code'] == 'MANUAL_FETCH_OFFLINE'
    assert (await (await client.get(path)).json())['available'] is False
    await client.close()
    client, origin = await app_client(None)
    result = await client.post(path, json={'mode':'test_latest','confirm':True}, headers={'Origin':origin})
    job = await result.json()
    for _ in range(100):
        job = await (await client.get('/api/fetch-jobs/' + job['id'])).json()
        if job['status'] == 'completed':
            break
        await asyncio.sleep(.001)
    assert job['simulated'] is True and job['result']['push_status'] == 'simulated'
    await client.close()


async def test_active_limit_history_expiry_and_shutdown_cleanup(logged, monkeypatch):
    manager = manual_fetch.ManualFetch(Service(logged.store, logged.gateway))
    gate = asyncio.Event()
    # An async callable is used so asyncio.wait_for receives a real awaitable.
    async def wait(*args):
        await gate.wait()
        return dict(outcome='empty',push_status='not_started',new_entries=0)
    monkeypatch.setattr(manager, 'execute', wait)
    ids = [logged.sub.id]
    for number in range(3):
        feed = await db.Feed.create(link=f'https://example.invalid/{number}', title='Another')
        ids.append((await db.Sub.create(feed=feed, user_id=logged.sub.user_id)).id)
    jobs = []
    try:
        for ident in ids[:3]:
            jobs.append(await manager.submit(ident, {'targets':None}, {'mode':'updates','confirm':True}))
        from src.management.service import Problem
        with pytest.raises(Problem) as failure:
            await manager.submit(ids[3], {'targets':None}, {'mode':'updates','confirm':True})
        assert failure.value.code == 'MANUAL_FETCH_LIMIT'
        await manager.close()
        assert not manager.tasks and not Monitor.get_instance()._manual_feeds
        assert all(manager.get(job['id'])['status'] == 'failed' for job in jobs)
        monkeypatch.setattr(manual_fetch, 'HISTORY_SECONDS', 0)
        with pytest.raises(Problem):
            manager.get(jobs[0]['id'])
    finally:
        await manager.close()


async def test_shutdown_cancels_even_a_job_that_has_not_started(logged, monkeypatch):
    manager = manual_fetch.ManualFetch(Service(logged.store, logged.gateway))
    async def waiting(*args):
        await asyncio.Event().wait()
    monkeypatch.setattr(manager, 'execute', waiting)
    job = await manager.submit(logged.sub.id, {'targets':None}, {'mode':'updates','confirm':True})
    await manager.close()
    assert manager.get(job['id'])['status'] == 'failed'
    assert not manager.tasks and not Monitor.get_instance()._manual_feeds


async def test_finished_history_is_bounded_and_expired_jobs_are_removed(logged, monkeypatch):
    manager = manual_fetch.ManualFetch(Service(logged.store, logged.gateway), snapshot=False)
    async def no_transport(*args):
        return dict(outcome='empty',push_status='not_started',new_entries=0)
    monkeypatch.setattr(manager, 'execute', no_transport)
    monkeypatch.setattr(manual_fetch, 'HISTORY_LIMIT', 4)
    try:
        for _ in range(10):
            job = await manager.submit(logged.sub.id, {'targets':None}, {'mode':'updates','confirm':True})
            await asyncio.gather(*tuple(manager.tasks.values()))
            manager.jobs[job['id']]['_updated'] -= 3
        assert len(manager.jobs) == 4 and len(manager.feed_jobs) == 1
        assert not manager.tasks
    finally:
        await manager.close()


async def test_task_timeout_releases_feed_and_does_not_claim_delivery(logged, monkeypatch):
    manager = manual_fetch.ManualFetch(Service(logged.store, logged.gateway))
    async def no_response(*args):
        await asyncio.Event().wait()
    monkeypatch.setattr(manager, 'execute', no_response)
    monkeypatch.setattr(manual_fetch, 'TASK_TIMEOUT', .001)
    try:
        job = await manager.submit(logged.sub.id, {'targets':None}, {'mode':'test_latest','confirm':True})
        await asyncio.gather(*tuple(manager.tasks.values()))
        final = manager.get(job['id'])
        assert final['status'] == 'failed' and final['code'] == 'MANUAL_FETCH_TIMEOUT'
        assert final['result'] is None and not Monitor.get_instance()._manual_feeds
    finally:
        await manager.close()


@pytest.mark.parametrize('stage', ['parse', 'send'])
async def test_latest_failures_are_visible_in_delivery_logs_without_article_text(logged, monkeypatch, stage):
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=response(logged.feed, [FeedParserDict(guid='one')])) )
    error = RuntimeError('private-article-content-and-secret')
    post = SimpleNamespace(send_formatted_post_according_to_sub=AsyncMock(side_effect=error))
    monkeypatch.setattr(manual_fetch, 'get_post_from_entry',
                        AsyncMock(side_effect=error) if stage == 'parse' else AsyncMock(return_value=post))
    final = await completed(logged, await (await submit(logged, mode='test_latest')).json())
    assert final['status'] == 'failed'
    history = await logged.store.diagnostics.history({'category':'delivery'})
    assert history['items'][0]['context']['stage'] == stage
    assert history['items'][0]['detail'] == 'RuntimeError'
    assert 'private-article-content-and-secret' not in json.dumps(history)
