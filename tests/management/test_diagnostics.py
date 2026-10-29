import asyncio
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

from src.management import backups, diagnostics
from src.management.store import Store
from conftest import token
from test_backups import files, changed, rows, sql


async def test_history_requires_browser_admin_and_does_not_invent_old_errors(context):
    assert (await context.client.get('/api/diagnostics')).status == 401
    headers = await token(context)
    assert (await context.client.get('/api/diagnostics', headers=headers)).status == 403
    await context.client.post('/api/login', json={'password': 'console-test-password'}, headers={'Origin': 'http://console.test'})
    context.feed.error_count = 40
    await context.feed.save()
    response = await context.client.get(f'/api/feeds/{context.feed.id}/diagnostics')
    data = await response.json()
    assert response.status == 200 and data['items'] == [] and data['total'] == 0
    assert data['feed']['errors'] == 40 and data['started_at']
    assert data['retention'] == dict(days=30, max_entries=5000, per_feed=100)
    assert (await context.client.get('/api/feeds/999999/diagnostics')).status == 404
    public = await (await context.client.get('/api/public')).json()
    assert public['features']['diagnostics'] is True


async def test_history_filters_before_pagination_and_rejects_invalid_filters(logged):
    journal = logged.store.diagnostics
    for number in range(5):
        journal.emit('fetch', 'error', 'fetch.failed', '订阅源抓取失败。', feed_id=logged.feed.id,
                     context={'http_status': 403, 'failures': number + 1})
    journal.emit('notification', 'warning', 'notification.failed', '通知发送失败。', target_id=-1002)
    data = await (await logged.client.get('/api/diagnostics?category=fetch&level=error&page=2&size=2')).json()
    assert data['total'] == 5 and len(data['items']) == 2
    assert [item['context']['failures'] for item in data['items']] == [3, 2]
    assert all(item['feed_title'] == 'Example' for item in data['items'])
    scoped = await (await logged.client.get('/api/diagnostics?target_id=-1002')).json()
    assert len(scoped['items']) == 1 and scoped['items'][0]['category'] == 'notification'
    assert scoped['items'][0]['target_title'] == 'Target -1002'
    for query in ('category=unknown', 'level=debug', 'feed_id=1%20OR%201=1', 'target_id=x', 'size=101', 'q=secret'):
        assert (await logged.client.get('/api/diagnostics?' + query)).status == 400
    assert (await logged.client.get(f'/api/feeds/{logged.feed.id}/diagnostics?feed_id=999')).status == 400


async def test_deleted_source_keeps_diagnostics_with_id_and_no_invented_name(logged):
    feed_id = logged.feed.id
    logged.store.diagnostics.emit('fetch', 'error', 'fetch.failed', '抓取失败。', feed_id=feed_id, target_id=-1001)
    await logged.feed.delete()
    data = await (await logged.client.get(f'/api/diagnostics?feed_id={feed_id}')).json()
    assert len(data['items']) == 1 and data['items'][0]['feed_id'] == str(feed_id)
    assert data['items'][0]['feed_title'] is None and data['items'][0]['target_title'] == 'Target -1001'


async def test_messages_and_context_are_redacted_and_bounded(logged):
    journal = logged.store.diagnostics
    detail = ('HTTP 403 https://user:private-password@example.test/private/path?token=query-secret#fragment\n'
              'Authorization: Bearer header-secret\nCookie: first=cookie-secret; second=other-cookie\n'
              'password=plain-secret token=api-secret\n' + '错误' * 5000)
    journal.emit('fetch', 'error', 'fetch.failed', '读取来源失败。', detail=detail, feed_id=logged.feed.id,
                 context={'http_status': 403, 'duration_ms': 120.8, 'headers': {'secret': 'no'},
                          'source_host': 'https://user:pass@example.test/path?key=secret',
                          'exception_type': 'ClientResponseError', 'next_retry_at': datetime.now(timezone.utc),
                          'retry_after_seconds': 60, 'stage': 'request'})
    data = await journal.history({})
    item = data['items'][0]
    serialized = json.dumps(item)
    for private in ('private-password', 'private/path', 'query-secret', 'header-secret', 'cookie-secret',
                    'other-cookie', 'plain-secret', 'api-secret'):
        assert private not in serialized
    assert 'HTTP 403' in item['detail'] and item['context']['source_host'] == 'example.test'
    assert item['context']['duration_ms'] == 120 and item['context']['retry_after_seconds'] == 60
    assert 'headers' not in item['context'] and len(item['detail'].encode()) <= 2000


async def test_retention_caps_feed_global_and_age_without_unbounded_tasks(context, monkeypatch):
    monkeypatch.setattr(diagnostics, 'RETENTION', dict(days=30, max_entries=6, per_feed=3))
    journal = context.store.diagnostics
    tasks = len(asyncio.all_tasks())
    for number in range(20):
        journal.emit('fetch', 'error', 'fetch.failed', '失败。', feed_id=1 if number < 10 else 2)
    assert len(asyncio.all_tasks()) == tasks
    await journal.flush()
    data = await journal.history({})
    assert data['total'] == 6
    assert (await journal.history({'feed_id': '1'}))['total'] == 3
    await context.store.execute('UPDATE diagnostic_events SET at=? WHERE id=(SELECT MIN(id) FROM diagnostic_events)',
                                ((datetime.now(timezone.utc) - timedelta(days=31)).isoformat(),))
    journal.emit('system', 'info', 'console.started', '启动。')
    await journal.flush()
    assert (await context.store.rows('SELECT COUNT(*) AS n FROM diagnostic_events'))[0]['n'] == 6


