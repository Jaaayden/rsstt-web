"""Behaviour added in the console overhaul: access by any host, detail/status
endpoints, static assets and readable administrator notifications."""
from conftest import ORIGIN, PASSWORD
from src import db, env
from src.management.notifications import Notifications


async def test_login_from_the_host_actually_used(context):
    """Opening the console via localhost/IP instead of WEB_ORIGIN must still sign in."""
    host = context.client.server.host + ':' + str(context.client.server.port)
    ok = await context.client.post('/api/login', json={'password': PASSWORD}, headers={'Origin': f'http://{host}'})
    assert ok.status == 200
    # Writes from that same origin are accepted, foreign origins are not.
    same = await context.client.patch(f'/api/subscriptions/{context.sub.id}', json={'title': 'Renamed'},
                                      headers={'Origin': f'http://{host}'})
    assert same.status == 200
    foreign = await context.client.patch(f'/api/subscriptions/{context.sub.id}', json={'title': 'Evil'},
                                         headers={'Origin': 'https://attacker.example'})
    assert foreign.status == 403
    missing = await context.client.patch(f'/api/subscriptions/{context.sub.id}', json={'title': 'Evil'})
    assert missing.status == 403


async def test_login_rejects_foreign_origin(context):
    response = await context.client.post('/api/login', json={'password': PASSWORD},
                                         headers={'Origin': 'https://attacker.example'})
    assert response.status == 403


async def test_subscription_detail_and_status(logged):
    detail = await logged.client.get(f'/api/subscriptions/{logged.sub.id}')
    assert detail.status == 200
    body = await detail.json()
    assert body['id'] == logged.sub.id and body['target'] == '-1001' and body['url'] == 'https://example.com/rss'
    assert (await logged.client.get('/api/subscriptions/999999')).status == 404
    # The OPML export route keeps working next to the numeric detail route.
    assert (await logged.client.get('/api/subscriptions/opml')).status == 200
    status = await (await logged.client.get('/api/status')).json()
    assert status['bot']['username'] == 'test_bot'
    assert status['attention'] == 0 and status['uptime_seconds'] >= 0


async def test_dashboard_lists_worst_feeds_first(logged):
    worse = await db.Feed.create(link='https://example.com/worse', title='Worse', error_count=40)
    await db.Sub.create(user_id=1, feed=worse)
    await db.Feed.filter(id=logged.feed.id).update(error_count=5)
    data = await (await logged.client.get('/api/dashboard')).json()
    assert [item['title'] for item in data['attention']][0] == 'Worse'


async def test_static_assets(context):
    for name in ('app.js', 'core.js', 'ui.js', 'vendor-preact.js', 'app.css', 'mark.svg', 'page-chats.js'):
        response = await context.client.get(f'/assets/{name}')
        assert response.status == 200, name
    for name in ('missing.js', '..%2Fserver.py', 'server.py', 'APP.JS'):
        assert (await context.client.get(f'/assets/{name}')).status == 404, name
    index = await (await context.client.get('/')).text()
    assert '/assets/app.js' in index


async def test_bot_channel_and_readable_messages(context, monkeypatch):
    engine = await Notifications(context.store, origin='https://console.example').open()
    summary = await engine.configure({'channels': {'bot': {'enabled': True}}, 'policy': {'enabled': True}})
    assert summary['channels']['bot'] == {'enabled': True, 'configured': True}
    rejected = None
    try:
        await engine.configure({'channels': {'bot': {'enabled': True, 'url': 'https://x'}}})
    except Exception as error:
        rejected = error
    assert rejected is not None

    await db.Feed.filter(id=context.feed.id).update(error_count=7)
    title, body = await engine.compose({'event': 'fetch.failed', 'subject': str(context.feed.id), 'id': 1})
    assert '7' in body and 'Example' in body and 'https://example.com/rss' in body
    assert 'Target -1001' in body and 'https://console.example/#logs?feed=' in body
    assert 'fetch.failed' not in body

    await context.store.target(555, 'Stranger', 'stranger', 'private', 'available')
    title, body = await engine.compose({'event': 'user.first_seen', 'subject': '555', 'id': 2})
    assert 'Stranger' in body and '@stranger' in body and '#chats?chat=555' in body

    sent = []

    class Bot:
        async def send_message(self, chat, text, **kwargs):
            sent.append((chat, text))

    monkeypatch.setattr(env, 'bot', Bot(), raising=False)
    await engine.send('bot', {'enabled': True}, {'event': 'test', 'subject': 'administrator', 'id': 3})
    assert sent and sent[0][0] in env.MANAGER and 'administrator' not in sent[0][1]


