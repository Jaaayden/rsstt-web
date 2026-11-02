from src import db
from conftest import ORIGIN, PASSWORD, token

WRITE = {'Origin': ORIGIN}


async def test_web_changes_are_attributed_to_chat_and_actual_fields(logged):
    c = logged.client
    assert (await (await c.get('/api/targets/-1001/activity')).json())['items'] == []
    response = await c.patch(f'/api/subscriptions/{logged.sub.id}', json={'notify': 0, 'title': 'Custom title'}, headers=WRITE)
    assert response.status == 200
    events = await (await c.get('/api/targets/-1001/activity')).json()
    assert events['total'] == 1
    item = events['items'][0]
    assert item['source'] == 'web' and item['outcome'] == 'completed'
    assert item['action'] == 'subscriptions.update'
    assert any(change['field'] == 'notify' and change['after'] == 0 for change in item['changes'])
    assert any(change['field'] == 'title' and change['after'] == 'Custom title' for change in item['changes'])
    assert (await (await c.get('/api/targets/-1002/activity')).json())['items'] == []
    assert (await c.patch('/api/targets/-1001/role', json={'role': 'banned'}, headers=WRITE)).status == 200
    result = await (await c.get('/api/targets/-1001/activity?size=1&page=1')).json()
    assert result['total'] == 2 and len(result['items']) == 1
    assert result['items'][0]['action'] == 'role.update'
    assert any(change['field'] == 'state' and change['after'] == -1 for change in result['items'][0]['changes'])
    previous = await (await c.get('/api/targets/-1001/activity?size=1&page=2')).json()
    assert previous['items'][0]['id'] != result['items'][0]['id']


async def test_activity_is_console_only_and_excludes_auth_secrets(logged):
    c = logged.client
    assert (await c.get('/api/targets/-1001/activity?page=0')).status == 400
    for permission in ('read', 'write'):
        headers = await token(logged, permission=permission)
        assert (await c.get('/api/targets/-1001/activity', headers=headers)).status == 403
    response = await c.post('/api/auth/password', json={'current_password': 'incorrect-sensitive-password',
                           'new_password': 'new-sensitive-password-value'}, headers=WRITE)
    assert response.status == 400
    assert (await response.json())['code'] == 'CURRENT_PASSWORD_INCORRECT'
    history = await (await c.get('/api/targets/-1001/activity')).text()
    assert PASSWORD not in history and 'sensitive-password' not in history
    assert (await c.get('/api/targets/999/activity')).status == 404


async def test_recipient_change_records_new_chat_without_hidden_relation_changes(logged):
    c = logged.client
    response = await c.put(f'/api/feeds/{logged.feed.id}/recipients', json={'mode': 'append', 'targets': ['2']}, headers=WRITE)
    assert response.status == 200
    events = await (await c.get('/api/targets/2/activity')).json()
    assert events['total'] == 1
    assert events['items'][0]['action'] == 'recipients.update'
    assert events['items'][0]['changes']
    assert await db.Sub.filter(user_id=2, feed_id=logged.feed.id).exists()


async def test_cancelled_multi_chat_audit_releases_already_acquired_locks(logged, monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from src.management import chat_audit, web_audit
    from src.management.service import Service
    class Request(dict):
        method = 'PATCH'
    request = Request(principal={'name': 'admin', 'kind': 'session', 'targets': None})
    entered = asyncio.Event()
    async def affected(*args):
        entered.set()
        return 'role.update', [-1001, -1002], None
    monkeypatch.setattr(web_audit, 'affected', affected)
    service = Service(logged.store, logged.gateway)
    async def multi():
        async with web_audit.trace(request, service, logged.store):
            raise AssertionError('second lock should still be held')
    async with chat_audit.audit_call(-1001, 'role.update', store=logged.store):
        task = asyncio.create_task(multi())
        await entered.wait()
        # Give the first lock and snapshot time to settle before cancellation.
        for _ in range(10):
            if (id(logged.store), '-1002') in chat_audit._chat_locks:
                break
            await asyncio.sleep(0)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    async def next_operation():
        async with chat_audit.audit_call(-1002, 'role.update', store=logged.store):
            pass
    await asyncio.wait_for(next_operation(), 1)
