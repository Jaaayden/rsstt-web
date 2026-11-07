import time
from datetime import datetime, timezone
from itertools import islice
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from feedparser import FeedParserDict

from src import web
from src.command import inner
from src.management import articles
from src.monitor._monitor import Monitor
from src.monitor._notifier import Notifier

calculate_update = inner.utils.calculate_update
entry_hash_limit = inner.utils.entry_hash_limit


@pytest.fixture(autouse=True)
def no_global_state(monkeypatch):
    monkeypatch.setattr(articles, '_active', None)
    monkeypatch.setattr(Monitor, '_singleton', None)


def entries(guids):
    return [FeedParserDict(guid=guid, title=guid, summary=f'<p>{guid}</p>', link=f'https://example.invalid/{guid}')
            for guid in guids]


def fetched(feed, items):
    return SimpleNamespace(status=200, url=feed.link, error=None,
        rss_d=FeedParserDict(feed=FeedParserDict(title='Example'), entries=items),
        web_response=SimpleNamespace(etag=None, last_modified=None),
        calc_next_check_as_per_server_side_cache=lambda: None)


def old_limit(entry_count):
    return max(entry_count * 2, 100)


def test_the_limit_follows_the_size_of_the_feed():
    assert [entry_hash_limit(count) for count in (0, 1, 3)] == [100, 100, 100]
    assert entry_hash_limit(4) == 120 and entry_hash_limit(20) == 600
    assert entry_hash_limit(300) == 9000
    assert entry_hash_limit(10_000) == inner.utils.ENTRY_HASH_LIMIT_MAX == 20_000
    assert all(entry_hash_limit(count) >= old_limit(count) for count in range(0, 400)), 'never remembers less than before'
    assert all(entry_hash_limit(count) <= entry_hash_limit(count + 1) for count in range(0, 1000))


def test_calculate_update_keeps_current_entries_first_and_reports_only_new_ones():
    seen = list(calculate_update(None, entries(['a', 'b']))[0])
    new_hashes, updated = calculate_update(seen, entries(['c', 'b']))
    c, b = (list(calculate_update(None, entries([guid]))[0])[0] for guid in 'cb')
    a = seen[0]
    assert list(new_hashes) == [c, b, a], 'the entries of this fetch come first, then the ones that left the feed'
    assert [entry.guid for entry in updated] == ['c']
    assert [entry.guid for entry in calculate_update(seen, entries(['a', 'b']))[1]] == []


def replay(limit, departed=3000, churn=30):
    """A 300-entry feed that swaps `churn` entries per fetch. One entry leaves, `departed` others pass through, then it returns."""
    window = ['returning'] + [f'g{index}' for index in range(1, 300)]
    hashes = list(calculate_update(None, entries(window))[0])
    fresh = 300
    for _ in range(departed // churn):
        window = window[churn:] + [f'g{fresh + index}' for index in range(churn)]
        fresh += churn
        hashes = list(islice(calculate_update(hashes, entries(window))[0], limit(len(window))))
    window = window[1:] + ['returning']
    return [entry.guid for entry in calculate_update(hashes, entries(window))[1]]


def test_an_entry_that_comes_back_after_thousands_of_others_is_not_new_again():
    assert replay(old_limit) == ['returning'], 'the previous window (twice the entries) had forgotten it'
    assert replay(entry_hash_limit) == []
    assert replay(entry_hash_limit, departed=12_000) == ['returning'], 'a window is still finite'


def test_a_full_window_is_cheap_to_process():
    old = [format(index * 2654435761 % 2**32, 'x') for index in range(9000)]
    items = entries(f'new-{index}' for index in range(300))
    timings = []
    for _ in range(20):
        started = time.perf_counter()
        new_hashes, updated = calculate_update(old, items)
        kept = list(islice(new_hashes, entry_hash_limit(len(items))))
        timings.append(time.perf_counter() - started)
    assert len(updated := list(updated)) == 300 and len(kept) == 9000
    # about a millisecond or two; the bound only catches an accidental quadratic step
    assert min(timings) < 0.1


async def test_a_fetch_keeps_the_scaled_window(context, monkeypatch):
    items = entries(f'article-{index}' for index in range(300))
    old = [f'left-{index}' for index in range(5000)]
    context.feed.entry_hashes = old
    await context.feed.save()
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=fetched(context.feed, items)))
    monkeypatch.setattr(articles, '_active', context.store.articles)
    monkeypatch.setattr(Notifier, 'notify_all', AsyncMock())
    await Monitor()._do_monitor_a_feed(context.feed, datetime.now(timezone.utc))
    await context.feed.refresh_from_db()
    current = list(calculate_update(None, items)[0])
    assert len(context.feed.entry_hashes) == 5300, 'the 300 current entries and all 5000 that had left (the old limit stopped at 600)'
    assert context.feed.entry_hashes[:300] == current and context.feed.entry_hashes[300:] == old


async def test_a_feed_without_news_does_not_rewrite_its_hashes(context, monkeypatch):
    items = entries(f'article-{index}' for index in range(50))
    hashes = list(calculate_update(None, items)[0]) + [f'left-{index}' for index in range(1000)]
    context.feed.entry_hashes = hashes
    await context.feed.save()
    monkeypatch.setattr(web, 'feed_get', AsyncMock(return_value=fetched(context.feed, items)))
    monkeypatch.setattr(articles, '_active', context.store.articles)
    notify = AsyncMock()
    monkeypatch.setattr(Notifier, 'notify_all', notify)
    saves = []
    original = type(context.feed).save

    async def save(self, *args, **kwargs):
        saves.append(kwargs.get('update_fields'))
        return await original(self, *args, **kwargs)

    monkeypatch.setattr(type(context.feed), 'save', save)
    await Monitor()._do_monitor_a_feed(context.feed, datetime.now(timezone.utc))
    await context.feed.refresh_from_db()
    assert context.feed.entry_hashes == hashes
    assert not any(fields is None or 'entry_hashes' in fields for fields in saves)
    notify.assert_not_awaited()