async def test_recovery_notice_after_alert(context):
    engine = await Notifications(context.store, offline=True).open()
    await engine.configure({'policy': {'enabled': True}, 'channels': {'bot': {'enabled': True}}})
    await engine.event('fetch', '1', 3)
    await engine.event('fetch', '1', 0)
    await engine.event('fetch', '1', 0)
    events = [job['event'] for job in reversed(await engine.history())]
    assert events == ['fetch.failed', 'fetch.recovered']


async def test_hashtags_saved_like_set_hashtags(logged):
    for raw in ('#news, #tech', 'news tech', '#news #tech'):
        response = await logged.client.patch(f'/api/subscriptions/{logged.sub.id}', json={'tags': raw},
                                             headers={'Origin': ORIGIN})
        assert response.status == 200
        assert (await response.json())['tags'] == 'news tech', raw
    cleared = await logged.client.patch(f'/api/subscriptions/{logged.sub.id}', json={'tags': ''}, headers={'Origin': ORIGIN})
    assert (await cleared.json())['tags'] is None


async def test_bot_channel_reports_owner_never_started_bot(context, monkeypatch):
    engine = await Notifications(context.store).open()

    class Bot:
        async def send_message(self, chat, text, **kwargs):
            raise PermissionError('InputUserDeactivated')

    monkeypatch.setattr(env, 'bot', Bot(), raising=False)
    try:
        await engine.send('bot', {'enabled': True}, {'event': 'test', 'subject': 'administrator', 'id': 1})
    except Exception as error:
        assert 'Telegram rejected' in str(error)
    else:
        raise AssertionError('expected a delivery error')


async def test_assets_are_compressed_and_revalidated(context):
    first = await context.client.get('/assets/page-settings.js', headers={'Accept-Encoding': 'gzip'})
    assert first.status == 200 and first.headers['Content-Encoding'] == 'gzip'
    assert first.headers['Cache-Control'] == 'no-cache' and 'javascript' in first.headers['Content-Type']
    assert 'export function Settings' in await first.text()
    again = await context.client.get('/assets/page-settings.js', headers={'If-None-Match': first.headers['ETag']})
    assert again.status == 304
    api = await context.client.get('/api/public')
    assert api.headers['Cache-Control'] == 'no-store'


async def test_runtime_config_reports_current_value_and_source(logged):
    data = await (await logged.client.get('/api/runtime-config')).json()
    items = {item['key']: item for item in data['items']}
    assert items['MULTIUSER']['current'] is env.MULTIUSER
    assert items['MULTIUSER']['default'] is True
    assert items['HTTP_TIMEOUT']['current'] == env.HTTP_TIMEOUT and items['HTTP_TIMEOUT']['default'] == 12
    assert items['TOKEN']['current'] is True and 'value' not in items['TOKEN']
    for item in items.values():
        assert item['current_source'] in ('web', 'deployment', 'default')


async def test_generate_telegraph_tokens(logged, monkeypatch):
    from src.management import server
    async def fake(count):
        return [f'{i:02d}' + 'a' * 58 for i in range(count)]
    monkeypatch.setattr(server, 'create_telegraph_tokens', fake)
    response = await logged.client.post('/api/runtime-config/telegraph-tokens', json={'count': 3},
                                        headers={'Origin': ORIGIN})
    assert response.status == 200
    body = await response.json()
    assert body['added'] == 3 and body['total'] >= 3
    item = next(i for i in body['items'] if i['key'] == 'TELEGRAPH_TOKEN')
    assert item['configured'] and item['pending_restart'] and 'value' not in item
    # A second run appends instead of replacing.
    again = await (await logged.client.post('/api/runtime-config/telegraph-tokens', json={'count': 3},
                                            headers={'Origin': ORIGIN})).json()
    assert again['total'] == body['total']  # same fake tokens are de-duplicated


async def test_restart_schedules_graceful_exit(logged, monkeypatch):
    import asyncio
    from src.management import server
    calls = []
    monkeypatch.setattr(server, 'request_restart', lambda: calls.append('restart'))
    settings = await (await logged.client.get('/api/settings')).json()
    assert settings['restart']['supported'] is True and 'container' in settings['restart']
    boot = (await (await logged.client.get('/api/public')).json())['boot']
    assert isinstance(boot, str) and boot
    bad = await logged.client.post('/api/system/restart', json={}, headers={'Origin': ORIGIN})
    assert bad.status == 400 and not calls
    response = await logged.client.post('/api/system/restart', json={'confirm': True}, headers={'Origin': ORIGIN})
    assert response.status == 202
    await asyncio.sleep(1.3)
    assert calls == ['restart']


