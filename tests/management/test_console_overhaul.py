"""Behaviour added in the console overhaul: access by any host, detail/status
endpoints, static assets and readable administrator notifications."""
import json
from conftest import ORIGIN, PASSWORD, token
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
    assert data['upstream_version'] == 'v2.10.0' == version.core()
    # Inside the image the build commit comes from /app/.version.
    fake = tmp_path / 'src' / 'management'
    fake.mkdir(parents=True)
    (tmp_path / '.version').write_text('dd50a40@web-v1.0.1\nbuild@2026-11-02\n')
    monkeypatch.setattr(version, '__file__', str(fake / 'version.py'))
    assert version.build() == 'dd50a40' and version.label() == f'RSStT Web {version.WEB_VERSION} (dd50a40)'
    (tmp_path / '.version').write_text('dirty\n')
    assert version.build() is None and version.label() == f'RSStT Web {version.WEB_VERSION}'


# ---------- per-feed proxy ----------

SECRET_PROXY = 'socks5://proxy-user:very-secret@proxy.example.net:1080'


def test_fetch_tls_context_leaves_out_finite_field_dhe():
    """A server that picks a small DH group would otherwise fail the handshake (DH_KEY_TOO_SMALL) at random."""
    from src.web import req
    names = [cipher['name'] for cipher in req._fetch_ssl_context().get_ciphers()]
    assert names and not [name for name in names if name.startswith('DHE-')]
    assert any(name.startswith('ECDHE-') for name in names)
    assert any(name.startswith('TLS_') for name in names)  # TLS 1.3 stays


def test_proxy_resolution_order(monkeypatch):
    """explicit argument > per-URL setting > global R_PROXY (with its bypass rules)."""
    from src.web import req
    monkeypatch.setattr(req, 'PROXY', 'socks5://global.example:1080')
    monkeypatch.setattr(req, 'proxy_override', None)
    assert req.choose_proxy('https://a.example/rss', 'a.example') == 'socks5://global.example:1080'
    table = {'https://a.example/rss': False, 'https://b.example/rss': 'socks5h://own.example:1081'}
    monkeypatch.setattr(req, 'proxy_override', table.get)
    assert req.choose_proxy('https://a.example/rss', 'a.example') is None                # direct despite global
    assert req.choose_proxy('https://b.example/rss', 'b.example') == 'socks5://own.example:1081'  # socks5h normalised
    assert req.choose_proxy('https://c.example/rss', 'c.example') == 'socks5://global.example:1080'
    assert req.choose_proxy('https://b.example/rss', 'b.example', False) is None          # explicit beats stored
    assert req.choose_proxy('https://a.example/rss', 'a.example', 'http://t.example:8') == 'http://t.example:8'
    monkeypatch.setattr(req, 'PROXY', None)
    assert req.choose_proxy('https://c.example/rss', 'c.example') is None                 # no global proxy at all


async def test_feed_proxy_api_hides_credentials(logged):
    url = f'/api/feeds/{logged.feed.id}/fetch-options'
    headers = {'Origin': ORIGIN}
    before = await (await logged.client.get(url)).json()
    assert before['proxy'] == {'mode': 'inherit', 'host': None}
    saved = await logged.client.patch(url, json={'proxy': SECRET_PROXY}, headers=headers)
    assert saved.status == 200
    text = await saved.text()
    assert 'very-secret' not in text and 'proxy-user' not in text
    body = json.loads(text)
    assert body['proxy'] == {'mode': 'custom', 'host': 'proxy.example.net:1080', 'scheme': 'socks5'}
    from src.management import feed_options
    assert feed_options.proxy_for(logged.feed.link) == SECRET_PROXY
    # setting only the proxy must not touch the User-Agent
    await logged.client.patch(url, json={'user_agent': 'My-UA'}, headers=headers)
    again = await (await logged.client.patch(url, json={'proxy': 'direct'}, headers=headers)).json()
    assert again['proxy']['mode'] == 'direct' and again['user_agent'] == 'My-UA'
    assert feed_options.proxy_for(logged.feed.link) is False
    reset = await (await logged.client.patch(url, json={'proxy': None}, headers=headers)).json()
    assert reset['proxy']['mode'] == 'inherit' and feed_options.proxy_for(logged.feed.link) is None
    for bad in ('ftp://x:1', 'socks5://h:1/path', 'not a proxy', '', 42, 'socks5://h:70000'):
        response = await logged.client.patch(url, json={'proxy': bad}, headers=headers)
        assert response.status == 400 and (await response.json())['code'] == 'INVALID_PROXY', bad
    # neither the secret nor the address reaches the audit trail
    assert SECRET_PROXY not in json.dumps(await logged.store.rows('SELECT * FROM activity'))
    assert 'very-secret' not in json.dumps(await logged.store.rows('SELECT * FROM activity'))


