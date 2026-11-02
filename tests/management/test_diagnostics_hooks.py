import asyncio
import errno
import importlib
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from telethon.errors import BadRequestError, FloodWaitError, TimedOutError

from src import env, locks, web
from src.management import diagnostics, notifications
from src.management.notifications import Notifications, NotificationDeliveryError
from src.monitor._monitor import Monitor
from src.monitor._notifier import Notifier
from src.parsing.message import Message


@pytest.fixture
def events(monkeypatch):
    captured = []
    journal_record = diagnostics.Journal.record

    def emit(category, level, code, message, **values):
        captured.append(dict(category=category, level=level, code=code, message=message, **values))
        return True

    async def record(*args, **kwargs):
        return emit(*args, **kwargs)

    async def stored_record(journal, *args, **kwargs):
        emit(*args, **kwargs)
        return await journal_record(journal, *args, **kwargs)

    monkeypatch.setattr(diagnostics, 'emit', emit)
    monkeypatch.setattr(diagnostics, 'record', record)
    monkeypatch.setattr(diagnostics.Journal, 'record', stored_record)
    return captured


async def test_fetch_records_reason_backoff_and_recovery(context, monkeypatch, events):
    context.feed.link = 'https://user:private-password@example.invalid/private-key?token=secret-query'
    context.feed.error_count = 39
    await context.feed.save()
    result = SimpleNamespace(status=403, rss_d=None, url=context.feed.link,
                             error=SimpleNamespace(error_name='status code error', base_error=None))
    fetch = AsyncMock(return_value=result)
    monkeypatch.setattr(web, 'feed_get', fetch)
    now = datetime.now(timezone.utc)
    monitor = Monitor()
    await monitor._do_monitor_a_feed(context.feed, now)
    event = events[-1]
    assert event['code'] == 'fetch.failed'
    assert event['context']['http_status'] == 403
    assert event['context']['failures'] == 40
    assert event['context']['source_host'] == 'example.invalid'
    assert event['context']['duration_ms'] >= 0
    assert event['context']['next_retry_at'] == context.feed.next_check_time.isoformat()
    assert event['detail'] == 'status code error'
    assert not any(secret in json.dumps(events) for secret in ('private-key', 'secret-query', 'private-password'))
    before = len(events)
    await monitor._do_monitor_a_feed(context.feed, now)
    assert len(events) == before  # a deferred task did not issue an HTTP request
    result.status = 304
    await monitor._do_monitor_a_feed(context.feed, context.feed.next_check_time + timedelta(seconds=1))
    assert context.feed.error_count == 0
    assert [item['code'] for item in events[-2:]] == ['fetch.not_modified', 'fetch.recovered']
    assert events[-1]['context']['previous_failures'] == 40
    assert fetch.await_count == 2


async def test_network_and_parse_metadata_exclude_exception_text(context, monkeypatch, events):
    error = OSError(errno.ECONNREFUSED, 'private-token from response body')
    result = SimpleNamespace(status=-1, rss_d=None, url=context.feed.link,
                             error=SimpleNamespace(error_name='network error', base_error=error))
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=result))
    await Monitor()._do_monitor_a_feed(context.feed, datetime.now(timezone.utc))
    assert events[-1]['detail'] == f'network error; ConnectionRefusedError; errno={errno.ECONNREFUSED}'
    assert events[-1]['context']['exception_type'] == 'ConnectionRefusedError'
    assert 'private-token' not in json.dumps(events)
    result.status = 200
    result.error = SimpleNamespace(error_name='feed invalid', base_error=None)
    result.parse_diagnostic = {'exception_type': 'SAXParseException', 'line': 7, 'column': 18}
    await Monitor()._do_monitor_a_feed(context.feed, datetime.now(timezone.utc))
    assert events[-1]['context']['stage'] == 'parse'
    assert 'line=7' in events[-1]['detail'] and 'column=18' in events[-1]['detail']


