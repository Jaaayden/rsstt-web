from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src import env
from src.management import metrics
from src.monitor._notifier import Notifier
from src.parsing.message import MessageDispatcher


@pytest.mark.parametrize('results, expected', [([object()], True), ([None], False), ([object(), None], False), ([[object(), object()]], True)])
async def test_dispatcher_reports_actual_completed_delivery(results, expected):
    dispatcher=object.__new__(MessageDispatcher)
    dispatcher.user_id=123
    dispatcher.messages=[SimpleNamespace(send=AsyncMock(return_value=result)) for result in results]
    assert await dispatcher.send_messages() is expected


@pytest.mark.parametrize('delivered', [True, False, None])
async def test_notifier_counts_only_successful_posts(logged, monkeypatch, delivered):
    monkeypatch.setattr(metrics, 'store', logged.store)
    monkeypatch.setattr(env, 'bot', SimpleNamespace(get_input_entity=AsyncMock(return_value=object())))
    post=SimpleNamespace(send_formatted_post_according_to_sub=AsyncMock(return_value=delivered))
    notifier=Notifier(logged.feed, [logged.sub])
    await notifier._send(logged.sub, post)
    assert (await logged.store.statistics())['totals']['delivered']==(1 if delivered else 0)


async def test_blocked_chat_does_not_count(logged, monkeypatch):
    monkeypatch.setattr(metrics, 'store', logged.store)
    monkeypatch.setattr(env, 'bot', SimpleNamespace(get_input_entity=AsyncMock(side_effect=ValueError)))
    post=SimpleNamespace(send_formatted_post_according_to_sub=AsyncMock(return_value=True))
    notifier=Notifier(logged.feed, [logged.sub])
    await notifier._send(logged.sub, post)
    post.send_formatted_post_according_to_sub.assert_not_awaited()
    assert (await logged.store.statistics())['totals']['delivered']==0


async def test_counter_failure_is_visible_and_does_not_interrupt_bot(monkeypatch):
    monkeypatch.setattr(metrics, 'store', SimpleNamespace(increment=AsyncMock(side_effect=OSError('disk full'))))
    await metrics.record(delivered=1)
    assert metrics.last_error is not None
    monkeypatch.setattr(metrics, 'store', SimpleNamespace(increment=AsyncMock()))
    await metrics.record(delivered=1)
    assert metrics.last_error is None