async def test_feed_proxy_requires_admin_and_stays_out_of_agent_reach(logged):
    auth = await token(logged, 'write', ['-1001'])
    url = f'/api/feeds/{logged.feed.id}/fetch-options'
    assert (await logged.client.patch(url, json={'proxy': SECRET_PROXY}, headers=auth)).status == 403
    added = await logged.client.post('/api/subscriptions', json={'target': '-1001', 'urls': ['https://e.example/rss'],
                                                                  'proxy': SECRET_PROXY}, headers=auth)
    assert added.status == 403


async def test_batch_proxy_updates_many_feeds_atomically(logged):
    other = await db.Feed.create(link='https://second.example/rss', title='Second')
    await db.Sub.create(user_id=-1001, feed=other)
    headers = {'Origin': ORIGIN}
    ok = await logged.client.post('/api/feeds/fetch-options/batch', headers=headers,
                                  json={'feeds': [logged.feed.id, other.id], 'proxy': SECRET_PROXY})
    assert ok.status == 200 and (await ok.json())['updated'] == 2
    from src.management import feed_options
    assert feed_options.proxy_for(logged.feed.link) == feed_options.proxy_for(other.link) == SECRET_PROXY
    # an unknown feed rejects the whole batch: nothing changes
    bad = await logged.client.post('/api/feeds/fetch-options/batch', headers=headers,
                                   json={'feeds': [logged.feed.id, 999999], 'proxy': 'direct'})
    assert bad.status == 404 and feed_options.proxy_for(logged.feed.link) == SECRET_PROXY
    cleared = await logged.client.post('/api/feeds/fetch-options/batch', headers=headers,
                                       json={'feeds': [logged.feed.id, other.id], 'proxy': None})
    assert cleared.status == 200 and feed_options.proxy_for(other.link) is None
    assert (await logged.client.post('/api/feeds/fetch-options/batch', headers=headers,
                                     json={'feeds': [], 'proxy': 'direct'})).status == 400


async def test_proxy_is_restored_when_a_new_subscription_fails(logged, monkeypatch):
    """The proxy is used to validate a new feed, and does not linger if adding it fails."""
    from src.command import inner
    from src.management import feed_options
    seen = []

    async def failing(user_id, url, **kwargs):
        seen.append(feed_options.proxy_for(url))          # visible to the validation fetch
        return {'sub': None, 'msg': 'unreachable'}

    monkeypatch.setattr(inner.sub, 'sub', failing)
    url = 'https://only-via-proxy.example/rss'
    result = await (await logged.client.post('/api/subscriptions', headers={'Origin': ORIGIN},
                                             json={'target': '-1001', 'urls': [url], 'proxy': SECRET_PROXY})).json()
    assert result['results'][0]['status'] == 'failed'
    assert seen == [SECRET_PROXY] and feed_options.proxy_for(url) is None
    assert (await logged.client.post('/api/subscriptions', headers={'Origin': ORIGIN},
                                     json={'target': '-1001', 'urls': [url], 'proxy': 'nope'})).status == 400


async def test_proxy_test_endpoint_reports_without_leaking(logged, monkeypatch):
    from types import SimpleNamespace
    from src.management import subscriptions
    calls = []

    async def fake_feed_get(url, **kwargs):
        calls.append(kwargs.get('proxy'))
        if kwargs.get('proxy') == SECRET_PROXY:
            return SimpleNamespace(status=200, rss_d=SimpleNamespace(entries=[1, 2, 3]), error=None)
        return SimpleNamespace(status=None, rss_d=None,
                               error=SimpleNamespace(error_name='network error', base_error=TimeoutError(SECRET_PROXY)))

    monkeypatch.setattr(subscriptions.upstream_web, 'feed_get', fake_feed_get)
    url = f'/api/feeds/{logged.feed.id}/proxy-test'
    good = await (await logged.client.post(url, headers={'Origin': ORIGIN}, json={'proxy': SECRET_PROXY})).json()
    assert good['ok'] is True and good['entries'] == 3
    bad = await logged.client.post(url, headers={'Origin': ORIGIN}, json={})
    text = await bad.text()
    assert json.loads(text)['ok'] is False and json.loads(text)['exception_type'] == 'TimeoutError'
    assert 'very-secret' not in text and calls == [SECRET_PROXY, None]
    direct = await (await logged.client.post(url, headers={'Origin': ORIGIN}, json={'proxy': 'direct'})).json()
    assert direct['ok'] is False and calls[-1] is False


