from src import db
from conftest import ORIGIN, token

WRITE = {'Origin': ORIGIN}


async def test_archive_roundtrip_filters_and_preserves_bot_data(logged):
    c = logged.client
    await c.patch('/api/targets/-1002/role', json={'role': 'banned'}, headers=WRITE)
    before_users = await db.User.all().order_by('id').values()
    before_subs = await db.Sub.all().order_by('id').values()
    before_feeds = await db.Feed.all().order_by('id').values()
    response = await c.post('/api/targets/archive', json={'ids': ['-1001', '-1002', '-1001'], 'archived': True}, headers=WRITE)
    assert response.status == 200
    assert (await response.json())['ids'] == ['-1001', '-1002']
    for query, expected in [('', {'1', '2'}), ('archive=archived', {'-1001', '-1002'}),
                            ('archive=all', {'1', '2', '-1001', '-1002'}),
                            ('archive=archived&visibility=banned', {'-1002'}),
                            ('archive=archived&kind=channel&q=1001', {'-1001'})]:
        result = await (await c.get('/api/targets?' + query)).json()
        assert result['total'] == len(expected)
        assert {row['id'] for row in result['items']} == expected
        assert all(row['archived'] == (row['id'] in {'-1001', '-1002'}) for row in result['items'])
    pages = [await (await c.get(f'/api/targets?archive=archived&size=1&page={page}')).json() for page in (1, 2)]
    assert all(p['total'] == 2 and len(p['items']) == 1 for p in pages)
    assert pages[0]['items'][0]['id'] != pages[1]['items'][0]['id']
    scoped = await token(logged, targets=['-1001'])
    result = await (await c.get('/api/targets?archive=archived', headers=scoped)).json()
    assert [row['id'] for row in result['items']] == ['-1001']
    # Metadata refresh must not undo a deliberate archive.
    await logged.store.target(-1001, 'Refreshed', None, 'channel', 'available')
    assert await logged.store.archived_ids() == {'-1001', '-1002'}
    for _ in range(2):
        response = await c.post('/api/targets/archive', json={'ids': ['-1001', '-1002'], 'archived': False}, headers=WRITE)
        assert response.status == 200
    assert not await logged.store.archived_ids()
    assert await db.User.all().order_by('id').values() == before_users
    assert await db.Sub.all().order_by('id').values() == before_subs
    assert await db.Feed.all().order_by('id').values() == before_feeds


async def test_archive_validation_protection_and_authorization(logged):
    c = logged.client
    for ids, status in [(['-1001', '1'], 409), (['-1001', '999'], 404), ([], 400), (['2'] * 101, 400)]:
        response = await c.post('/api/targets/archive', json={'ids': ids, 'archived': True}, headers=WRITE)
        assert response.status == status
        assert not await logged.store.archived_ids()
    assert (await c.post('/api/targets/archive', json={'ids': ['2'], 'archived': 'true'}, headers=WRITE)).status == 400
    assert (await c.get('/api/targets?archive=invalid')).status == 400
    for permission in ('read', 'write'):
        response = await c.post('/api/targets/archive', json={'ids': ['-1001'], 'archived': True},
                                headers=await token(logged, permission=permission))
        assert response.status == 403
    assert (await c.post('/api/targets/archive', json={'ids': ['2'], 'archived': True},
                          headers={'Origin': 'https://untrusted.invalid'})).status == 403
    assert not await logged.store.archived_ids()


async def test_blocked_subscriptions_and_hidden_recipients_are_preserved(logged):
    c = logged.client
    await db.User.create(id=3, state=1)
    await logged.store.target(3, 'Archived active chat', None, 'private', 'known')
    archived_sub = await db.Sub.create(user_id=3, feed=logged.feed, state=1, title='Keep custom title')
    await c.patch('/api/targets/-1002/role', json={'role': 'banned'}, headers=WRITE)
    await c.post('/api/targets/archive', json={'ids': ['3'], 'archived': True}, headers=WRITE)
    before = await db.Sub.filter(id__in=[logged.other.id, archived_sub.id]).order_by('id').values()
    listing = await (await c.get('/api/subscriptions')).json()
    assert listing['total'] == 2
    assert all(item['target'] != '-1002' for item in listing['items'])
    # Deliberately opening a blocked chat still permits inspecting its paused subscriptions.
    scoped = await (await c.get('/api/subscriptions?target=-1002')).json()
    assert scoped['total'] == 1 and scoped['items'][0]['state'] == 0
    recipients = await (await c.get(f'/api/feeds/{logged.feed.id}/recipients')).json()
    assert [item['target'] for item in recipients['items']] == ['-1001']
    response = await c.put(f'/api/feeds/{logged.feed.id}/recipients', json={'mode': 'replace', 'targets': []}, headers=WRITE)
    assert response.status == 200 and (await response.json())['items'] == []
    assert not await db.Sub.filter(id=logged.sub.id).exists()
    assert await db.Sub.filter(id__in=[logged.other.id, archived_sub.id]).order_by('id').values() == before
    for ident, code in [('-1002', 'TARGET_BANNED'), ('3', 'CHAT_ARCHIVED')]:
        response = await c.put(f'/api/feeds/{logged.feed.id}/recipients', json={'mode': 'append', 'targets': [ident]}, headers=WRITE)
        assert response.status == 409 and (await response.json())['code'] == code


async def test_default_export_excludes_blocked_only_feeds(logged):
    feed = await db.Feed.create(link='https://example.com/blocked-only', title='Blocked only')
    await db.Sub.create(user_id=-1002, feed=feed)
    await logged.client.patch('/api/targets/-1002/role', json={'role': 'banned'}, headers=WRITE)
    exported = await (await logged.client.get('/api/subscriptions/opml')).text()
    assert 'blocked-only' not in exported and logged.feed.link in exported
    targeted = await (await logged.client.get('/api/subscriptions/opml?target=-1002')).text()
    assert 'blocked-only' in targeted