async def test_queue_overflow_and_database_failure_are_visible_without_breaking_hooks(context, monkeypatch):
    journal = context.store.diagnostics
    for number in range(diagnostics.MAX_PENDING + 10):
        await journal.record('fetch', 'error', 'fetch.failed', '失败。', feed_id=number + 1)
    assert len(journal.pending) == diagnostics.MAX_PENDING and journal.dropped == 10
    with monkeypatch.context() as patch:
        patch.setattr(context.store.db, 'executemany', AsyncMock(side_effect=OSError('token=not-for-logs')))
        await journal.flush()
    assert journal.degraded is True and journal.dropped == diagnostics.MAX_PENDING + 10
    assert (await journal.history({}))['degraded'] is True
    journal.emit('fetch', 'info', 'fetch.recovered', '恢复。')
    assert (await journal.history({}))['degraded'] is False


async def test_global_install_is_explicit_and_close_flushes_last_events(tmp_path, monkeypatch):
    diagnostics.uninstall()
    assert diagnostics.emit('fetch', 'error', 'fetch.failed', '失败。') is False
    store = await Store(tmp_path / 'console.sqlite3').open()
    diagnostics.install(store)
    assert await diagnostics.record('fetch', 'error', 'fetch.failed', '失败。', feed_id=4)
    await store.close()
    assert diagnostics.emit('fetch', 'error', 'fetch.failed', '失败。') is False
    with sqlite3.connect(tmp_path / 'console.sqlite3') as connection:
        assert connection.execute('SELECT COUNT(*) FROM diagnostic_events').fetchone()[0] == 1


async def test_restore_resanitizes_and_limits_diagnostics_and_old_backup_clears_them(files, monkeypatch):
    main, console = files
    now = datetime.now(timezone.utc).isoformat()
    with sql(console) as connection:
        connection.execute('INSERT INTO diagnostic_events(at,category,level,code,message,detail,feed_id,target_id,context) '
                           'VALUES (?,?,?,?,?,?,?,?,?)',
                           (now, 'fetch', 'error', 'fetch.failed', '读取失败。',
                            'https://user:password@example.test/private?token=secret', '1', None,
                            json.dumps({'http_status': 403, 'token': 'context-secret'})))
    raw = backups.export(main, console)
    backups.restore(main, console, raw)
    restored = rows(console, 'SELECT detail,context FROM diagnostic_events')[0]
    assert 'password' not in restored[0] and 'token=secret' not in restored[0]
    assert json.loads(restored[1]) == {'http_status': 403}
    monkeypatch.setattr(diagnostics, 'RETENTION', dict(days=30, max_entries=3, per_feed=2))

    def extra_history(package):
        item = package['data']['console.diagnostic_events']
        template = dict(zip(item['columns'], item['rows'][0]))
        item['rows'].clear()
        for number in range(1, 12):
            record = {**template, 'id': number, 'feed_id': '1' if number < 8 else '2' if number < 10 else '3'}
            if number == 11:
                record['at'] = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
            item['rows'].append([record[column] for column in item['columns']])

    backups.restore(main, console, changed(raw, extra_history))
    assert len(rows(console, 'SELECT id FROM diagnostic_events')) == 3
    assert all(number <= 2 for _, number in rows(console, 'SELECT feed_id,COUNT(*) FROM diagnostic_events GROUP BY feed_id'))
    assert rows(console, 'SELECT id FROM diagnostic_events WHERE id=11') == []
    old = changed(raw, lambda package: (package['manifest']['extensions'].remove('diagnostic_events'),
                                      package['data'].pop('console.diagnostic_events')))
    backups.restore(main, console, old)
    assert rows(console, 'SELECT * FROM diagnostic_events') == []


async def test_offline_restore_result_is_safe_and_recorded_once(context):
    path = context.store.path.parent / '.restore-result.json'
    path.write_text(json.dumps(dict(status='failed', error='备份格式、版本、组件或完整性校验失败。',
                                    exception_type='BackupError', rollback_directory='/private/not-logged')))
    await diagnostics.observe_restore(context.store)
    await diagnostics.observe_restore(context.store)
    history = await context.store.diagnostics.history({})
    assert history['total'] == 1 and history['items'][0]['code'] == 'backup.restore_failed'
    assert '/private/not-logged' not in json.dumps(history)


async def test_failed_sign_in_and_password_change_are_logged_without_passwords(context):
    old = 'console-test-password'
    headers = {'Origin': 'http://console.test'}
    assert (await context.client.post('/api/login', json={'password': 'wrong-secret'}, headers=headers)).status == 401
    assert (await context.client.post('/api/login', json={'password': old}, headers=headers)).status == 200
    response = await context.client.post('/api/auth/password', json={'current_password': 'wrong-secret',
                                                                    'new_password': 'new-password-secret'}, headers=headers)
    assert response.status == 400
    data = await context.store.diagnostics.history({'category': 'system'})
    assert {row['code'] for row in data['items']} == {'auth.sign_in_failed', 'auth.signed_in', 'auth.password_change_rejected'}
    assert 'wrong-secret' not in json.dumps(data) and old not in json.dumps(data)


async def test_background_exception_records_route_and_type_without_request_values(logged, monkeypatch):
    monkeypatch.setattr(logged.store, 'statistics_window', AsyncMock(side_effect=RuntimeError('password=private-request-value')))
    assert (await logged.client.get('/api/statistics')).status == 500
    data = await logged.store.diagnostics.history({'category': 'system', 'level': 'error'})
    assert len(data['items']) == 1 and data['items'][0]['code'] == 'console.request_failed'
    assert data['items'][0]['context'] == {'exception_type': 'RuntimeError', 'method': 'GET', 'route': '/api/statistics'}
    assert 'private-request-value' not in json.dumps(data)