async def test_unchanged_feed_is_not_reparsed_or_rewritten(context, monkeypatch):
    from feedparser import FeedParserDict
    from src.management import articles
    cache = context.store.articles
    entries = [FeedParserDict(guid=f'g{i}', title=f'T{i}', link=f'https://example.com/{i}', summary='<p>x</p>')
               for i in range(3)]
    await cache.capture(context.feed.id, entries)
    await cache.flush()
    parsed = []
    original = articles._article
    monkeypatch.setattr(articles, '_article', lambda *a, **k: parsed.append(1) or original(*a, **k))
    await cache.capture(context.feed.id, entries)          # nothing new: no parsing, nothing queued
    assert parsed == [] and not cache.pending_articles
    newer = [FeedParserDict(guid='g9', title='New', link='https://example.com/9', summary='new'), *entries]
    await cache.capture(context.feed.id, newer)            # only the new entry is parsed
    assert len(parsed) == 1 and len(cache.pending_articles) == 1
    await cache.flush()
    titles = [item['title'] for item in (await cache.history(context.feed.id, -1001))['items']]
    assert titles[0] == 'New' and set(titles) == {'New', 'T0', 'T1', 'T2'}


async def test_healthy_fetches_skip_notification_storage(context):
    engine = await Notifications(context.store, offline=True).open()
    await engine.configure({'policy': {'enabled': True, 'threshold': 3}, 'channels': {'bot': {'enabled': True}}})
    for count in (0, 0, 1, 2, 0):
        await engine.event('fetch', '7', count)
    assert await context.store.rows("SELECT * FROM notify_seen WHERE kind='fetch'") == []
    await engine.event('fetch', '7', 3)                     # alert
    await engine.event('fetch', '7', 0)                     # recovery still detected via the cache
    assert [j['event'] for j in reversed(await engine.history())] == ['fetch.failed', 'fetch.recovered']
    await engine.configure({'policy': {'threshold': 1}})
    await engine.event('fetch', '8', 1)                     # new threshold applies immediately
    assert len(await engine.history()) == 3


async def test_sign_in_throttle_uses_proxy_client_ip(context):
    """Behind nginx + Cloudflare, one attacker must not lock out the owner."""
    headers = {'Origin': ORIGIN}
    for _ in range(10):
        await context.client.post('/api/login', json={'password': 'wrong-password-123'},
                                  headers={**headers, 'X-Real-IP': '203.0.113.7'})
    blocked = await context.client.post('/api/login', json={'password': PASSWORD},
                                        headers={**headers, 'X-Real-IP': '203.0.113.7'})
    assert blocked.status == 429
    owner = await context.client.post('/api/login', json={'password': PASSWORD},
                                      headers={**headers, 'X-Real-IP': '198.51.100.20'})
    assert owner.status == 200
    garbage = await context.client.post('/api/login', json={'password': PASSWORD},
                                        headers={**headers, 'X-Real-IP': 'not-an-ip'})
    assert garbage.status == 200


async def test_session_cookie_secure_follows_the_actual_scheme(context):
    """HTTPS via the reverse proxy gets a Secure cookie; an SSH tunnel on http://localhost still signs in."""
    proxied = await context.client.post('/api/login', json={'password': PASSWORD},
                                        headers={'Origin': ORIGIN, 'X-Forwarded-Proto': 'https'})
    assert proxied.status == 200 and 'Secure' in proxied.headers['Set-Cookie']
    host = context.client.server.host + ':' + str(context.client.server.port)
    tunnel = await context.client.post('/api/login', json={'password': PASSWORD},
                                       headers={'Origin': f'http://{host}'})
    assert tunnel.status == 200 and 'Secure' not in tunnel.headers['Set-Cookie']
    assert 'HttpOnly' in tunnel.headers['Set-Cookie'] and 'SameSite=Strict' in tunnel.headers['Set-Cookie']


async def test_settings_report_the_web_version_and_the_bot_core(logged, tmp_path, monkeypatch):
    from src.management import version
    data = await (await logged.client.get('/api/settings')).json()
    assert data['version'] == version.WEB_VERSION
    assert data['upstream_version'] == env.VERSION
    # Inside the image the build commit comes from /app/.version.
    fake = tmp_path / 'src' / 'management'
    fake.mkdir(parents=True)
    (tmp_path / '.version').write_text('dd50a40@web-v1.0.1\nbuild@2026-11-02\n')
    monkeypatch.setattr(version, '__file__', str(fake / 'version.py'))
    assert version.build() == 'dd50a40' and version.label() == f'RSStT Web {version.WEB_VERSION} (dd50a40)'
    (tmp_path / '.version').write_text('dirty\n')
    assert version.build() is None and version.label() == f'RSStT Web {version.WEB_VERSION}'
