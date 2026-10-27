from src import db
from conftest import ORIGIN, token


async def test_visibility_scope_pagination_and_data_preservation(logged):
    c = logged.client
    await c.patch('/api/targets/-1002/role', json={'role': 'banned'}, headers={'Origin': ORIGIN})
    for ident in (3, 4, 5, 6):
        await db.User.create(id=ident, state=-1 if ident == 6 else 1)
        await logged.store.target(ident, f'Status {ident}', None, 'private', 'available')
    disabled = await db.Feed.create(link='https://example.com/disabled', title='Disabled', state=0)
    second = await db.Feed.create(link='https://example.com/second', title='Second', state=1)
    for user, feed, state in [(3, logged.feed, 0), (4, disabled, 1), (5, logged.feed, 1), (5, second, 1), (6, logged.feed, 1)]:
        await db.Sub.create(user_id=user, feed=feed, state=state)
    before = await db.Sub.all().order_by('id').values('id', 'user_id', 'state')
    roles = await db.User.all().order_by('id').values('id', 'state')
    expected = {'all': {'1', '2', '3', '4', '5', '6', '-1001', '-1002'},
                'unbanned': {'1', '2', '3', '4', '5', '-1001'}, 'active': {'5', '-1001'},
                'inactive': {'1', '2', '3', '4'}, 'banned': {'6', '-1002'}}
    async def query(params, wanted, headers=None):
        response = await c.get('/api/targets?' + params, headers=headers)
        assert response.status == 200
        data = await response.json()
        assert data['total'] == len(wanted)
        assert {row['id'] for row in data['items']} == wanted
    for mode, wanted in expected.items():
        await query('visibility=' + mode, wanted)
    await query('', expected['all'])
    ids = []
    for page in (1, 2):
        data = await (await c.get(f'/api/targets?visibility=active&size=1&page={page}')).json()
        assert data['total'] == 2 and len(data['items']) == 1
        ids.append(data['items'][0]['id'])
    assert len(set(ids)) == 2 and set(ids) == expected['active']
    await query('visibility=active&q=Status&kind=private', {'5'})
    await query('visibility=active&kind=channel', {'-1001'})
    await query('visibility=banned&q=Status', {'6'})
    await query('visibility=inactive&q=missing', set())
    headers = await token(logged, permission='read', targets=['-1001', '6'])
    for mode, wanted in expected.items():
        await query('visibility=' + mode, wanted & {'-1001', '6'}, headers)
    assert await db.Sub.all().order_by('id').values('id', 'user_id', 'state') == before
    assert await db.User.all().order_by('id').values('id', 'state') == roles


async def test_visibility_validation_and_documented_default(logged):
    response = await logged.client.get('/api/targets?visibility=unknown')
    assert response.status == 400
    assert (await response.json())['code'] == 'INVALID_CHAT_VISIBILITY'
    contract = await (await logged.client.get('/api/openapi.json')).json()
    params = contract['paths']['/api/targets']['get']['parameters']
    schema = next(p['schema'] for p in params if p['name'] == 'visibility')
    assert schema['default'] == 'all'
    assert set(schema['enum']) == {'all', 'unbanned', 'active', 'inactive', 'banned'}


async def test_unknown_type_matches_displayed_metadata_before_legacy_role(logged):
    for ident, state in [(-2001, 0), (-2002, 50), (-2003, 50), (-2004, -1)]:
        await db.User.create(id=ident, state=state)
    await logged.store.target(-2002, 'Unknown metadata', None, 'unknown', 'snapshot')
    await logged.store.target(-2004, 'Known group', None, 'group', 'snapshot')
    result = await (await logged.client.get('/api/targets?kind=unknown')).json()
    assert {item['id'] for item in result['items']} == {'-2001', '-2002'}
    assert all(item['kind'] == 'unknown' for item in result['items'])
    result = await (await logged.client.get('/api/targets?kind=channel')).json()
    assert '-2003' in {item['id'] for item in result['items']}
    assert '-2002' not in {item['id'] for item in result['items']}
    result = await (await logged.client.get('/api/targets?kind=group&visibility=banned')).json()
    assert {item['id'] for item in result['items']} == {'-2004'}
