from contextlib import contextmanager
import hashlib
import json
import sqlite3
from pathlib import Path

import pytest
from tortoise import Tortoise
from src import db
from src.management import backups
from src.management.store import Store
from conftest import ORIGIN, token


@contextmanager
def sql(path):
    connection = sqlite3.connect(path)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


@pytest.fixture
async def files(tmp_path):
    main, console = tmp_path / 'main.sqlite3', tmp_path / 'console.sqlite3'
    await Tortoise.init(db_url=f'sqlite://{main}', modules={'models': ['src.db.models']})
    await Tortoise.generate_schemas()
    await db.User.create(id=1)
    feed = await db.Feed.create(id=1, title='Fixture', link='https://fixture.invalid/rss', interval=12)
    await db.Sub.create(id=1, user_id=1, feed=feed)
    await db.Option.create(key='default_interval', value='12')
    store = await Store(console).open()
    await store.increment(fetched=7, delivered=11)
    await store.issue('source-session')
    await store.issue('source-token', kind='token', permission='read')
    await store.close()
    await Tortoise.close_connections()
    yield main, console
    await Tortoise.close_connections()


def rows(path, query):
    with sql(path) as connection:
        return connection.execute(query).fetchall()


def changed(raw, callback):
    package = json.loads(raw)
    callback(package)
    package['manifest']['sha256'] = hashlib.sha256(backups.encode(package['data'])).hexdigest()
    return backups.encode(package)


async def test_roundtrip_preserves_auth_tokens_and_reloads_runtime(files):
    main, console = files
    raw = backups.export(main, console)
    assert 'source-session' not in raw.decode() and 'source-token' not in raw.decode()
    assert 'main.sub' in backups.validate(main, console, raw)['counts']
    with sql(main) as connection:
        connection.execute('UPDATE feed SET interval=99')
        connection.execute("UPDATE option SET value='99'")
    with sql(console) as connection:
        connection.execute('UPDATE metrics SET fetched=100')
        connection.execute("UPDATE credentials SET name='target-token' WHERE kind='token'")
    result = backups.restore(main, console, raw)
    assert result['status'] == 'applied_offline'
    assert rows(console, "SELECT name FROM credentials") == [('target-token',)]
    assert rows(console, "SELECT fetched FROM metrics WHERE day='total'") == [(7,)]
    assert Path(result['rollback_directory'], 'main.sqlite3').exists()
    await Tortoise.init(db_url=f'sqlite://{main}', modules={'models': ['src.db.models']})
    await db.EffectiveOptions.cache()
    await db.EffectiveTasks.init(flush=True)
    assert db.EffectiveOptions.default_interval == 12
    assert db.EffectiveTasks.get_interval(1) == 12
    assert (await db.Sub.get(id=1)).feed_id == 1


async def test_explicit_token_overwrite_and_omitted_component(files):
    main, console = files
    raw = backups.export(main, console, {'agent_tokens': True})
    assert 'source-token' in raw.decode() and 'source-session' not in raw.decode()
    with sql(console) as c:
        c.execute("UPDATE credentials SET name='target' WHERE kind='token'")
    backups.restore(main, console, raw)
    assert rows(console, 'SELECT name FROM credentials') == [('target',)]
    backups.restore(main, console, raw, {'agent_tokens': True})
    assert rows(console, 'SELECT name FROM credentials') == [('source-token',)]
    raw = backups.export(main, console)
    with pytest.raises(backups.BackupError):
        backups.restore(main, console, raw, {'agent_tokens': True})
    with pytest.raises(backups.BackupError):
        backups.export(main, console, {'admin_credentials': True})


async def test_injected_failure_rolls_back_both_databases(files, monkeypatch):
    main, console = files
    raw = backups.export(main, console)
    with sql(main) as c:
        c.execute("UPDATE feed SET title='Current'")
    with sql(console) as c:
        c.execute('UPDATE metrics SET fetched=42')
    original = backups.apply_rows
    calls = 0
    def fail(connection, package, options):
        nonlocal calls
        calls += 1
        original(connection, package, options)
        if calls == 2:  # preflight succeeds; fail after all real inserts
            raise RuntimeError('injected')
    monkeypatch.setattr(backups, 'apply_rows', fail)
    with pytest.raises(RuntimeError):
        backups.restore(main, console, raw)
    assert rows(main, 'SELECT title FROM feed') == [('Current',)]
    assert rows(console, "SELECT fetched FROM metrics WHERE day='total'") == [(42,)]
    assert len(rows(console, 'SELECT * FROM credentials')) == 2


