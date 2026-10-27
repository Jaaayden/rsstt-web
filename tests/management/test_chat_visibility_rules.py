from src import db
from conftest import ORIGIN, token

WRITE = {'Origin': ORIGIN}


async def test_departed_chats_hidden_before_count_pagination_and_scope(logged):
    await logged.store.target(-1002, 'Departed channel', None, 'channel', 'left')
    before_users = await db.User.all().order_by('id').values()
    before_subs = await db.Sub.all().order_by('id').values()
    result = await (await logged.client.get('/api/targets?visibility=all')).json()
    assert result['total'] == 3 and '-1002' not in {item['id'] for item in result['items']}
    pages = [await (await logged.client.get(f'/api/targets?size=1&page={page}')).json() for page in (1, 2, 3)]
    assert all(page['total'] == 3 and len(page['items']) == 1 for page in pages)
    assert len({page['items'][0]['id'] for page in pages}) == 3
    retained = await (await logged.client.get('/api/targets?include_departed=true')).json()
    assert retained['total'] == 4
    scoped = await token(logged, targets=['-1002'])
    assert (await (await logged.client.get('/api/targets', headers=scoped)).json())['total'] == 0
    assert (await (await logged.client.get('/api/targets?include_departed=true', headers=scoped)).json())['total'] == 1
    assert (await logged.client.get('/api/targets?include_departed=bad')).status == 400
    assert await db.User.all().order_by('id').values() == before_users
    assert await db.Sub.all().order_by('id').values() == before_subs


async def test_blocked_and_departed_subscriptions_hidden_but_retained(logged):
    await logged.client.patch('/api/targets/-1002/role', json={'role': 'banned'}, headers=WRITE)
    await logged.store.target(-1001, 'Departed channel', None, 'channel', 'left')
    for target in (-1001, -1002):
        feed = await db.Feed.create(link=f'https://example.com/{target}', title=f'Hidden {target}')
        await db.Sub.create(user_id=target, feed=feed)
    before = await db.Sub.all().order_by('id').values()
    assert (await (await logged.client.get('/api/subscriptions')).json())['total'] == 0
    exported = await (await logged.client.get('/api/subscriptions/opml')).text()
    assert 'xmlUrl=' not in exported
    for target in (-1001, -1002):
        result = await (await logged.client.get(f'/api/subscriptions?target={target}')).json()
        assert result['total'] == 2
        exported = await (await logged.client.get(f'/api/subscriptions/opml?target={target}')).text()
        assert f'https://example.com/{target}' in exported
    assert await db.Sub.all().order_by('id').values() == before


async def test_replace_keeps_hidden_recipients_and_rejects_new_ones(logged):
    c = logged.client
    await db.User.create(id=3, state=1)
    await logged.store.target(3, 'Departed', None, 'private', 'disabled')
    sub = await db.Sub.create(user_id=3, feed=logged.feed, title='Retain custom title')
    await c.patch('/api/targets/-1002/role', json={'role': 'banned'}, headers=WRITE)
    before = await db.Sub.filter(id__in=[sub.id, logged.other.id]).order_by('id').values()
    endpoint = f'/api/feeds/{logged.feed.id}/recipients'
    result = await (await c.get(endpoint)).json()
    assert [item['target'] for item in result['items']] == ['-1001']
    response = await c.put(endpoint, json={'mode': 'replace', 'targets': []}, headers=WRITE)
    assert response.status == 200 and (await response.json())['items'] == []
    assert not await db.Sub.filter(id=logged.sub.id).exists()
    assert await db.Sub.filter(id__in=[sub.id, logged.other.id]).order_by('id').values() == before
    for ident in ('3', '-1002'):
        assert (await c.put(endpoint, json={'mode': 'append', 'targets': [ident]}, headers=WRITE)).status == 409


async def test_dashboard_active_services_exclude_known_departures(logged):
    await logged.store.target(-1002, 'Departed channel', None, 'channel', 'left')
    dashboard = await (await logged.client.get('/api/dashboard')).json()
    assert dashboard['usage']['active']['total'] == 1
    assert dashboard['usage']['active_subscriptions'] == 1