async def test_fetch_unexpected_error_is_recorded_once_and_cancellation_is_not_failure(context, monkeypatch, events):
    error = RuntimeError('secret request payload')
    monkeypatch.setattr(web, 'feed_get', AsyncMock(side_effect=error))
    monitor = Monitor()
    with pytest.raises(RuntimeError):
        await monitor._do_monitor_a_feed(context.feed, datetime.now(timezone.utc))
    monitor._on_subtask_unknown_error(error, context.feed)
    assert len(events) == 1
    assert events[0]['code'] == 'fetch.exception' and events[0]['context']['stage'] == 'request'
    assert events[0]['detail'] == 'RuntimeError'
    events.clear()
    monkeypatch.setattr(web, 'feed_get', AsyncMock(side_effect=asyncio.CancelledError))
    with pytest.raises(asyncio.CancelledError):
        await monitor._do_monitor_a_feed(context.feed, datetime.now(timezone.utc))
    monitor._on_subtask_canceled(asyncio.CancelledError(), context.feed)
    assert events == []
    monitor._on_subtask_timeout(asyncio.CancelledError(), context.feed)
    assert [item['code'] for item in events] == ['fetch.timeout']


async def test_successful_fetch_and_deactivation_are_distinct(context, monkeypatch, events):
    result = SimpleNamespace(status=200, url=context.feed.link, error=None,
                             rss_d=SimpleNamespace(entries=[]),
                             web_response=SimpleNamespace(etag=None),
                             calc_next_check_as_per_server_side_cache=lambda: None)
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=result))
    await Monitor()._do_monitor_a_feed(context.feed, datetime.now(timezone.utc))
    assert events[-1]['code'] == 'fetch.empty'
    context.feed.error_count = 99
    result.rss_d = None
    result.error = SimpleNamespace(error_name='network error', base_error=TimeoutError())
    notify = AsyncMock()
    monkeypatch.setattr(Notifier, 'notify_all', notify)
    await Monitor()._do_monitor_a_feed(context.feed, datetime.now(timezone.utc))
    assert context.feed.error_count == 100
    notify.assert_awaited_once()
    assert events[-1]['code'] == 'fetch.deactivation_requested'
    assert events[-1]['context']['status'] == 'pending'


async def test_deactivation_is_logged_after_state_change_and_not_when_it_fails(context, monkeypatch, events):
    notifier_module = importlib.import_module('src.monitor._notifier')
    notifier = Notifier(context.feed, [])
    await notifier._deactivate_feed_and_notify_all()
    await context.feed.refresh_from_db()
    assert context.feed.state == 0
    assert events[-1]['code'] == 'fetch.deactivated'
    events.clear()
    monkeypatch.setattr(notifier_module.inner.utils, 'deactivate_feed', AsyncMock(side_effect=OSError('disk failure')))
    with pytest.raises(OSError):
        await notifier._deactivate_feed_and_notify_all()
    assert events == []


async def test_failed_status_save_is_visible_and_does_not_claim_recovery(context, monkeypatch, events):
    context.feed.error_count = 3
    await context.feed.save()
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=SimpleNamespace(
        status=304, rss_d=None, url=context.feed.link, error=None)))
    monkeypatch.setattr(context.feed, 'save', AsyncMock(side_effect=OSError('private-path and credentials')))
    with pytest.raises(OSError):
        await Monitor()._do_monitor_a_feed(context.feed, datetime.now(timezone.utc))
    assert [item['code'] for item in events] == ['fetch.not_modified', 'fetch.state_save_failed']
    assert events[-1]['context']['stage'] == 'persist'
    assert 'credentials' not in json.dumps(events)


async def test_new_entries_are_logged_without_article_text(context, monkeypatch, events):
    monitor_module = importlib.import_module('src.monitor._monitor')
    entries = [{'title': 'private article body', 'link': 'https://example.invalid/article/private-token'}]
    result = SimpleNamespace(status=200, url=context.feed.link, error=None,
                             rss_d=SimpleNamespace(entries=entries, feed=SimpleNamespace(title='Example')),
                             web_response=SimpleNamespace(etag=None, last_modified=datetime.now(timezone.utc)),
                             calc_next_check_as_per_server_side_cache=lambda: None)
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=result))
    monkeypatch.setattr(monitor_module, 'ensure_plain', AsyncMock(return_value='Example'))
    monkeypatch.setattr(monitor_module.inner.utils, 'calculate_update', lambda *args: ([123], entries))
    notify = AsyncMock()
    monkeypatch.setattr(Notifier, 'notify_all', notify)
    await Monitor()._do_monitor_a_feed(context.feed, datetime.now(timezone.utc))
    notify.assert_awaited_once()
    assert events[-1]['code'] == 'fetch.updated'
    assert events[-1]['context']['new_entries'] == 1
    assert 'private article body' not in json.dumps(events) and 'private-token' not in json.dumps(events)


