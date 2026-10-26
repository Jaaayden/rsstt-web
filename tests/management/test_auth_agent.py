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


async def test_openapi_only_advertises_installed_routes(logged):
    data = await (await logged.client.get('/api/openapi.json')).json()
    assert '/api/feeds/{id}/recipients' not in data['paths']
    assert '/api/subscriptions/opml' not in data['paths']
    params = data['paths']['/api/subscriptions']['get']['parameters']
    assert {p['name'] for p in params} == {'q', 'page', 'size', 'target', 'state', 'attention'}
    create = data['paths']['/api/subscriptions']['post']['requestBody']['content']['application/json']['schema']
    assert create['required'] == ['target', 'urls']
    assert data['paths']['/api/targets/{id}/opml']['get']['responses']['200']['content']['text/xml']['schema']['type'] == 'string'
    assert data['components']['schemas']['Session']['required']


async def test_optional_route_contract_permissions_and_cli_put(context, aiohttp_client, tmp_path):
    """Contract harness, not a replacement for PR3 transaction/integration tests."""
    from aiohttp import web
    from src.management.service import Service
    app = await create_app(context.store, PASSWORD, ORIGIN, context.gateway)
    service = Service(context.store, context.gateway)
    calls = []

    async def recipients(request):
        values = await request.json() if request.method == 'PUT' else {'targets': []}
        # Optional modules must check every object after capability authorization.
        for ident in values['targets']:
            await service.user(ident, request['principal'])
        calls.append(request.method)
        return web.json_response({'feed_id': 1, 'scope': 'authorized_targets', 'items': []})

    async def xml(request):
        return web.Response(text='<opml/>', content_type='text/xml')

    app.router.add_get('/api/feeds/{id}/recipients', recipients)
    app.router.add_put('/api/feeds/{id}/recipients', recipients)
    app.router.add_get('/api/subscriptions/opml', xml)
    # An installed privileged route must remain excluded and denied.
    privileged = [('GET', '/api/feeds/{id}/fetch-options'), ('GET', '/api/statistics'),
                  ('POST', '/api/backups/export'), ('PATCH', '/api/users/{id}'), ('GET', '/api/notifications/settings')]
    for method, route in privileged:
        app.router.add_route(method, route, recipients)
    client = await aiohttp_client(app)
    read = await token(context, 'read')
    write = await token(context, 'write')
    path = '/api/feeds/1/recipients'
    body = {'mode': 'replace', 'targets': ['-1001']}
    assert (await client.get(path, headers=read)).status == 200
    assert (await client.put(path, headers=read, json=body)).status == 403
    assert (await client.put(path, headers=write, json={**body, 'targets': ['-1002']})).status == 403
    for method, route in privileged:
        assert (await client.request(method, route.replace('{id}', '1'), headers=write)).status == 403
    assert (await client.get('/api/subscriptions/opml', headers=read)).status == 200
    contract = await (await client.get('/api/openapi.json', headers=read)).json()
    operation = contract['paths']['/api/feeds/{id}/recipients']['put']
    assert operation['x-required-capability'] == 'subscriptions:write'
    assert operation['requestBody']['content']['application/json']['schema']['required'] == ['mode', 'targets']
    assert all(route not in contract['paths'] for _, route in privileged)
    assert {p['name'] for p in contract['paths']['/api/subscriptions/opml']['get']['parameters']} == {'q', 'target', 'state', 'attention', 'ids'}
    data = tmp_path / 'recipients.json'
    data.write_text(json.dumps(body))
    async def cli(apply=False):
        process = await asyncio.create_subprocess_exec(
            sys.executable, '-m', 'src.management.agent_cli', '--url', str(client.make_url('')).rstrip('/'),
            '--method', 'PUT', '--data', str(data), *(['--apply', '--confirm-delete'] if apply else []), path,
            env={**os.environ, 'RSSTT_TOKEN': write['Authorization'][7:]},
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await process.communicate()
        assert process.returncode == 0, err.decode()
        return json.loads(out)
    assert (await cli())['dry_run'] is True
    assert calls == ['GET']
    assert (await cli(True))['feed_id'] == 1
    assert calls == ['GET', 'PUT']


def test_cli_non_posix_file_credentials_fail_cleanly(tmp_path, monkeypatch, capsys):
    monkeypatch.delattr(os, 'getuid')
    with pytest.raises(SystemExit) as error:
        main(['--url', 'http://127.0.0.1:8741', '--token-file', str(tmp_path / 'secret'), '/api/session'])
    assert error.value.code == 2
    stderr = capsys.readouterr().err
    assert 'use RSSTT_TOKEN or --token-stdin' in stderr
    assert 'Traceback' not in stderr
    monkeypatch.setenv('RSSTT_TOKEN', 'rst_test_private')
    assert main(['--url', 'http://127.0.0.1:8741', '--method', 'PUT', '/api/feeds/1/recipients']) == 0


def test_cli_replace_requires_explicit_deletion_confirmation(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv('RSSTT_TOKEN', 'rst_local_test')
    data = tmp_path / 'replace.json'
    data.write_text('{"mode":"replace","targets":[]}')
    with pytest.raises(SystemExit) as error:
        main(['--url', 'http://127.0.0.1:8741', '--method', 'PUT', '--apply', '--data', str(data), '/api/feeds/1/recipients'])
    assert error.value.code == 2
    assert '--confirm-delete' in capsys.readouterr().err
