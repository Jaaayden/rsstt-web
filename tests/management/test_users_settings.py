import json
import os
import stat

import pytest

from src import db, env
from src.command.inner.users import set_user_state
from src.runtime_config import RuntimeConfig, ConfigError, load_startup
from conftest import ORIGIN, token

WRITE = {'Origin': ORIGIN}


async def test_role_boundaries_and_manager_protection(logged):
    c = logged.client
    headers = await token(logged)
    assert (await c.patch('/api/targets/2/role', json={'role': 'admin'}, headers=headers)).status == 403
    assert (await c.patch('/api/targets/1/role', json={'role': 'banned'}, headers=WRITE)).status == 409
    assert (await db.User.get(id=1)).state == 1
    assert (await c.patch('/api/targets/-1001/role', json={'role': 'admin'}, headers=WRITE)).status == 409
    assert (await c.patch('/api/targets/2/role', json={'role': 'channel'}, headers=WRITE)).status == 400
    for role, state in [('admin', 100), ('guest', 0), ('user', 1)]:
        response = await c.patch('/api/targets/2/role', json={'role': role}, headers=WRITE)
        assert response.status == 200
        assert (await response.json())['role'] == role
        assert (await db.User.get(id=2)).state == state
    with pytest.raises(ValueError):
        await set_user_state(await db.User.get(id=2), -1, current_manager=2)
    # Setting state 100 does not change the deployment-owned managers.
    assert 2 not in env.MANAGER


async def test_ban_pauses_and_blocks_all_web_resume_paths(logged):
    c = logged.client
    result = await c.patch('/api/targets/-1001/role', json={'role': 'banned'}, headers=WRITE)
    assert result.status == 200
    assert (await result.json())['kind'] == 'channel'
    channels = (await (await c.get('/api/targets?kind=channel')).json())['items']
    assert '-1001' in [item['id'] for item in channels]
    assert (await db.Sub.get(id=logged.sub.id)).state == 0
    assert (await db.Sub.get(id=logged.other.id)).state == 1
    for value in (1, '1'):
        response = await c.patch(f'/api/subscriptions/{logged.sub.id}', json={'state': value}, headers=WRITE)
        assert response.status == 409
        error = await response.json()
        assert error['code'] == 'TARGET_BANNED'
        assert '无法恢复订阅' in error['error'] and '解除封禁' in error['error']
        assert (await db.Sub.get(id=logged.sub.id)).state == 0
    batch = await c.post('/api/subscriptions/batch', json={'ids': [logged.sub.id], 'action': 'resume'}, headers=WRITE)
    item = (await batch.json())['results'][0]
    assert item['ok'] is False and item['code'] == 'TARGET_BANNED'
    assert '解除封禁' in item['error']
    assert (await c.post('/api/subscriptions', json={'target': '-1001', 'urls': [logged.feed.link]}, headers=WRITE)).status == 409
    assert (await c.patch('/api/targets/-1001/role', json={'role': 'user'}, headers=WRITE)).status == 200
    assert (await db.Sub.get(id=logged.sub.id)).state == 0


async def test_shared_telegram_setter_and_language(logged):
    user = await db.User.get(id=2)
    await set_user_state(user, -1)
    items = (await (await logged.client.get('/api/targets')).json())['items']
    assert next(i for i in items if i['id'] == '2')['role'] == 'banned'
    for lang, status in [('en', 200), ('null', 200), ('invalid-code', 400)]:
        assert (await logged.client.patch('/api/targets/2', json={'lang': lang}, headers=WRITE)).status == status


async def test_runtime_permission_validation_and_redaction(logged):
    c = logged.client
    for path in ('/api/runtime-config',):
        headers = await token(logged)
        assert (await c.get(path, headers=headers)).status == 403
        assert (await c.patch(path, json={'MULTIUSER': False}, headers=headers)).status == 403
    sensitive = '12345:' + 'x' * 30
    response = await c.patch('/api/runtime-config', json={'TOKEN': sensitive, 'HTTP_TIMEOUT': 30, 'MULTIUSER': False}, headers=WRITE)
    assert response.status == 200
    assert sensitive not in await response.text()
    assert (await response.json())['pending_restart'] is True
    assert sensitive not in await (await c.get('/api/runtime-config')).text()
    assert sensitive not in json.dumps(await logged.store.rows('SELECT * FROM activity'))
    path = logged.store.path.parent / RuntimeConfig.filename
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    before = path.read_bytes()
    for patch in ({'WEB_PASSWORD': sensitive}, {'MANAGER': '2'}, {'MULTIUSER': 'false'},
                  {'HTTP_TIMEOUT': True}, {'HTTP_TIMEOUT': 0}, {'R_PROXY': 'file:///secret'},
                  {'HTTP_TIMEOUT': 25, 'API_HASH': 'invalid-sensitive-value'}):
        response = await c.patch('/api/runtime-config', json=patch, headers=WRITE)
        assert response.status == 400
        assert sensitive not in await response.text()
        assert 'invalid-sensitive-value' not in await response.text()
        assert path.read_bytes() == before
    assert env.HTTP_TIMEOUT != 30  # Saving does not pretend to modify the live object.


