"""The console shows which release it is: the sign-in page and every page after it."""
from conftest import ORIGIN, token
from src.management import version


async def test_the_version_is_public_and_the_commit_is_not(context, monkeypatch):
    monkeypatch.setattr(version, 'build', lambda: 'abcdef0123456789abcdef0123456789abcdef01')
    public = await (await context.client.get('/api/public')).json()
    assert public['version'] == version.WEB_VERSION
    assert 'abcdef0' not in str(public)  # before sign-in the exact build stays private


async def test_the_session_reports_version_and_build(logged, monkeypatch):
    monkeypatch.setattr(version, 'build', lambda: 'abcdef0123456789abcdef0123456789abcdef01')
    session = await (await logged.client.get('/api/session')).json()
    assert session['version'] == version.WEB_VERSION and session['build'].startswith('abcdef0')
    assert (await logged.client.get('/api/session')).status == 200
    auth = await token(logged, 'read', ['-1001'])
    spec = await (await logged.client.get('/api/openapi.json', headers=auth)).json()
    assert {'version', 'build'} <= set(spec['components']['schemas']['Session']['properties'])
    assert spec['info']['version'] == version.WEB_VERSION
