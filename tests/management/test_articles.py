import asyncio
import json
from datetime import datetime
from unittest.mock import AsyncMock

import pytest

from src.management import articles, backups
from src.management.store import Store
from conftest import token
from test_backups import files, changed, rows


def entry(number=1, **values):
    return {**dict(guid=f'entry-{number}', title=f'Article {number}', link=f'https://example.test/article/{number}',
                   summary=f'<p>Summary {number}</p>'), **values}


async def test_article_api_requires_browser_admin_and_empty_history_is_unknown(context):
    path = f'/api/subscriptions/{context.sub.id}/articles'
    assert (await context.client.get(path)).status == 401
    assert (await context.client.get(path, headers=await token(context))).status == 403
    await context.client.post('/api/login', json={'password': 'console-test-password'}, headers={'Origin': 'http://console.test'})
    data = await (await context.client.get(path)).json()
    assert data['items'] == [] and data['retention'] == dict(per_feed=20, max_entries=10000)
    assert data['subscription_id'] == str(context.sub.id)
    assert data['target'] == dict(id='-1001', title='Target -1001')
    assert data['feed'] == dict(id=str(context.feed.id), title='Example')
    assert data['started_at'] and data['degraded'] is False and data['dropped'] == 0
    assert (await context.client.get('/api/subscriptions/999999/articles')).status == 404
    assert (await (await context.client.get('/api/public')).json())['features']['articles'] is True


async def test_shared_body_has_independent_target_evidence_and_success_survives_retry(logged):
    cache = logged.store.articles
    post = entry()
    await cache.capture(logged.feed.id, [post, entry(2)])
    unknown = await cache.history(logged.feed.id, -1001)
    assert [item['status'] for item in unknown['items']] == ['not_recorded', 'not_recorded']
    await cache.mark(logged.feed.id, post, -1001, 'queued')
    await cache.mark(logged.feed.id, post, -1001, 'sent')
    await cache.mark(logged.feed.id, post, -1002, 'failed', 'RPCError: permission denied', source='manual')
    first = (await cache.history(logged.feed.id, -1001))['items'][0]
    assert first['status'] == 'sent' and first['last_sent_at']
    second = (await cache.history(logged.feed.id, -1002))['items'][0]
    assert second['status'] == 'failed' and second['last_sent_at'] is None
    assert second['source'] == 'manual' and 'permission denied' in second['detail']
    await cache.capture(logged.feed.id, [post, entry(2)])
    await cache.mark(logged.feed.id, post, -1001, 'queued')
    await cache.mark(logged.feed.id, post, -1001, 'failed', 'TimeoutError')
    retry = (await cache.history(logged.feed.id, -1001))['items'][0]
    assert retry['status'] == 'sent' and retry['last_sent_at'] == first['last_sent_at']
    assert retry['last_attempt_status'] == 'failed' and retry['detail'] == 'TimeoutError'
    assert (await logged.store.rows('SELECT COUNT(*) AS n FROM article_cache'))[0]['n'] == 2
    assert (await logged.store.rows('SELECT COUNT(*) AS n FROM article_deliveries'))[0]['n'] == 2
    a = await (await logged.client.get(f'/api/subscriptions/{logged.sub.id}/articles')).json()
    b = await (await logged.client.get(f'/api/subscriptions/{logged.other.id}/articles')).json()
    assert a['items'][0]['status'] == 'sent' and b['items'][0]['status'] == 'failed'


@pytest.mark.parametrize('link', ['javascript:alert(1)', 'data:text/html,evil', '//example.test/path',
                                'https://user:password@example.test/path', 'https://user@example.test/',
                                'https://example.test:invalid/', 'https://example.test/\npath',
                                'https://example.test\\evil/'])
def test_unsafe_article_links_are_rejected(link):
    assert articles.safe_link(link) is None


async def test_cached_preview_is_plain_bounded_text_and_keeps_valid_publication_time(context):
    raw = dict(guid='unsafe', title='<b>Title</b><script>private-script()</script>',
               link='https://example.test/article?view=full', published='2026-10-29T12:30:00+08:00',
               summary='<p>Hello <a href="javascript:alert(1)">world</a></p><img src="https://tracker.test/pixel">'
                       '<style>hidden-style</style><iframe>hidden-frame</iframe>' + '文' * 3000)
    await context.store.articles.capture(context.feed.id, [raw])
    item = (await context.store.articles.history(context.feed.id, -1001))['items'][0]
    assert item['title'] == 'Title'
    assert item['summary'].startswith('Hello world') and len(item['summary']) == 2000
    for forbidden in ('private-script', 'hidden-style', 'hidden-frame', '<img', 'tracker.test', 'javascript:'):
        assert forbidden not in json.dumps(item)
    assert datetime.fromisoformat(item['published_at']).hour == 4
    assert item['link'] == raw['link']
    assert articles.article_key(raw) == articles.article_key({**raw, 'title': 'Edited title'})
    await context.store.articles.capture(context.feed.id, [dict(guid='long', title='题' * 800, summary='摘' * 5000)])
    long = (await context.store.articles.history(context.feed.id, -1001))['items'][0]
    assert len(long['title']) == 500 and len(long['summary']) == 2000 and long['link'] is None


async def test_latest_twenty_prune_associated_delivery_and_old_test_cannot_displace_them(context):
    cache = context.store.articles
    old = entry()
    await cache.capture(context.feed.id, [old])
    await cache.mark(context.feed.id, old, -1001, 'sent')
    await cache.flush()
    latest = [entry(number) for number in range(100, 125)]
    await cache.capture(context.feed.id, latest)
    await cache.flush()
    await cache.mark(context.feed.id, old, -1001, 'sent', source='test')
    await cache.mark(context.feed.id, entry('other-old-test'), -1001, 'sent', source='test')
    data = await cache.history(context.feed.id, -1001)
    assert len(data['items']) == 20
    assert [item['title'] for item in data['items']] == [f'Article {number}' for number in range(100, 120)]
    assert all(item['status'] == 'not_recorded' for item in data['items'])
    assert (await context.store.rows('SELECT COUNT(*) AS n FROM article_deliveries'))[0]['n'] == 0