def test_restart_priority_reset_and_safe_backup(tmp_path):
    config = RuntimeConfig(tmp_path)
    config.save({'HTTP_TIMEOUT': 30, 'MULTIUSER': False, 'API_HASH': 'a' * 32})
    environment = {'HTTP_TIMEOUT': '12', 'MULTIUSER': '1', 'MANAGER': '123'}
    applied = load_startup(tmp_path, environment)
    assert environment == {'HTTP_TIMEOUT': '30', 'MULTIUSER': '0', 'MANAGER': '123', 'API_HASH': 'a' * 32}
    restarted = RuntimeConfig(tmp_path, applied, environment)
    assert not restarted.describe()['pending_restart']
    exported = restarted.safe_export()
    assert exported == {'version': 1, 'values': {'HTTP_TIMEOUT': 30, 'MULTIUSER': False}}
    assert 'a' * 32 not in json.dumps(restarted.describe())
    restarted.save({'HTTP_TIMEOUT': None})
    assert restarted.describe()['pending_restart']
    next_environment = {'HTTP_TIMEOUT': '12'}
    load_startup(tmp_path, next_environment)
    assert next_environment['HTTP_TIMEOUT'] == '12'


def test_corrupt_or_unknown_config_fails_closed(tmp_path):
    config = RuntimeConfig(tmp_path)
    config.path.write_text('{"version":1,"values":{"WEB_PASSWORD":"secret"}}')
    with pytest.raises(ConfigError):
        load_startup(tmp_path, {})
    config.path.write_text('not json secret')
    with pytest.raises(ConfigError) as error:
        config.safe_export()
    assert 'secret' not in str(error.value)


def test_real_env_startup_derives_settings_after_override(tmp_path):
    import subprocess
    import sys
    from pathlib import Path
    RuntimeConfig(tmp_path).save({'HTTP_TIMEOUT': 37, 'MULTIUSER': False,
                                 'T_PROXY': 'socks5://127.0.0.1:19222'})
    script = '''import sys, json
sys.argv = ['startup-check', '-c', sys.argv[1]]
from src import env
print(json.dumps([env.HTTP_TIMEOUT, env.MULTIUSER, env.TELEGRAM_PROXY_DICT['port']]))
'''
    environment = {**os.environ, 'TOKEN': 'test', 'MANAGER': '1', 'HTTP_TIMEOUT': '12',
                   'PYTHONPATH': str(Path(__file__).resolve().parents[2])}
    result = subprocess.run([sys.executable, '-c', script, str(tmp_path)], cwd=tmp_path,
                            env=environment, capture_output=True, text=True, check=True, timeout=15)
    assert json.loads(result.stdout.strip().splitlines()[-1]) == [37, False, 19222]


async def test_unknown_negative_id_is_not_claimed_as_group(logged):
    await db.User.create(id=-555, state=1)
    result = await logged.client.get('/api/targets?q=-555')
    item = (await result.json())['items'][0]
    assert item['kind'] == 'unknown'
    assert item['role'] == 'user'


@pytest.mark.parametrize('role,state', [('guest', 0), ('user', 1), ('banned', -1)])
async def test_negative_target_refresh_and_add_preserve_role(logged, role, state):
    c = logged.client
    response = await c.patch('/api/targets/-1001/role', json={'role': role}, headers=WRITE)
    assert response.status == 200
    # Force metadata refresh to prove the gateway result is applied without
    # converting the account's permission state into the channel type value 50.
    await logged.store.target(-1001, 'Old name', None, 'unknown', 'unknown')
    response = await c.post('/api/targets/-1001/refresh', headers=WRITE)
    assert response.status == 200
    item = await response.json()
    assert (item['state'], item['role'], item['kind']) == (state, role, 'channel')
    assert item['title'] == '会话 -1001'
    assert (await db.User.get(id=-1001)).state == state
    channels = (await (await c.get('/api/targets?kind=channel')).json())['items']
    assert '-1001' in [item['id'] for item in channels]
    response = await c.post('/api/subscriptions',
                            json={'target': '-1001', 'urls': [logged.feed.link]}, headers=WRITE)
    assert response.status == (409 if state == -1 else 200)
    assert (await db.User.get(id=-1001)).state == state
    if state == -1:
        assert (await db.Sub.get(id=logged.sub.id)).state == 0
