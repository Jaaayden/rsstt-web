"""Lifecycle invariants for idle state cleanup, with no transport or scheduler."""
import asyncio
import gc
from collections import defaultdict
from types import SimpleNamespace
from unittest.mock import Mock
import weakref

import pytest

from src import locks
from src.monitor._monitor import Monitor, TaskState


def isolated_monitor():
    # Avoid registering another singleton's EffectiveOptions callback.
    monitor = object.__new__(Monitor)
    monitor._subtask_defer_map = defaultdict(lambda: TaskState.EMPTY)
    monitor._stat = SimpleNamespace(deferred=Mock(), resubmitted=Mock())
    monitor.submit_feed = Mock()
    return monitor


def test_finished_and_missing_feed_ids_do_not_accumulate():
    monitor = isolated_monitor()
    for ident in range(10000):
        assert monitor._defer_feed_id(ident) is False
        monitor._subtask_defer_map[ident] = TaskState.IN_PROGRESS
        monitor._erase_state_for_feed_id(ident, TaskState.IN_PROGRESS)
    assert not monitor._subtask_defer_map
    for ident in range(10000, 20000):
        assert monitor._defer_feed_id(ident) is False  # may not exist in the DB
    assert not monitor._subtask_defer_map


@pytest.mark.parametrize('first,last', [
    (TaskState.IN_PROGRESS, TaskState.LOCKED),
    (TaskState.LOCKED, TaskState.IN_PROGRESS),
])
def test_cleanup_preserves_deferred_resubmission_order(first, last):
    monitor = isolated_monitor()
    monitor._subtask_defer_map[1] = first | last
    assert monitor._defer_feed_id(1) is True
    assert monitor._defer_feed_id(1) is True
    monitor._erase_state_for_feed_id(1, first)
    assert monitor._subtask_defer_map[1] == last | TaskState.DEFERRED
    monitor.submit_feed.assert_not_called()
    monitor._erase_state_for_feed_id(1, last)
    monitor.submit_feed.assert_called_once_with(1, 'resubmit deferred subtask')
    assert monitor._defer_feed_id(1) is False
    assert not monitor._subtask_defer_map


def test_idle_host_semaphores_are_reclaimed():
    gc.collect()
    baseline = len(locks._hostname_semaphore_bucket)
    for ident in range(10000):
        semaphore = locks.hostname_semaphore(f'https://synthetic-{ident}.invalid/feed')
        assert locks.hostname_semaphore(f'https://synthetic-{ident}.invalid/other') is semaphore
    ref = weakref.ref(semaphore)
    del semaphore
    gc.collect()
    assert ref() is None
    assert len(locks._hostname_semaphore_bucket) == baseline


async def test_host_waiters_and_cancellation_keep_same_semaphore():
    semaphore = locks.hostname_semaphore('https://same.invalid/feed')
    permits = semaphore._value
    for _ in range(permits):
        await semaphore.acquire()
    waiter = asyncio.create_task(semaphore.acquire())
    await asyncio.sleep(0)
    gc.collect()
    assert not waiter.done()
    assert locks.hostname_semaphore('same.invalid', parse=False) is semaphore
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    assert locks.hostname_semaphore('same.invalid', parse=False) is semaphore
    semaphore.release()
    successor = asyncio.create_task(semaphore.acquire())
    assert await successor is True
    for _ in range(permits):
        semaphore.release()
    assert semaphore._value == permits


@pytest.mark.parametrize('error', [RuntimeError('synthetic failure'), asyncio.CancelledError()])
async def test_monitor_failure_and_cancellation_keep_cooldown_until_release(error):
    from unittest.mock import AsyncMock
    monitor = isolated_monitor()
    monitor._stat.start = Mock()
    monitor._stat.finish = Mock()
    monitor._do_monitor_a_feed = AsyncMock(side_effect=error)
    monitor._subtask_defer_map[1] = TaskState.LOCKED
    with pytest.raises(type(error)):
        await monitor._do_monitor_subtask(SimpleNamespace(id=1), None)
    assert monitor._subtask_defer_map[1] == TaskState.LOCKED
    monitor._stat.finish.assert_called_once()
    monitor._erase_state_for_feed_id(1, TaskState.LOCKED)
    assert not monitor._subtask_defer_map