async def test_real_global_ten_thousand_bound_cleans_orphan_delivery_rows(context):
    cache = context.store.articles
    for feed in range(1, 502):
        posts = [entry(f'{feed}-{number}') for number in range(20)]
        await cache.capture(feed, posts)
        if feed == 1:
            await cache.mark(feed, posts[0], -1001, 'sent')
        if feed % 50 == 0:
            await cache.flush()
    await cache.flush()
    assert cache.degraded is False and cache.dropped == 0
    assert (await context.store.rows('SELECT COUNT(*) AS n FROM article_cache'))[0]['n'] == 10000
    assert (await context.store.rows('SELECT COUNT(*) AS n FROM article_cache WHERE feed_id=\'1\''))[0]['n'] == 0
    assert (await context.store.rows('SELECT COUNT(*) AS n FROM article_deliveries'))[0]['n'] == 0


async def test_delivery_bound_and_coalescing_avoid_per_mark_tasks(context, monkeypatch):
    cache = context.store.articles
    tasks = len(asyncio.all_tasks())
    post = entry()
    await cache.capture(context.feed.id, [post])
    for _ in range(1000):
        await cache.mark(context.feed.id, post, -1001, 'queued')
        await cache.mark(context.feed.id, post, -1001, 'sent')
    assert len(asyncio.all_tasks()) == tasks
    assert len(cache.pending_articles) == 1 and len(cache.pending_deliveries) == 1
    assert cache.dropped == 0
    monkeypatch.setattr(articles, 'MAX_DELIVERIES', 3)
    for target in range(4):
        await cache.mark(context.feed.id, post, target, 'sent')
    await cache.flush()
    assert (await context.store.rows('SELECT COUNT(*) AS n FROM article_deliveries'))[0]['n'] == 3


async def test_article_storage_failure_and_overflow_are_visible_without_affecting_bot(context, monkeypatch):
    cache = context.store.articles
    monkeypatch.setattr(articles, 'MAX_PENDING_ARTICLES', 2)
    monkeypatch.setattr(articles, 'MAX_PENDING_DELIVERIES', 2)
    await cache.capture(context.feed.id, [entry(i) for i in range(4)])
    for target in range(4):
        await cache.mark(context.feed.id, entry(3), target, 'queued')
    assert len(cache.pending_articles) == 2 and len(cache.pending_deliveries) == 2 and cache.dropped == 4
    with monkeypatch.context() as patch:
        patch.setattr(context.store.db, 'executemany', AsyncMock(side_effect=OSError('token=private-error')))
        await cache.flush()
    data = await cache.history(context.feed.id, -1001)
    assert data['degraded'] is True and data['dropped'] == 8 and data['items'] == []
    await cache.capture(context.feed.id, [entry()])
    assert (await cache.history(context.feed.id, -1001))['degraded'] is False


async def test_restart_turns_queued_into_unconfirmed_but_preserves_confirmed_success(tmp_path):
    store = await Store(tmp_path / 'console.sqlite3').open()
    cache = store.articles
    await cache.capture(1, [entry()])
    await cache.mark(1, entry(), -1001, 'queued')
    await cache.mark(1, entry(), -1002, 'sent')
    await cache.mark(1, entry(), -1002, 'queued')
    await asyncio.gather(store.close(), store.close())
    store = await Store(tmp_path / 'console.sqlite3').open()
    try:
        a = (await store.articles.history(1, -1001))['items'][0]
        b = (await store.articles.history(1, -1002))['items'][0]
        assert a['status'] == 'unconfirmed' and a['last_sent_at'] is None
        assert b['status'] == 'sent' and b['last_sent_at'] and b['last_attempt_status'] == 'unconfirmed'
    finally:
        await store.close()


async def test_global_capture_is_disabled_until_installed_and_close_uninstalls(tmp_path):
    articles.uninstall()
    assert articles.current() is None
    assert await articles.capture(1, [entry()]) is False
    assert await articles.mark(1, entry(), -1001, 'sent') is False
    store = await Store(tmp_path / 'console.sqlite3').open()
    articles.install(store)
    assert articles.current() is store.articles
    assert await articles.capture(1, [entry()]) is True
    assert await articles.mark(1, entry(), -1001, 'sent') is True
    await store.close()
    assert articles.current() is None


async def test_all_backup_restores_clear_excluded_cache_and_delivery_evidence(files):
    main, console = files
    raw = backups.export(main, console)
    package = json.loads(raw)
    assert 'recent_articles' in package['manifest']['excluded']
    assert not any('article' in name for name in package['data'])
    old = changed(raw, lambda package: package['manifest']['excluded'].remove('recent_articles'))
    for source in (raw, old):
        store = await Store(console).open()
        await store.articles.capture(1, [entry()])
        await store.articles.mark(1, entry(), 1, 'sent')
        await store.close()
        assert rows(console, 'SELECT COUNT(*) FROM article_cache') == [(1,)]
        backups.restore(main, console, source)
        assert rows(console, 'SELECT COUNT(*) FROM article_cache') == [(0,)]
        assert rows(console, 'SELECT COUNT(*) FROM article_deliveries') == [(0,)]
        assert rows(console, "SELECT * FROM meta WHERE key='articles_started_at'") == []
