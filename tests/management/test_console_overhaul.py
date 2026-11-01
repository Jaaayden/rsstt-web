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
