from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from lxml import etree

from src import db
from src.command import inner
from src.management import feed_options
from src.monitor._monitor import Monitor
from conftest import ORIGIN, token

WRITE = {'Origin': ORIGIN}


def endpoint(ctx, suffix='recipients'):
    return f'/api/feeds/{ctx.feed.id}/{suffix}'


async def test_append_preserves_shared_feed_and_customizations(logged):
    await db.Sub.filter(id=logged.sub.id).update(state=0, title='Keep', send_mode=2)
    await db.User.filter(id=2).update(interval=6)
    response = await logged.client.put(endpoint(logged), headers=WRITE,
        json={'mode':'append', 'targets':['-1001', '2', '2']})
    assert response.status == 200
    assert await db.Feed.all().count() == 1
    assert await db.Sub.filter(feed_id=logged.feed.id).count() == 3
    old = await db.Sub.get(id=logged.sub.id)
    assert (old.state, old.title, old.send_mode) == (0, 'Keep', 2)
    assert (await db.Sub.get(user_id=2)).send_mode == -100
    assert db.EffectiveTasks.get_interval(logged.feed.id) == 6


async def test_scoped_replace_does_not_remove_outside_scope(logged):
    headers = await token(logged, targets=['-1001','2'])
    response = await logged.client.put(endpoint(logged), headers=headers,
        json={'mode':'replace', 'targets':['2']})
    assert response.status == 200
    assert (await response.json())['scope'] == 'authorized_targets'
    assert set(await db.Sub.all().values_list('user_id', flat=True)) == {2, -1002}
    assert (await logged.client.put(endpoint(logged), headers=headers,
        json={'mode':'replace','targets':['-1002']})).status == 403
    read = await token(logged, 'read', ['2'])
    assert (await logged.client.put(endpoint(logged), headers=read,
        json={'mode':'replace','targets':[]})).status == 403


@pytest.mark.parametrize('failure', ['limit', 'banned', 'left', 'permission'])
async def test_preflight_failure_preserves_relations(logged, failure):
    if failure == 'limit':
        await db.User.filter(id=2).update(sub_limit=0)
    if failure == 'banned':
        await db.User.filter(id=2).update(state=-1)
    if failure == 'left':
        await logged.store.target(2, 'Disabled', None, 'private', 'left')
    if failure == 'permission':
        logged.gateway.denied = True
    response = await logged.client.put(endpoint(logged), headers=WRITE,
        json={'mode':'replace','targets':['1','2']})
    assert response.status == 409
    assert set(await db.Sub.all().values_list('user_id', flat=True)) == {-1001, -1002}


async def test_transaction_rolls_back_after_deletions(logged, monkeypatch):
    original = inner.utils.update_interval
    calls = 0
    async def fail_once(feed, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            await original(feed, **kwargs)
            raise RuntimeError('Injected after relation and feed deletion')
        return await original(feed)
    monkeypatch.setattr(inner.utils, 'update_interval', fail_once)
    response = await logged.client.put(endpoint(logged), headers=WRITE,
        json={'mode':'replace','targets':[]})
    assert response.status == 500
    assert set(await db.Sub.all().values_list('user_id', flat=True)) == {-1001, -1002}
    assert await db.Feed.filter(id=logged.feed.id).exists()
    assert db.EffectiveTasks.get_interval(logged.feed.id) == 10


async def test_export_filters_selection_deduplication_and_scope(logged):
    other = await db.Feed.create(title='Second', link='https://example.org/second')
    selected = await db.Sub.create(user_id=-1001, feed=other, state=0)
    async def urls(query, headers=None):
        response = await logged.client.get('/api/subscriptions/opml?' + query, headers=headers)
        assert response.status == 200
        return etree.fromstring(await response.read()).xpath('.//outline/@xmlUrl')
    assert await urls('') == [logged.feed.link, other.link]
    assert await urls('target=-1001&state=0') == [other.link]
    assert await urls(f'ids={selected.id}') == [other.link]
    assert await urls('q=Second') == [other.link]
    assert await urls('attention=1') == []
    headers = await token(logged)
    assert (await logged.client.get(f'/api/subscriptions/opml?ids={logged.other.id}', headers=headers)).status == 404
    assert (await logged.client.get('/api/subscriptions/opml?target=-1002', headers=headers)).status == 403


@pytest.mark.parametrize('ua', ['bad\r\nX-Injected: 1', 'x'*513, 'bad\x00', '中文', 123])
async def test_invalid_ua(logged, ua):
    assert (await logged.client.patch(endpoint(logged, 'fetch-options'), headers=WRITE,
        json={'user_agent':ua})).status == 400


async def test_monitor_passes_ua_and_clear_inherits(logged, monkeypatch):
    path = endpoint(logged, 'fetch-options')
    assert (await logged.client.patch(path, headers=WRITE, json={'user_agent':'Reader/3'})).status == 200
    monkeypatch.setattr(feed_options, 'store', logged.store)
    headers = await token(logged)
    assert (await logged.client.patch(path, headers=headers, json={'user_agent':'bad'})).status == 403
    from src.monitor import _monitor
    seen = []
    class ReachedRequest(Exception):
        pass
    async def capture(url, **kwargs):
        seen.append(kwargs['headers'])
        raise ReachedRequest()
    monkeypatch.setattr(_monitor.web, 'feed_get', capture)
    fake = SimpleNamespace(_stat=None)
    with pytest.raises(ReachedRequest):
        await Monitor._do_monitor_a_feed(fake, logged.feed, datetime.now(timezone.utc))
    assert seen[-1]['User-Agent'] == 'Reader/3'
    assert 'If-Modified-Since' in seen[-1]
    assert (await logged.client.patch(path, headers=WRITE, json={'user_agent':''})).status == 200
    with pytest.raises(ReachedRequest):
        await Monitor._do_monitor_a_feed(fake, logged.feed, datetime.now(timezone.utc))
    assert 'User-Agent' not in seen[-1]


async def test_schedule_published_only_after_commit(logged, monkeypatch):
    await db.User.filter(id=2).update(interval=6)
    original = inner.utils.update_interval
    observed = []
    async def observe(feed, **kwargs):
        result = await original(feed, **kwargs)
        observed.append(db.EffectiveTasks.get_interval(logged.feed.id))
        return result
    monkeypatch.setattr(inner.utils, 'update_interval', observe)
    assert (await logged.client.put(endpoint(logged), headers=WRITE,
        json={'mode':'replace','targets':['2']})).status == 200
    assert observed == [10]
    assert db.EffectiveTasks.get_interval(logged.feed.id) == 6
    assert (await logged.client.put(endpoint(logged), headers=WRITE,
        json={'mode':'replace','targets':[]})).status == 200
    assert not await db.Feed.filter(id=logged.feed.id).exists()
    assert db.EffectiveTasks.get_interval(logged.feed.id) is None
