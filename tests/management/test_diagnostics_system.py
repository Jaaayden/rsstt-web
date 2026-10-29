from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.management import backups, metrics
from conftest import ORIGIN


async def test_metrics_logs_failure_transition_and_recovery(monkeypatch):
    journal = SimpleNamespace(record=AsyncMock())
    store = SimpleNamespace(increment=AsyncMock(side_effect=OSError('private disk path')),
                            diagnostics=journal)
    monkeypatch.setattr(metrics, 'store', store)
    monkeypatch.setattr(metrics, 'last_error', None)
    await metrics.record(delivered=1)
    await metrics.record(delivered=1)
    assert journal.record.await_count == 1
    failed = journal.record.await_args
    assert failed.args[2] == 'metrics.failed'
    assert failed.kwargs['context']['exception_type'] == 'OSError'
    assert 'private disk path' not in repr(failed)
    store.increment.side_effect = None
    await metrics.record(delivered=1)
    await metrics.record(delivered=1)
    assert journal.record.await_count == 2
    assert journal.record.await_args.args[2] == 'metrics.recovered'
    assert metrics.last_error is None


@pytest.mark.parametrize('error,expected_detail', [
    (backups.BackupError('备份与目标数据库结构不一致，请先使用相同版本。'),
     '备份与目标数据库结构不一致，请先使用相同版本。'),
    (OSError('private-path-and-secret'), ''),
])
async def test_backup_failure_records_controlled_reason(logged, monkeypatch, tmp_path, error, expected_detail):
    journal = SimpleNamespace(record=AsyncMock())
    # Preserve the real journal lifecycle; observe only the API's instance call.
    monkeypatch.setattr(logged.store.diagnostics, 'record', journal.record)
    monkeypatch.setattr(backups, 'sqlite_path', lambda _: tmp_path / 'unused.sqlite3')

    def fail_export(*args):
        raise error

    monkeypatch.setattr(backups, 'export', fail_export)
    response = await logged.client.post('/api/backups/export', json={}, headers={'Origin': ORIGIN})
    assert response.status == 400
    failed = next(call for call in journal.record.await_args_list if call.args[2] == 'backup.failed')
    assert failed.kwargs['detail'] == expected_detail
    assert failed.kwargs['context']['exception_type'] == type(error).__name__
    assert 'private-path-and-secret' not in repr(failed)
