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
    result = await c.post('/api/auth/password', json={'current_password': PASSWORD, 'new_password': new}, headers=WRITE)
    assert result.status == 200
    result = await c.get('/api/session')
    assert result.status == 401
    result = await c.get('/api/session', headers=headers)
    assert result.status == 200
    auth = await Auth.load(logged.store, PASSWORD)
    await auth.verify(new, 'test')
    with pytest.raises(Problem):
        await auth.verify(PASSWORD, 'test')
    result = await c.post('/api/login', json={'password': new}, headers=WRITE)
    assert result.status == 200
    result = await c.delete('/api/auth/sessions', headers=WRITE)
    assert result.status == 200
    result = await c.get('/api/session')
    assert result.status == 401
    result = await logged.store.settings()
    assert new not in json.dumps(result)


async def test_agent_fail_closed_and_no_auth_downgrade(logged):
    c = logged.client
    headers = await token(logged)
    for path in ('/api/settings', '/api/dashboard', '/api/auth/account', '/api/auth/sessions', '/api/tokens', '/api/future/backup'):
        response = await c.get(path, headers=headers)
        assert response.status == 403
        result = await response.json()
        assert result['code'] == 'FORBIDDEN'
    result = await c.get('/api/session', headers={'Authorization': 'Basic forged'})
    assert result.status == 401
    _, forged = await logged.store.issue('forged', 'token', 'admin')
    result = await c.get('/api/settings', headers={'Authorization': 'Bearer ' + forged})
    assert result.status == 403
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
    result = await clients[0].get('/api/session')
    assert result.status == 200
    result = await clients[1].get('/api/session', headers={'Cookie': 'rsstt_session_8741=' + old})
    assert result.status == 401
    result = await clients[1].post('/api/login', json={'password': 'rsstt-local-preview'}, headers={'Origin': 'http://127.0.0.1:8742'})
    assert result.status == 401
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
    result = await run('--method', 'PATCH', '--data', str(data), '--apply', path)
    assert result[0] == 0
    await logged.sub.refresh_from_db()
    assert logged.sub.state == 0
    result = await run('--method', 'DELETE', '--apply', path)
    assert result[0] != 0
    result = await run('--method', 'DELETE', '--apply', '--confirm-delete', path)
    assert result[0] == 0
    result = await run('/api/settings')
    assert result[0] == 1
    await logged.store.execute("DELETE FROM credentials WHERE kind='token'")
    result = await run('/api/session')
    assert result[0] == 1


def test_cli_credential_file_permissions(tmp_path):
    path = tmp_path / 'credential'
    path.write_text('rst_private')
    path.chmod(0o644)
    with pytest.raises(SystemExit):
        main(['--url', 'http://127.0.0.1:8741', '--token-file', str(path), '/api/session'])


async def test_openapi_only_advertises_installed_routes(logged):
    data = await (await logged.client.get('/api/openapi.json')).json()
    from aiohttp import web
    from src.management.agent_contract import AGENT_ROUTES, openapi
    installed = {(route.method, route.resource.canonical)
                 for route in logged.client.server.app.router.routes() if route.resource}
    advertised = {(method.upper(), path) for path, operations in data['paths'].items()
                  for method in operations}
    assert advertised == installed.intersection(AGENT_ROUTES)
    # Prove absence/presence independently of which optional modules are installed.
    minimal = web.Application()
    assert openapi(minimal.router)['paths'] == {}
    async def unused(request):
        return web.Response()
    minimal.router.add_get('/api/feeds/{id}/recipients', unused)
    minimal.router.add_get('/api/feeds/{id}/fetch-options', unused)
    assert set(openapi(minimal.router)['paths']) == {'/api/feeds/{id}/recipients'}
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
    from src.management.agent_contract import openapi
    # Reuse the real authentication boundary, but no production routes. Optional
    # modules in a combined build cannot shadow this harness's handlers.
    app = web.Application(middlewares=list(context.client.server.app.middlewares))
    service = Service(context.store, context.gateway)
    calls = []

    async def contract_endpoint(request):
        return web.json_response(openapi(request.app.router))

    app.router.add_get('/api/openapi.json', contract_endpoint)

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
    result = await client.get(path, headers=read)
    assert result.status == 200
    result = await client.put(path, headers=read, json=body)
    assert result.status == 403
    result = await client.put(path, headers=write, json={**body, 'targets': ['-1002']})
    assert result.status == 403
    for method, route in privileged:
        result = await client.request(method, route.replace('{id}', '1'), headers=write)
        assert result.status == 403
    result = await client.get('/api/subscriptions/opml', headers=read)
    assert result.status == 200
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
    result = await cli()
    assert result['dry_run'] is True
    assert calls == ['GET']
    result = await cli(True)
    assert result['feed_id'] == 1
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
    result = main(['--url', 'http://127.0.0.1:8741', '--method', 'PUT', '/api/feeds/1/recipients'])
    assert result == 0


def test_cli_replace_requires_explicit_deletion_confirmation(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv('RSSTT_TOKEN', 'rst_local_test')
    data = tmp_path / 'replace.json'
    data.write_text('{"mode":"replace","targets":[]}')
    with pytest.raises(SystemExit) as error:
        main(['--url', 'http://127.0.0.1:8741', '--method', 'PUT', '--apply', '--data', str(data), '/api/feeds/1/recipients'])
    assert error.value.code == 2
    assert '--confirm-delete' in capsys.readouterr().err