async def test_bad_packages_and_path_attacks(files, tmp_path):
    main, console = files
    raw = backups.export(main, console)
    for bad in (b'not json', raw[:-1], b'x' * (backups.MAX_BYTES + 1), b'{"data":{},"data":{}}'):
        with pytest.raises(backups.BackupError):
            backups.unpack(bad)
    bad = changed(raw, lambda p: p['data'].__setitem__('../../bot.session', {'columns': [], 'rows': []}))
    with pytest.raises(backups.BackupError):
        backups.unpack(bad)
    bad = changed(raw, lambda p: p['data']['main.sub']['rows'][0].__setitem__(p['data']['main.sub']['columns'].index('feed_id'), 999))
    with pytest.raises((backups.BackupError, sqlite3.Error)):
        backups.validate(main, console, bad)
    link = tmp_path / 'link.sqlite3'
    link.symlink_to(main)
    with pytest.raises(backups.BackupError):
        backups.export(link, console)
    assert rows(main, 'SELECT id FROM sub') == [(1,)]


async def test_running_instance_blocks_restore(files):
    main, console = files
    raw = backups.export(main, console)
    with backups.InstanceLock(main):
        with pytest.raises(backups.BackupError, match='正在运行'):
            backups.restore(main, console, raw)
    store = await Store(console).open()
    try:
        with pytest.raises(backups.BackupError, match='正在运行'):
            backups.restore(main, console, raw)
    finally:
        await store.close()


async def test_pending_applies_before_runtime_and_records_failure(files):
    main, console = files
    raw = backups.export(main, console)
    pending = console.parent / '.restore-pending.json'
    job = {'backup': raw.decode(), 'overwrite': {}, 'sha256': hashlib.sha256(raw).hexdigest()}
    backups.write_private(pending, backups.encode(job))
    with sql(main) as c:
        c.execute("UPDATE feed SET title='Changed'")
    with backups.InstanceLock(main):
        backups.apply_pending(main, console)
    assert rows(main, 'SELECT title FROM feed') == [('Fixture',)]
    assert not pending.exists()
    assert json.loads((console.parent / '.restore-result.json').read_text())['status'] == 'succeeded'
    job['sha256'] = 'bad'
    backups.write_private(pending, backups.encode(job))
    with backups.InstanceLock(main), pytest.raises(backups.BackupError):
        backups.apply_pending(main, console)
    assert json.loads((console.parent / '.restore-result.json').read_text())['status'] == 'failed'
    assert (console.parent / '.restore-failed.json').exists()


async def test_api_requires_browser_admin_and_reports_backend(logged):
    client = logged.client
    response = await client.get('/api/backups')
    assert response.status == 200
    assert (await response.json())['mode'] == 'apply_on_restart'
    headers = await token(logged)
    assert (await client.get('/api/backups', headers=headers)).status == 403
    assert (await client.post('/api/backups/export', json={})).status == 403
    assert (await client.post('/api/backups/export', json={'admin_credentials': True}, headers={'Origin': ORIGIN})).status == 400

async def test_registered_admin_blob_overwrite(files):
    main, console = files
    with sql(console) as c:
        c.execute('CREATE TABLE console_admin (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, salt BLOB NOT NULL, hash BLOB NOT NULL)')
        c.execute('INSERT INTO console_admin VALUES (1,?,?,?)', ('source-admin', b's' * 16, b'h' * 64))
    raw = backups.export(main, console, {'admin_credentials': True})
    with sql(console) as c:
        c.execute("UPDATE console_admin SET username='target-admin'")
    backups.restore(main, console, raw)
    assert rows(console, 'SELECT username FROM console_admin') == [('target-admin',)]
    backups.restore(main, console, raw, {'admin_credentials': True})
    assert rows(console, 'SELECT username,salt,hash FROM console_admin') == [('source-admin', b's' * 16, b'h' * 64)]


