"""Offline regressions: real ORM, scheduler, HTML parser; no Telegram transport."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from telethon import events
from telethon.extensions import html
from telethon.tl.types import MessageEntityTextUrl, User

from src import db
from src.command import inner, sub as commands
from src.command.list_page import get_list_page, render_entry, utf16_length
from src.command.utils import command_gatekeeper
from src.i18n import i18n
from src.management import server


def assert_safe(markup):
    text, entities = html.parse(markup)
    assert utf16_length(text) <= 4096
    assert len(entities) <= 100
    from src.command.list_page import PAGE_ENTITY_BYTES_LIMIT, PAGE_URL_BYTES_LIMIT, ENTITY_VECTOR_BYTES
    assert ENTITY_VECTOR_BYTES + sum(len(bytes(e)) for e in entities) <= PAGE_ENTITY_BYTES_LIMIT
    assert sum(len(getattr(e, 'url', '').encode('utf-8')) for e in entities) <= PAGE_URL_BYTES_LIMIT
    assert all(e.offset + e.length <= utf16_length(text) for e in entities)
    for entity in entities:
        bytes(entity)  # Exercise Telethon's actual TL encoding, including Unicode URLs.
    return text, entities


@pytest.mark.parametrize('title', ['中文' * 40, '😀🧑\u200d💻' * 40, '<b>文字 & "引用"</b>' * 10, 'x' * 1000])
async def test_list_length_and_complete_coverage(context, title):
    await db.Sub.filter(user_id=-1001).delete()
    feeds = [db.Feed(id=100+i, link=f'https://example.test/{i}', title=f'{i}:{title}') for i in range(105)]
    await db.Feed.bulk_create(feeds)
    await db.Sub.bulk_create([db.Sub(user_id=-1001, feed_id=f.id) for f in feeds])
    first = await get_list_page(-1001, 1, '订阅 <列表> & 😀')
    urls = []
    for page in range(1, first[1] + 1):
        number, count, markup, total = await get_list_page(-1001, page, '订阅 <列表> & 😀')
        assert (number, count, total) == (page, first[1], 105)
        _, entities = assert_safe(markup)
        urls += [e.url for e in entities if isinstance(e, MessageEntityTextUrl)]
    assert urls == [f.link for f in reversed(feeds)]
    assert (await get_list_page(-1001, 99999, '订阅 <列表> & 😀'))[0] == first[1]
    assert (await get_list_page(-1001, 0, '订阅 <列表> & 😀'))[0] == 1


async def test_entity_boundary_and_multiple_query_batches(context):
    await db.Sub.filter(user_id=-1001).delete()
    await db.Feed.bulk_create([db.Feed(id=100+i, link=f'https://example.test/{i}', title='短') for i in range(300)])
    await db.Sub.bulk_create([db.Sub(user_id=-1001, feed_id=100+i) for i in range(300)])
    result = await get_list_page(-1001, 1, '列表')
    assert result[:2] == (1, 4)
    assert len(assert_safe(result[2])[1]) == 100
    result = await get_list_page(-1001, 4, '列表')
    assert len(assert_safe(result[2])[1]) == 4
    assert result[3] == 300


@pytest.mark.parametrize('url,linked', [
    ('https://example.test/?a="x"&b=<y>', True),
    ('https://example.test/' + 'a' * 2026, True),
    ('https://example.test/' + 'a' * 2027, True),
    ('https://example.test/' + 'a' * 2028, False),
    ('https://example.test/' + '😀' * 2048, False),
    ('https://example.test/中文😀?a=🧑', True),
    ('javascript:alert(1)', False), ('https://[bad', False),
])
def test_url_escape_and_limits(url, linked):
    markup, _, count = render_entry('<b>A & B</b>', url)
    text, entities = assert_safe(markup)
    assert text == '<b>A & B</b>'
    assert bool(count) == linked
    assert [e.url for e in entities] == ([url] if linked else [])


class Event:
    chat_id = -1001
    is_private = False
    is_group = False
    data = b'get_list_page|2%+1001'
    def __init__(self):
        self.respond = AsyncMock()
        self.edit = AsyncMock()


async def test_command_callback_and_empty_after_delete(context, monkeypatch):
    # Force multiple text pages without requiring 99 rows.
    context.sub.title = '😀' * 1000
    await context.sub.save()
    for i in range(8):
        feed = await db.Feed.create(link=f'https://example.test/{i}', title='😀' * 1000)
        await db.Sub.create(user_id=-1001, feed=feed)
    event = Event()
    await commands.cmd_list_or_callback_get_list_page.__wrapped__(event, lang='zh-Hans')
    assert_safe(event.respond.call_args.args[0])
    assert any(b.data == b'get_list_page|2' for b in event.respond.call_args.kwargs['buttons'])
    monkeypatch.setattr(commands, 'TypeEventCb', Event)
    await db.User.create(id=-1000000001001, state=50)
    await db.Sub.filter(user_id=-1001).update(user_id=-1000000001001)
    event.chat_id = -1000000001001
    event.is_private = True
    event.chat = SimpleNamespace(id=1)
    await commands.cmd_list_or_callback_get_list_page.__wrapped__(event, lang='zh-Hans')
    assert_safe(event.edit.call_args.args[0])
    assert any(b.data == b'get_list_page|1%+1001' for b in event.edit.call_args.kwargs['buttons'])
    await db.Sub.filter(user_id=event.chat_id).delete()
    await commands.cmd_list_or_callback_get_list_page.__wrapped__(event, lang='zh-Hans')
    assert event.edit.call_args.args == (i18n['zh-Hans']['no_subscription'],)
    assert event.edit.call_args.kwargs['buttons'] is None
    assert await get_list_page(-1001, 1, '列表') == (0, 0, '', 0)


@pytest.mark.parametrize('web_enabled', ['0', '1'])
async def test_upstream_subscription_format_scheduler_roundtrip(context, monkeypatch, web_enabled):
    monkeypatch.setenv('WEB_ENABLED', web_enabled)
    if web_enabled == '0':
        # Disabled lifecycle must not open any store or bind any port.
        monkeypatch.setattr(server, 'Store', lambda *a: pytest.fail('disabled Web opened store'))
        await server.start()
    # Enabled case already has a real create_app in context, with an offline gateway.
    result = await inner.sub.sub(2, context.feed.link, lang='en')
    created = result['sub']
    assert created is not None
    assert await db.Feed.all().count() == 1  # shared source, no extra fetch
    await inner.customization.set_sub_title(created, 'Custom & 中文')
    await inner.customization.set_exhaustive_option(created, 'send_mode')
    await inner.customization.set_interval(created, 7)
    assert db.EffectiveTasks.get_interval(context.feed.id) == 7
    exported = await inner.sub.export_opml(2)
    assert b'Custom &amp;' in exported
    repeat = await inner.sub.sub(2, context.feed.link, lang='en')
    assert repeat['sub'].id == created.id
    # Upstream /sub re-subscription resets the custom title; preserve this behavior.
    assert (await db.Sub.get(id=created.id)).title is None
    await inner.sub.unsubs(2, sub_ids=[created.id], lang='en')
    assert not await db.Sub.filter(id=created.id).exists()
    assert await db.Sub.filter(feed_id=context.feed.id).count() == 2
    assert db.EffectiveTasks.get_interval(context.feed.id) == 10


@pytest.mark.parametrize('web_enabled', ['0', '1'])
@pytest.mark.parametrize('state,allowed', [(1, True), (-1, False)])
async def test_real_gatekeeper_respects_ban(context, monkeypatch, web_enabled, state, allowed):
    monkeypatch.setenv('WEB_ENABLED', web_enabled)
    await db.User.filter(id=2).update(state=state)
    event = SimpleNamespace(chat_id=2, sender_id=2, raw_text='/list', is_private=True,
                            is_group=False, is_channel=False, pattern_match=None,
                            get_sender=AsyncMock(return_value=User(id=2, first_name='Synthetic', lang_code='en')),
                            respond=AsyncMock())
    called = AsyncMock()
    guarded = command_gatekeeper(called)
    with pytest.raises(events.StopPropagation):
        await guarded(event)
    assert bool(called.await_count) is allowed
    assert bool(event.respond.await_count) is not allowed


def test_oversized_single_title_is_shortened_without_broken_surrogate():
    markup, units, _ = render_entry('😀' * 9000, 'https://example.test/rss')
    text, entities = assert_safe(markup)
    assert text.endswith('…') and units <= 1024
    assert len(entities) == 1


async def test_exact_text_boundary(context):
    await db.Sub.filter(user_id=-1001).delete()
    # 2-unit heading + newline + four 990-unit titles + three newlines = 3966.
    # The remaining 130 units reserve the localized plain-text retry notice.
    await db.Feed.bulk_create([db.Feed(id=100+i, link=f'https://example.test/{i}', title='x' * 990) for i in range(5)])
    await db.Sub.bulk_create([db.Sub(user_id=-1001, feed_id=100+i) for i in range(5)])
    first = await get_list_page(-1001, 1, 'h' * 2)
    assert first[:2] == (1, 2)
    assert utf16_length(assert_safe(first[2])[0]) == 3966
    smaller = await get_list_page(-1001, 1, 'h' * 3)
    assert len(assert_safe(smaller[2])[1]) == 4  # heading and only three entries


def test_blank_title_uses_url():
    markup, _, _ = render_entry(' \n ', 'https://example.test/rss')
    assert assert_safe(markup)[0] == 'https://example.test/rss'


@pytest.mark.parametrize('suffix', ['x' * 1100, '😀&"' * 150])
async def test_short_titles_dense_long_urls_are_all_paginated(context, suffix):
    from src.command.list_page import PAGE_ENTITY_BYTES_LIMIT, PAGE_URL_BYTES_LIMIT, ENTITY_VECTOR_BYTES
    await db.Sub.filter(user_id=-1001).delete()
    feeds = [db.Feed(id=100+i, link=f'https://example.test/{i}?q={suffix}', title=f'T{i}') for i in range(170)]
    await db.Feed.bulk_create(feeds)
    await db.Sub.bulk_create([db.Sub(user_id=-1001, feed_id=f.id) for f in feeds])
    old = '<b>List</b>\n' + '\n'.join(render_entry(f.title, f.link)[0] for f in feeds[:99])
    old_text, old_entities = html.parse(old)
    assert utf16_length(old_text) < 4096 and len(old_entities) == 100
    assert sum(len(bytes(e)) for e in old_entities) > PAGE_ENTITY_BYTES_LIMIT
    first = await get_list_page(-1001, 1, 'List')
    assert first[1] > 2
    urls = []
    for number in range(1, first[1] + 1):
        actual, count, markup, total = await get_list_page(-1001, number, 'List')
        assert (actual, count, total) == (number, first[1], 170)
        _, entities = assert_safe(markup)
        page_urls = [e.url for e in entities if isinstance(e, MessageEntityTextUrl)]
        assert sum(len(u.encode('utf-8')) for u in page_urls) <= PAGE_URL_BYTES_LIMIT
        assert ENTITY_VECTOR_BYTES + sum(len(bytes(e)) for e in entities) <= PAGE_ENTITY_BYTES_LIMIT
        urls.extend(page_urls)
    assert urls == [f.link for f in reversed(feeds)]


@pytest.mark.parametrize('is_callback', [False, True])
async def test_entities_rejection_retries_same_page_once_and_continues(context, monkeypatch, is_callback):
    from telethon.errors import EntitiesTooLongError
    await db.Sub.filter(user_id=-1001).delete()
    feeds = [db.Feed(id=100+i, link=f'https://example.test/{i}?q=' + 'x'*1100, title=f'T{i}') for i in range(7)]
    await db.Feed.bulk_create(feeds)
    await db.Sub.bulk_create([db.Sub(user_id=-1001, feed_id=f.id) for f in feeds])
    pages = (await get_list_page(-1001, 1, i18n['en']['subscription_list']))[1]
    titles = []
    for number in range(1, pages + 1):
        event = Event()
        event.data = f'get_list_page|{number}'.encode()
        callback = is_callback or number > 1
        monkeypatch.setattr(commands, 'TypeEventCb', Event if callback else type('Other', (), {}))
        send = event.edit if callback else event.respond
        send.side_effect = [EntitiesTooLongError(None), None]
        await commands.cmd_list_or_callback_get_list_page.__wrapped__(event, lang='en')
        assert send.await_count == 2
        normal, fallback = send.call_args_list
        parsed, _ = html.parse(normal.args[0])
        assert fallback.args[0] == parsed + '\n\n' + i18n['en']['subscription_list_plain_fallback']
        assert utf16_length(fallback.args[0]) <= 4096
        assert fallback.kwargs['parse_mode'] is None
        assert fallback.kwargs['formatting_entities'] == []
        assert fallback.kwargs['buttons'] == normal.kwargs['buttons']
        titles.extend(parsed.splitlines()[1:])
        if number > 1:
            assert any(b.data == f'get_list_page|{number-1}'.encode() for b in fallback.kwargs['buttons'])
        if number < pages:
            assert any(b.data == f'get_list_page|{number+1}'.encode() for b in fallback.kwargs['buttons'])
    assert titles == [f.title for f in reversed(feeds)]
    # Follow a previous-page callback after repeated server rejections.
    previous = Event()
    previous.data = f'get_list_page|{pages-1}'.encode()
    previous.edit.side_effect = [EntitiesTooLongError(None), None]
    await commands.cmd_list_or_callback_get_list_page.__wrapped__(previous, lang='en')
    expected = await get_list_page(-1001, pages-1, i18n['en']['subscription_list'])
    assert previous.edit.call_args.args[0] == html.parse(expected[2])[0] + '\n\n' + i18n['en']['subscription_list_plain_fallback']
    assert previous.edit.await_count == 2


@pytest.mark.parametrize('first_error', ['entities', 'message', 'permission'])
async def test_list_fallback_is_bounded_and_does_not_swallow_other_errors(context, first_error):
    from telethon.errors import EntitiesTooLongError, MessageTooLongError, ChatWriteForbiddenError
    error = {'entities': EntitiesTooLongError, 'message': MessageTooLongError,
             'permission': ChatWriteForbiddenError}[first_error]
    event = Event()
    event.respond.side_effect = error(None)
    with pytest.raises(error):
        await commands.cmd_list_or_callback_get_list_page.__wrapped__(event, lang='en')
    assert event.respond.await_count == (2 if first_error == 'entities' else 1)


@pytest.mark.parametrize('lang', ['en', 'zh-Hans', 'zh-Hant', 'de'])
async def test_fallback_notice_fits_full_page_and_locale_fallback(context, lang):
    from telethon.errors import EntitiesTooLongError
    from src.command.list_page import PAGE_TEXT_LIMIT, FALLBACK_NOTICE_LIMIT
    from src.i18n import ALL_LANGUAGES
    for locale in ALL_LANGUAGES:
        assert utf16_length(i18n[locale]['subscription_list_plain_fallback']) <= FALLBACK_NOTICE_LIMIT
    # Inject an exactly full safe page to exercise notice addition, not just short titles.
    from unittest.mock import patch
    event = Event()
    event.respond.side_effect = [EntitiesTooLongError(None), None]
    with patch.object(commands, 'get_list_page', AsyncMock(return_value=(1, 1, 'x' * PAGE_TEXT_LIMIT, 1))):
        await commands.cmd_list_or_callback_get_list_page.__wrapped__(event, lang=lang)
    fallback = event.respond.call_args.args[0]
    assert fallback.startswith('x' * PAGE_TEXT_LIMIT + '\n\n')
    assert fallback.endswith(i18n[lang]['subscription_list_plain_fallback'])
    assert utf16_length(fallback) <= 4096


async def test_tl_overhead_can_split_before_url_budget(context):
    from src.command.list_page import PAGE_ENTITY_BYTES_LIMIT, PAGE_URL_BYTES_LIMIT, ENTITY_VECTOR_BYTES
    await db.Sub.filter(user_id=-1001).delete()
    feeds = [db.Feed(id=100+i, link=f'https://e.test/{i:03d}'.ljust(30, 'x'), title='T') for i in range(99)]
    await db.Feed.bulk_create(feeds)
    await db.Sub.bulk_create([db.Sub(user_id=-1001, feed_id=f.id) for f in feeds])
    assert sum(len(f.link.encode()) for f in feeds) <= PAGE_URL_BYTES_LIMIT
    result = await get_list_page(-1001, 1, 'List')
    assert result[:2] == (1, 2)
    _, entities = assert_safe(result[2])
    assert len(entities) == 93  # heading + 92 links; TL overhead, not URL sum, is the boundary
    additional = MessageEntityTextUrl(0, 1, feeds[0].link)
    assert ENTITY_VECTOR_BYTES + sum(len(bytes(e)) for e in entities) + len(bytes(additional)) > PAGE_ENTITY_BYTES_LIMIT