def test_feed_parser_retains_only_pickleable_error_metadata():
    feed_module = importlib.import_module('src.web.feed')
    from src.compat import bozo_exception_removal_wrapper
    result = bozo_exception_removal_wrapper(feed_module._parse_with_diagnostics,
                                          b'<rss><channel><title>private-body</title><item></channel></rss>')
    assert 'bozo_exception' not in result
    metadata = result['rsstt_parse_diagnostic']
    assert metadata['exception_type'] == 'SAXParseException'
    assert isinstance(metadata['line'], int) and isinstance(metadata['column'], int)
    assert 'private-body' not in json.dumps(metadata)


async def test_real_feed_get_propagates_parser_metadata_without_response_body(monkeypatch):
    feed_module = importlib.import_module('src.web.feed')
    response = SimpleNamespace(content=b'<not-xml>private-body<', url='https://example.invalid/feed',
                               headers={}, status=200, reason='OK')
    monkeypatch.setattr(feed_module, 'get', AsyncMock(return_value=response))

    async def parse_locally(function, **kwargs):
        return function()

    monkeypatch.setattr(feed_module, 'run_async', parse_locally)
    result = await feed_module.feed_get(response.url, verbose=False)
    assert result.rss_d is None and result.error.error_name == 'feed invalid'
    assert result.parse_diagnostic['exception_type'] == 'SAXParseException'
    assert 'private-body' not in json.dumps(result.parse_diagnostic)


async def test_notification_retries_keep_http_reason_but_not_credentials(context, events):
    async def rejected(*args):
        raise NotificationDeliveryError('HTTP response rejected', 429)

    engine = await Notifications(context.store, sender=rejected).open()
    await engine.configure({'policy': {'enabled': True}, 'channels': {'webhook': {
        'enabled': True, 'url': 'https://example.invalid/private-key?token=secret-query',
        'headers': {'Authorization': 'Bearer private-token'}}}})
    await engine.event('fetch', str(context.feed.id), 3)
    for attempt in range(1, 4):
        await context.store.execute('UPDATE notify_jobs SET due=0')
        assert await engine.drain_once()
        event = events[-1]
        assert event['context']['http_status'] == 429
        assert event['context']['attempt'] == attempt
        assert event['feed_id'] == str(context.feed.id)
        assert ('next_retry_at' in event['context']) == (attempt < 3)
    assert [item['code'] for item in events] == ['notification.retry', 'notification.retry', 'notification.failed']
    assert not any(secret in json.dumps(events) for secret in ('private-key', 'secret-query', 'private-token'))


async def test_notification_error_text_and_offline_transport_are_excluded(context, events):
    async def rejected(*args):
        raise RuntimeError('Authorization: Bearer private-token; response-body-secret')

    engine = await Notifications(context.store, sender=rejected).open()
    await engine.configure({'policy': {'enabled': True}, 'channels': {'webhook': {
        'enabled': True, 'url': 'https://example.invalid/private-key'}}})
    await engine.test('webhook')
    await engine.drain_once()
    assert events[-1]['detail'] == 'RuntimeError'
    assert 'private-token' not in json.dumps(events) and 'response-body-secret' not in json.dumps(events)
    engine.offline = True
    await context.store.execute('UPDATE notify_jobs SET due=0')
    await engine.drain_once()
    assert events[-1]['code'] == 'notification.simulated'


async def test_offline_notification_persists_to_its_own_journal(context, monkeypatch):
    # Offline app instances deliberately do not install the process-global hook.
    # Their notification workers must write through their own store instead.
    monkeypatch.setattr(diagnostics, 'record', AsyncMock(side_effect=AssertionError('Global journal used')))
    engine = await Notifications(context.store, offline=True).open()
    await engine.configure({'policy': {'enabled': True}, 'channels': {'webhook': {
        'enabled': True, 'url': 'https://example.invalid/private-key'}}})
    await engine.test('webhook')
    await engine.drain_once()
    history = await context.store.diagnostics.history({'category': 'notification'})
    assert [item['code'] for item in history['items']] == ['notification.simulated']
    assert history['items'][0]['context']['status'] == 'simulated'
    assert 'private-key' not in json.dumps(history)