async def test_extensions_hourly_and_queue_exclusion(files):
    main, console = files
    with sql(console) as c:
        c.execute('CREATE TABLE IF NOT EXISTS metrics_hourly (bucket TEXT PRIMARY KEY, fetched INTEGER NOT NULL DEFAULT 0, delivered INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0)')
        c.execute('DELETE FROM metrics_hourly')
        c.execute("INSERT INTO metrics_hourly VALUES ('2026-10-26T00:00:00Z', 7, 11, 0)")
        c.execute('CREATE TABLE IF NOT EXISTS notify_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT, event TEXT, subject TEXT, status TEXT, attempts INTEGER DEFAULT 0, due REAL, created REAL)')
        c.execute('DELETE FROM notify_jobs')
        c.execute("INSERT INTO notify_jobs (id,event) VALUES (1, 'must not replay')")
    raw = backups.export(main, console)
    assert 'must not replay' not in raw.decode()
    with sql(console) as c:
        c.execute('DELETE FROM metrics_hourly')
    backups.restore(main, console, raw)
    assert rows(console, 'SELECT fetched FROM metrics_hourly') == [(7,)]
    assert rows(console, 'SELECT * FROM notify_jobs') == []


async def test_runtime_adapter_rollback_and_crash_recovery(files, monkeypatch):
    # Adapter contract test; real PR2 module remains in its own PR.
    main, console = files
    runtime = console.parent / 'runtime-config.json'
    runtime.write_text('{"version":1,"values":{"USER_AGENT":"before","TOKEN":"private"}}')
    monkeypatch.setattr(backups.backup_runtime, 'available', lambda: True)
    monkeypatch.setattr(backups.backup_runtime, 'export', lambda folder: {'version': 1, 'values': {'USER_AGENT': 'source'}})
    monkeypatch.setattr(backups.backup_runtime, 'validate', lambda value: value['values'])
    raw = backups.export(main, console, {'runtime_config': True})
    assert 'private' not in raw.decode()
    def failed_save(folder, value):
        runtime.write_text('partially changed')
        raise OSError('injected configuration write failure')
    monkeypatch.setattr(backups.backup_runtime, 'restore', failed_save)
    with sql(main) as c:
        c.execute("UPDATE feed SET title='target'")
    with pytest.raises(OSError):
        backups.restore(main, console, raw, {'runtime_config': True})
    assert rows(main, 'SELECT title FROM feed') == [('target',)]
    assert json.loads(runtime.read_text())['values']['TOKEN'] == 'private'
    assert not (console.parent / '.restore-recovery.json').exists()
    # Simulate abrupt termination after commit: durable marker stays and next
    # startup recovers both SQL files and original runtime configuration.
    original_recover = backups.recover
    def crash_recover(*args):
        if (console.parent / '.restore-recovery.json').exists():
            raise SystemExit('simulated process death')
    monkeypatch.setattr(backups, 'recover', crash_recover)
    with pytest.raises(SystemExit):
        backups.restore(main, console, raw, {'runtime_config': True})
    assert (console.parent / '.restore-recovery.json').exists()
    monkeypatch.setattr(backups, 'recover', original_recover)
    with backups.InstanceLock(main), backups.InstanceLock(console):
        backups.recover(main, console)
    assert rows(main, 'SELECT title FROM feed') == [('target',)]
    assert json.loads(runtime.read_text())['values']['TOKEN'] == 'private'


async def test_imported_token_cannot_escalate_to_admin(files):
    main, console = files
    raw = backups.export(main, console, {'agent_tokens': True})
    def escalate(package):
        item = package['data']['console.credentials']
        item['rows'][0][item['columns'].index('permission')] = 'admin'
    malicious = changed(raw, escalate)
    with pytest.raises(backups.BackupError):
        backups.validate(main, console, malicious, {'agent_tokens': True})
    assert rows(console, "SELECT permission FROM credentials WHERE kind='token'") == [('read',)]


async def test_archive_backup_roundtrip_and_legacy_restore(files):
    main, console = files
    with sql(console) as c:
        c.execute("INSERT INTO chat_archive VALUES ('1', '2026-10-27T00:00:00+00:00')")
    raw = backups.export(main, console)
    assert 'console.chat_archive' in backups.validate(main, console, raw)['counts']
    with sql(console) as c:
        c.execute('DELETE FROM chat_archive')
    backups.restore(main, console, raw)
    assert rows(console, 'SELECT id FROM chat_archive') == [('1',)]
    def legacy(package):
        package['manifest']['extensions'].remove('chat_archive')
        del package['data']['console.chat_archive']
    old = changed(raw, legacy)
    backups.restore(main, console, old)
    assert rows(console, 'SELECT id FROM chat_archive') == []