async def test_requests_really_go_through_the_chosen_proxy(monkeypatch):
    """A real CONNECT proxy and a real RSS origin on loopback: proxy / direct / global rules."""
    import asyncio
    from aiohttp import web as aioweb
    from src import web as upstream_web
    from src.web import req

    env.loop = asyncio.get_running_loop()   # the upstream parser runs through env.loop
    rss = ('<?xml version="1.0"?><rss version="2.0"><channel><title>Origin feed</title><link>http://x/</link>'
           '<item><title>One</title><link>http://x/1</link><guid>1</guid></item></channel></rss>')

    async def feed(request):
        return aioweb.Response(text=rss, content_type='application/rss+xml')

    app = aioweb.Application()
    app.router.add_get('/rss', feed)
    runner = aioweb.AppRunner(app)
    await runner.setup()
    site = aioweb.TCPSite(runner, '127.0.0.1', 0)
    await site.start()
    origin_port = site._server.sockets[0].getsockname()[1]
    seen = []

    async def pipe(reader, writer):
        try:
            while data := await reader.read(65536):
                writer.write(data)
                await writer.drain()
        except (ConnectionError, asyncio.CancelledError):
            pass
        finally:
            writer.close()

    async def proxy(reader, writer):
        head = await reader.readuntil(b'\r\n\r\n')
        target = head.split(b'\r\n')[0].split()[1].decode()          # "CONNECT host:port HTTP/1.1"
        seen.append(target)
        host, port = target.rsplit(':', 1)
        up_reader, up_writer = await asyncio.open_connection(host, int(port))
        writer.write(b'HTTP/1.1 200 Connection established\r\n\r\n')
        await writer.drain()
        await asyncio.gather(pipe(reader, up_writer), pipe(up_reader, writer))

    proxy_server = await asyncio.start_server(proxy, '127.0.0.1', 0)
    proxy_port = proxy_server.sockets[0].getsockname()[1]
    url = f'http://127.0.0.1:{origin_port}/rss'
    try:
        # 1. per-feed proxy: the proxy sees a tunnel to the origin
        got = await upstream_web.feed_get(url, proxy=f'http://127.0.0.1:{proxy_port}', verbose=False)
        assert got.rss_d is not None and got.rss_d.feed.title == 'Origin feed'
        assert seen == [f'127.0.0.1:{origin_port}']
        # 2. direct although a global proxy exists: the proxy is not used
        monkeypatch.setattr(req, 'PROXY', f'http://127.0.0.1:{proxy_port}')
        seen.clear()
        got = await upstream_web.feed_get(url, proxy=False, verbose=False)
        assert got.rss_d is not None and seen == []
        # 3. nothing set: the global proxy applies
        got = await upstream_web.feed_get(url, verbose=False)
        assert got.rss_d is not None and seen == [f'127.0.0.1:{origin_port}']
        # 4. a per-URL setting installed by the console is honoured by the normal fetch path
        seen.clear()
        monkeypatch.setattr(req, 'proxy_override', {url: False}.get)
        got = await upstream_web.feed_get(url, verbose=False)
        assert got.rss_d is not None and seen == []
    finally:
        proxy_server.close()
        await runner.cleanup()


async def test_unnamed_private_users_get_an_honest_placeholder_and_the_bot_is_not_listed(logged, monkeypatch):
    await db.User.create(id=777, state=1)                                   # never spoke: no target row
    await db.User.create(id=8100000001, state=1)                            # the bot's own account
    monkeypatch.setattr(env, 'bot_id', 8100000001, raising=False)
    listing = await (await logged.client.get('/api/targets?visibility=all&size=100')).json()
    by_id = {item['id']: item for item in listing['items']}
    assert by_id['777']['title'] == '用户 777' and by_id['777']['named'] is False
    assert by_id['-1001']['named'] is True and by_id['-1001']['title'] == 'Target -1001'
    assert '8100000001' not in by_id
    dashboard = await (await logged.client.get('/api/dashboard')).json()
    assert dashboard['usage']['known']['private'] == len([i for i in by_id.values() if i['kind'] == 'private'])
    await logged.store.target(777, 'Carol', 'carol', 'private', 'known')
    again = await (await logged.client.get('/api/targets?q=carol&visibility=all')).json()
    assert again['items'][0]['title'] == 'Carol' and again['items'][0]['named'] is True


async def test_complete_names_endpoint(logged, monkeypatch):
    from src.management import chat_lifecycle
    headers = {'Origin': ORIGIN}
    offline = await logged.client.post('/api/targets/names', json={}, headers=headers)
    assert offline.status == 409 and (await offline.json())['code'] == 'TELEGRAM_UNAVAILABLE'   # no live bot attached

    class Fake:
        async def resolve_private_names(self):
            return {'examined': 3, 'named': 2, 'missing': 1}

    monkeypatch.setattr(chat_lifecycle, '_active', Fake())
    done = await (await logged.client.post('/api/targets/names', json={}, headers=headers)).json()
    assert done == {'examined': 3, 'named': 2, 'missing': 1}
    agent = await token(logged, 'write', ['-1001'])
    assert (await logged.client.post('/api/targets/names', json={}, headers=agent)).status == 403
