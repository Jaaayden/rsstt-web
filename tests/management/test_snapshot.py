import hashlib
import io
import json
import sqlite3
import subprocess
import sys
import tarfile

import pytest

from scripts.export_console_snapshot import export
from src.management.preview import prepare
from src.management.server import create_app
from src.management.service import Service
from src import db
from conftest import PASSWORD


def fixture_snapshot(tmp_path):
    source = tmp_path / 'original.sqlite3'
    session = tmp_path / 'bot.session'
    db = sqlite3.connect(source)
    db.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE user (id INTEGER PRIMARY KEY, state INTEGER);
        CREATE TABLE feed (id INTEGER PRIMARY KEY);
        CREATE TABLE sub (id INTEGER PRIMARY KEY);
        CREATE TABLE option (id INTEGER PRIMARY KEY);
        CREATE TABLE aerich (id INTEGER PRIMARY KEY);
        INSERT INTO user VALUES (1,1);
        INSERT INTO feed VALUES (1);
        INSERT INTO sub VALUES (1);
    ''')
    with sqlite3.connect(session) as cache:
        cache.executescript('''
            CREATE TABLE entities (id INTEGER, name TEXT, username TEXT, phone TEXT, hash TEXT);
            CREATE TABLE sessions (auth_key TEXT);
            INSERT INTO entities VALUES (1,'Cached name','cached_user','PRIVATE_PHONE','PRIVATE_HASH');
            INSERT INTO entities VALUES (999,'Unrelated name','unrelated',NULL,NULL);
            INSERT INTO sessions VALUES ('PRIVATE_AUTH_KEY');
        ''')
    before = {p: hashlib.sha256(p.read_bytes()).hexdigest()
              for p in (source, tmp_path / 'original.sqlite3-wal', session)}
    data = io.BytesIO()
    try:
        export(source, session, data)
        assert all(hashlib.sha256(p.read_bytes()).hexdigest() == value for p, value in before.items())
    finally:
        db.close()
    snapshot = tmp_path / 'snapshot'
    snapshot.mkdir()
    data.seek(0)
    with tarfile.open(fileobj=data, mode='r:gz') as archive:
        assert archive.getnames() == ['db.sqlite3', 'metadata.json']
        for name in archive.getnames():
            (snapshot / name).write_bytes(archive.extractfile(name).read())
    return snapshot


def test_wal_export_is_consistent_read_only_and_excludes_credentials(tmp_path):
    snapshot = fixture_snapshot(tmp_path)
    metadata = json.loads((snapshot / 'metadata.json').read_text())
    assert metadata['counts'] == {'user': 1, 'feed': 1, 'sub': 1}
    assert metadata['targets'] == [{'id': '1', 'title': 'Cached name', 'username': 'cached_user'}]
    assert metadata['sha256'] == hashlib.sha256((snapshot / 'db.sqlite3').read_bytes()).hexdigest()
    assert 'PRIVATE_' not in (snapshot / 'metadata.json').read_text()
    with sqlite3.connect(snapshot / 'db.sqlite3') as copy:
        assert copy.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
        assert copy.execute('SELECT id FROM sub').fetchone()[0] == 1


def test_working_copy_is_separate_and_restart_keeps_only_local_edits(tmp_path):
    snapshot = fixture_snapshot(tmp_path)
    work = tmp_path / 'working directory with spaces'
    work.mkdir()
    before = (snapshot / 'db.sqlite3').read_bytes()
    prepare(snapshot, work)
    with sqlite3.connect(work / 'db.sqlite3') as db:
        db.execute('UPDATE user SET state=0')
    prepare(snapshot, work)
    with sqlite3.connect(work / 'db.sqlite3') as db:
        assert db.execute('SELECT state FROM user').fetchone()[0] == 0
    assert (snapshot / 'db.sqlite3').read_bytes() == before
    with pytest.raises(ValueError, match='separate'):
        prepare(snapshot, snapshot)
    (work / 'snapshot.json').write_text('{"sha256":"other"}')
    with pytest.raises(ValueError, match='different snapshot'):
        prepare(snapshot, work)


def test_offline_process_blocks_tcp_udp_and_dns():
    result = subprocess.run([sys.executable, '-c', '''
import socket, sys
from src.management.preview import deny_network
with socket.socket() as listener, socket.socket() as client, socket.socket(type=socket.SOCK_DGRAM) as udp:
    listener.bind(('127.0.0.1', 0))
    listener.listen()
    with socket.socket() as browser:
        browser.connect(listener.getsockname())
        reply, _ = listener.accept()
        sys.addaudithook(deny_network)
        with reply:
            reply.sendmsg([b'HTTP reply'])
            assert browser.recv(100) == b'HTTP reply'
    for operation in (lambda: client.connect(listener.getsockname()),
                      lambda: udp.sendto(b'x', listener.getsockname()),
                      lambda: socket.getaddrinfo('example.invalid', 443)):
        try:
            operation()
        except RuntimeError as error:
            assert 'outgoing network' in str(error)
        else:
            raise AssertionError('Networking was not blocked')
'''], capture_output=True, text=True, timeout=5)
    assert result.returncode == 0, result.stderr


async def test_snapshot_api_marks_statistics_unknown_and_refuses_live_refresh(context, aiohttp_client):
    origin = 'http://127.0.0.1:8731'
    snapshot = {'captured_at': '2026-01-01T00:00:00+00:00', 'counts': {'user': 4, 'feed': 1, 'sub': 2}}
    app = await create_app(context.store, PASSWORD, origin, context.gateway, demo=True, snapshot=snapshot)
    client = await aiohttp_client(app)
    assert (await (await client.get('/api/public')).json())['snapshot'] == snapshot
    response = await client.post('/api/login', json={'password': PASSWORD}, headers={'Origin': origin})
    assert response.status == 200
    assert 'rsstt_session_8731' in response.cookies
    data = await (await client.get('/api/dashboard')).json()
    assert data['counts']['subscriptions'] == 2
    assert data['statistics']['available'] is False
    assert data['statistics']['totals']['delivered'] is None
    assert data['statistics']['daily'] == []
    trend = await (await client.get('/api/statistics')).json()
    assert trend['available'] is False
    assert all(bucket['delivered'] is None for bucket in trend['buckets'])
    response = await client.post('/api/targets/-1001/refresh', headers={'Origin': origin})
    assert response.status == 409
    assert '离线预览' in (await response.json())['error']


async def test_snapshot_mode_rejects_nonlocal_origin(context):
    with pytest.raises(ValueError, match='local offline demo'):
        await create_app(context.store, PASSWORD, 'https://console.example.com', context.gateway,
                         demo=True, snapshot={'captured_at': '2026-01-01'})


async def test_cached_names_do_not_promote_unknown_chat_type(context):
    await db.User.filter(id=-1001).update(state=1)

    class CachedGateway:
        async def inspect(self, ident):
            return dict(id=str(ident), title='Cached name', username=None, kind='group', membership='snapshot')

    service = Service(context.store, CachedGateway(), demo=True)
    await service.refresh(-1001, {'targets': None})
    assert (await db.User.get(id=-1001)).state == 1
