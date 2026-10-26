import asyncio
import json
import os
import sys

import pytest

from src.management.auth import Auth
from src.management.server import create_app
from src.management.service import Problem
from src.management.agent_cli import main
from conftest import PASSWORD, ORIGIN, token

WRITE = {'Origin': ORIGIN}


async def test_password_persistence_rotation_and_sessions(logged):
    c = logged.client
    headers = await token(logged)
    new = 'new-private-password-1234'
    assert (await c.post('/api/auth/password', json={'current_password': PASSWORD, 'new_password': new}, headers=WRITE)).status == 200
    assert (await c.get('/api/session')).status == 401
    assert (await c.get('/api/session', headers=headers)).status == 200
    auth = await Auth.load(logged.store, PASSWORD)
    await auth.verify(new, 'test')
    with pytest.raises(Problem):
        await auth.verify(PASSWORD, 'test')
    assert (await c.post('/api/login', json={'password': new}, headers=WRITE)).status == 200
    assert (await c.delete('/api/auth/sessions', headers=WRITE)).status == 200
    assert (await c.get('/api/session')).status == 401
    assert new not in json.dumps(await logged.store.settings())


async def test_agent_fail_closed_and_no_auth_downgrade(logged):
    c = logged.client
    headers = await token(logged)
    for path in ('/api/settings', '/api/dashboard', '/api/auth/account', '/api/auth/sessions', '/api/tokens', '/api/future/backup'):
        response = await c.get(path, headers=headers)
        assert response.status == 403
        assert (await response.json())['code'] == 'FORBIDDEN'
    assert (await c.get('/api/session', headers={'Authorization': 'Basic forged'})).status == 401
    _, forged = await logged.store.issue('forged', 'token', 'admin')
    assert (await c.get('/api/settings', headers={'Authorization': 'Bearer ' + forged})).status == 403
    contract = await (await c.get('/api/openapi.json', headers=headers)).json()
    assert contract['openapi'] == '3.1.0'
    assert '/api/settings' not in contract['paths']
    audit = await logged.store.rows("SELECT * FROM activity WHERE action='agent_request'")
    assert audit and headers['Authorization'] not in json.dumps(audit)


async def test_preview_default_login_and_cookie_isolation(context, aiohttp_client):
    clients = []
    for port in (8741, 8742):
        origin = f'http://127.0.0.1:{port}'
        app = await create_app(context.store, PASSWORD, origin, context.gateway, demo=True)
        clients.append(await aiohttp_client(app))
    response = await clients[0].post('/api/login', json={'password': PASSWORD}, headers={'Origin': 'http://127.0.0.1:8741'})
    old = response.cookies['rsstt_session_8741'].value
    # Both apps deliberately share a test credential store so only cookie-name
    # isolation (not an unrelated hash lookup failure) can make this fail.
    assert (await clients[0].get('/api/session')).status == 200
    assert (await clients[1].get('/api/session', headers={'Cookie': 'rsstt_session_8741=' + old})).status == 401
    assert (await clients[1].post('/api/login', json={'password': 'rsstt-local-preview'}, headers={'Origin': 'http://127.0.0.1:8742'})).status == 401
    public = await (await clients[1].get('/api/public')).json()
    assert 'password' not in public
    js = await (await clients[1].get('/assets/app.js')).text()
    assert 'rsstt-local-preview' not in js


async def test_cli_end_to_end_and_safe_default(logged, tmp_path):
    _, secret = await logged.store.issue('cli', 'token', 'write', ['-1001'])
    env = {**os.environ, 'RSSTT_TOKEN': secret}
    url = str(logged.client.make_url('')).rstrip('/')
    async def run(*args):
        process = await asyncio.create_subprocess_exec(sys.executable, '-m', 'src.management.agent_cli', '--url', url, *args,
                                                       env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await process.communicate()
        assert secret.encode() not in out + err
        return process.returncode, out, err
    code, out, _ = await run('/api/subscriptions')
    assert code == 0 and json.loads(out)['total'] == 1
    data = tmp_path / 'body.json'
    data.write_text('{"state":0}')
    path = f'/api/subscriptions/{logged.sub.id}'
    code, out, _ = await run('--method', 'PATCH', '--data', str(data), path)
    assert code == 0 and json.loads(out)['dry_run']
    await logged.sub.refresh_from_db()
    assert logged.sub.state == 1
    assert (await run('--method', 'PATCH', '--data', str(data), '--apply', path))[0] == 0
    await logged.sub.refresh_from_db()
    assert logged.sub.state == 0
    assert (await run('--method', 'DELETE', '--apply', path))[0] != 0
    assert (await run('--method', 'DELETE', '--apply', '--confirm-delete', path))[0] == 0
    assert (await run('/api/settings'))[0] == 1
    await logged.store.execute("DELETE FROM credentials WHERE kind='token'")
    assert (await run('/api/session'))[0] == 1


def test_cli_credential_file_permissions(tmp_path):
    path = tmp_path / 'credential'
    path.write_text('rst_private')
    path.chmod(0o644)
    with pytest.raises(SystemExit):
        main(['--url', 'http://127.0.0.1:8741', '--token-file', str(path), '/api/session'])