@pytest.mark.parametrize('kind,status,body,provider_code', [
    ('webhook', 429, {}, None), ('telegram', 200, {'ok': False, 'error_code': 401}, 401),
    ('bark', 200, {'code': 500}, 500),
])
async def test_notification_transport_exposes_only_safe_status_metadata(monkeypatch, kind, status, body, provider_code):
    class Response:
        content = SimpleNamespace(read=AsyncMock(return_value=json.dumps(body).encode()))

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

    response = Response()
    response.status = status

    class Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        def post(self, *args, **kwargs):
            assert kwargs['allow_redirects'] is False
            return response

    monkeypatch.setattr(notifications.aiohttp, 'ClientSession', lambda **kwargs: Session())
    engine = Notifications(None)
    with pytest.raises(NotificationDeliveryError) as caught:
        await engine.send(kind, {'url': 'https://example.invalid/private-key', 'token': 'private-token', 'chat_id': '1'},
                          {'event': 'test', 'subject': 'administrator', 'id': 1})
    assert caught.value.status == status and caught.value.provider_code == provider_code
    assert 'private' not in str(caught.value)


async def test_notifier_records_rejected_and_unconfirmed_delivery_without_post_content(context, monkeypatch, events):
    monkeypatch.setattr(env, 'bot', SimpleNamespace(get_input_entity=AsyncMock(return_value=object())))
    notifier = Notifier(context.feed, [context.sub])
    post = SimpleNamespace(send_formatted_post_according_to_sub=AsyncMock(return_value=False))
    await notifier._send(context.sub, post)
    assert events[-1]['code'] == 'delivery.unconfirmed'
    assert events[-1]['feed_id'] == context.feed.id and events[-1]['target_id'] == context.sub.user_id
    post.send_formatted_post_according_to_sub.side_effect = BadRequestError(None, 'MESSAGE_TOO_LONG')
    await notifier._send(context.sub, post)
    assert events[-1]['code'] == 'delivery.failed'
    assert events[-1]['detail'] == 'BadRequestError; MESSAGE_TOO_LONG'
    monkeypatch.setattr(env.bot, 'get_input_entity', AsyncMock(side_effect=ValueError('private-body')))
    await notifier._send(context.sub, post)
    assert events[-1]['code'] == 'delivery.blocked'
    assert 'private-body' not in json.dumps(events)


async def test_message_rate_limit_preserves_retries_and_reports_wait(monkeypatch, events):
    bot = SimpleNamespace(send_message=AsyncMock(side_effect=FloodWaitError(None, capture=12)))
    monkeypatch.setattr(env, 'bot', bot)
    monkeypatch.setattr(locks, 'user_msg_locks', lambda ident: (asyncio.Lock(), asyncio.Lock()))
    wait = AsyncMock()
    monkeypatch.setattr(locks, 'user_flood_wait_background', wait)
    message = Message(123, plain_text='private-body')
    assert await message.send() is None
    assert message.tries == 4 and bot.send_message.await_count == 2
    wait.assert_awaited_once_with(123, seconds=12)
    assert [item['code'] for item in events] == ['delivery.rate_limited', 'delivery.rate_limit_exhausted']
    assert all(item['context']['retry_after_seconds'] == 12 for item in events)
    assert 'private-body' not in json.dumps(events)


async def test_message_timeout_retries_and_normal_cancellation(monkeypatch, events):
    bot = SimpleNamespace(send_message=AsyncMock(side_effect=TimedOutError(None, 'TIMEOUT')))
    monkeypatch.setattr(env, 'bot', bot)
    monkeypatch.setattr(locks, 'user_msg_locks', lambda ident: (asyncio.Lock(), asyncio.Lock()))
    message = Message(123, plain_text='private-body')
    with pytest.raises(TimedOutError):
        await message.send()
    assert bot.send_message.await_count == 4
    assert events[-1]['context']['status'] == 'failed'
    assert events[-1]['code'] == 'delivery.transport_failed'
    assert all(item['code'] == 'delivery.transport_retry' for item in events[:-1])
    events.clear()
    bot.send_message.side_effect = asyncio.CancelledError
    with pytest.raises(asyncio.CancelledError):
        await Message(123, plain_text='private-body').send()
    assert events == []
