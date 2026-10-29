"""Bounded recent article previews and destination-specific delivery evidence.

This disposable cache is independent of RSStT's update hashes. It stores no raw
entries, performs no requests, and is cleared whenever a backup is restored.
"""
import asyncio
import calendar
import contextlib
import hashlib
import logging
import re
import time
from collections import OrderedDict
from collections.abc import Mapping
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from itertools import islice
from urllib.parse import urlsplit

from .diagnostics import ident, text as diagnostic_text

LOGGER = logging.getLogger('RSStT.management.articles')
RETENTION = dict(per_feed=20, max_entries=10000)
MAX_DELIVERIES = 50000
MAX_PENDING_ARTICLES = 1024
MAX_PENDING_DELIVERIES = 4096
STATUSES = ('queued', 'sent', 'failed', 'unconfirmed')
SOURCES = ('scheduled', 'manual', 'test', 'demo')
_active = None


class _PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.blocked = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'iframe', 'object', 'svg', 'math', 'template', 'noscript'):
            self.blocked.append(tag)
        elif not self.blocked and tag in ('p', 'br', 'div', 'li', 'h1', 'h2', 'h3', 'tr'):
            self.parts.append(' ')

    def handle_endtag(self, tag):
        if self.blocked and tag == self.blocked[-1]:
            self.blocked.pop()
        elif not self.blocked:
            self.parts.append(' ')

    def handle_data(self, data):
        if not self.blocked:
            self.parts.append(data)


def plain(value, limit):
    if not isinstance(value, str):
        return ''
    parser = _PlainText()
    parser.feed(value[:32768])
    parser.close()
    return re.sub(r'\s+', ' ', ''.join(parser.parts)).strip()[:limit]


def safe_link(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 4096 or any(char.isspace() or ord(char) < 32 for char in value) or '\\' in value:
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme.lower() not in ('http', 'https') or not parsed.hostname or parsed.username is not None or parsed.password is not None:
            return None
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            return None
        return value
    except ValueError:
        return None


def _content(entry):
    contents = entry.get('content')
    if isinstance(contents, (list, tuple)):
        for content in islice(contents, 20):
            if isinstance(content, Mapping) and isinstance(content.get('value'), str) and content['value']:
                return content['value']
    return ''


def article_key(entry):
    if not isinstance(entry, Mapping):
        return None
    for field in ('guid', 'id', 'link', 'title', 'summary'):
        value = entry.get(field)
        if isinstance(value, str) and value:
            return hashlib.sha256(value.encode()).hexdigest()
    value = _content(entry)
    return hashlib.sha256(value.encode()).hexdigest() if value else None


def _published(entry):
    for field in ('published_parsed', 'updated_parsed'):
        value = entry.get(field)
        if isinstance(value, (tuple, list)) and len(value) >= 9:
            try:
                return datetime.fromtimestamp(calendar.timegm(value[:9]), timezone.utc).isoformat()
            except (ValueError, TypeError, OverflowError):
                pass
    for field in ('published', 'updated'):
        value = entry.get(field)
        if not isinstance(value, str) or len(value) > 200:
            continue
        try:
            try:
                parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
            except ValueError:
                parsed = parsedate_to_datetime(value)
            if parsed.tzinfo:
                return parsed.astimezone(timezone.utc).isoformat()
        except (ValueError, TypeError, OverflowError, AttributeError):
            pass
    return None


def _article(feed_id, entry, *, observed=0, at=None):
    key = article_key(entry)
    if key is None:
        return None
    content = entry.get('summary') or entry.get('description') or _content(entry)
    return (feed_id, key, plain(entry.get('title'), 500), safe_link(entry.get('link')),
            plain(content, 2000), _published(entry), at or datetime.now(timezone.utc).isoformat(), observed)


async def initialize(store):
    if getattr(store, 'articles', None) is not None:
        return store.articles
    await store.db.executescript('''
        CREATE TABLE IF NOT EXISTS article_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT, feed_id TEXT NOT NULL,
            entry_key TEXT NOT NULL, title TEXT NOT NULL, link TEXT,
            summary TEXT NOT NULL, published_at TEXT, fetched_at TEXT NOT NULL,
            observed INTEGER NOT NULL, UNIQUE(feed_id,entry_key)
        );
        CREATE INDEX IF NOT EXISTS article_cache_recent ON article_cache(feed_id,observed DESC,id DESC);
        CREATE INDEX IF NOT EXISTS article_cache_global ON article_cache(observed DESC,id DESC);
        CREATE TABLE IF NOT EXISTS article_deliveries (
            feed_id TEXT NOT NULL, entry_key TEXT NOT NULL, target_id TEXT NOT NULL,
            status TEXT NOT NULL, detail TEXT NOT NULL, source TEXT NOT NULL,
            last_attempt_at TEXT NOT NULL, last_sent_at TEXT,
            PRIMARY KEY(feed_id,entry_key,target_id)
        );
        CREATE INDEX IF NOT EXISTS article_deliveries_recent ON article_deliveries(last_attempt_at DESC);
    ''')
    await store.db.execute("UPDATE article_deliveries SET status='unconfirmed', detail=? WHERE status='queued'",
                           ('实例重启中断了上次推送，无法确认是否送达。',))
    await store.db.execute('INSERT OR IGNORE INTO meta VALUES (?,?)',
                           ('articles_started_at', datetime.now(timezone.utc).isoformat()))
    await store.db.commit()
    store.articles = Journal(store)
    return store.articles


def current():
    return _active


def install(store):
    global _active
    _active = getattr(store, 'articles', None)


def uninstall(store=None):
    global _active
    if store is None or (_active is not None and _active.store is store):
        _active = None


async def capture(feed_id, entries):
    return await _active.capture(feed_id, entries) if _active is not None else False


async def mark(feed_id, entry, target_id, status, detail='', source='scheduled'):
    return await _active.mark(feed_id, entry, target_id, status, detail, source) if _active is not None else False


class Journal:
    def __init__(self, store):
        self.store = store
        self.pending_articles = OrderedDict()
        self.pending_deliveries = OrderedDict()
        self.known = OrderedDict()
        self.wakeup = asyncio.Event()
        self.lock = asyncio.Lock()
        self.closed = False
        self.degraded = False
        self.dropped = 0
        self.task = asyncio.create_task(self._run())
        self._close_task = None

    def _remember(self, identity):
        self.known[identity] = None
        self.known.move_to_end(identity)
        while len(self.known) > RETENTION['max_entries']:
            self.known.popitem(last=False)

    def _queue_article(self, article):
        identity = article[:2]
        old = self.pending_articles.get(identity)
        # Delivery bookkeeping must never overwrite a freshly fetched preview.
        if old is None or article[-1] > 0:
            self.pending_articles[identity] = article
            self.pending_articles.move_to_end(identity)
        if len(self.pending_articles) > MAX_PENDING_ARTICLES:
            self.pending_articles.popitem(last=False)
            self.dropped += 1
        self._remember(identity)

    async def capture(self, feed_id, entries):
        try:
            feed_id = ident(feed_id)
            if self.closed or feed_id is None:
                return False
            at = datetime.now(timezone.utc).isoformat()
            observed = time.time_ns()
            for index, entry in enumerate(islice(entries, RETENTION['per_feed'])):
                article = _article(feed_id, entry, observed=observed - index, at=at)
                if article:
                    self._queue_article(article)
            self.wakeup.set()
            return True
        except Exception:
            self.degraded = True
            self.dropped += 1
            return False

    async def mark(self, feed_id, entry, target_id, status, detail='', source='scheduled'):
        try:
            feed_id, target_id, key = ident(feed_id), ident(target_id), article_key(entry)
            if self.closed or feed_id is None or target_id is None or key is None or status not in STATUSES:
                return False
            identity = (feed_id, key)
            if identity not in self.known:
                self._queue_article(_article(feed_id, entry))
            identity = (feed_id, key, target_id)
            at = datetime.now(timezone.utc).isoformat()
            previous = self.pending_deliveries.get(identity)
            sent_at = at if status == 'sent' else previous[-1] if previous else None
            self.pending_deliveries[identity] = (*identity, status, diagnostic_text(detail),
                                                 source if source in SOURCES else 'scheduled', at, sent_at)
            self.pending_deliveries.move_to_end(identity)
            if len(self.pending_deliveries) > MAX_PENDING_DELIVERIES:
                self.pending_deliveries.popitem(last=False)
                self.dropped += 1
            self.wakeup.set()
            return True
        except Exception:
            self.degraded = True
            self.dropped += 1
            return False

    async def _run(self):
        while True:
            await self.wakeup.wait()
            await asyncio.sleep(0.05)
            await self.flush()

    async def flush(self):
        async with self.lock:
            if not self.pending_articles and not self.pending_deliveries:
                self.wakeup.clear()
                return
            articles = list(self.pending_articles.values())
            deliveries = list(self.pending_deliveries.values())
            self.pending_articles.clear()
            self.pending_deliveries.clear()
            self.wakeup.clear()
            try:
                async with self.store.lock:
                    try:
                        await self.store.db.executemany('''
                            INSERT INTO article_cache(feed_id,entry_key,title,link,summary,published_at,fetched_at,observed)
                            VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(feed_id,entry_key) DO UPDATE SET
                            title=CASE WHEN excluded.observed>0 THEN excluded.title ELSE article_cache.title END,
                            link=CASE WHEN excluded.observed>0 THEN excluded.link ELSE article_cache.link END,
                            summary=CASE WHEN excluded.observed>0 THEN excluded.summary ELSE article_cache.summary END,
                            published_at=CASE WHEN excluded.observed>0 THEN excluded.published_at ELSE article_cache.published_at END,
                            fetched_at=CASE WHEN excluded.observed>0 THEN excluded.fetched_at ELSE article_cache.fetched_at END,
                            observed=MAX(article_cache.observed,excluded.observed)
                        ''', articles)
                        await self.store.db.executemany('''
                            INSERT INTO article_deliveries(feed_id,entry_key,target_id,status,detail,source,last_attempt_at,last_sent_at)
                            SELECT ?,?,?,?,?,?,?,? WHERE EXISTS
                            (SELECT 1 FROM article_cache WHERE feed_id=? AND entry_key=?)
                            ON CONFLICT(feed_id,entry_key,target_id) DO UPDATE SET
                            status=excluded.status,detail=excluded.detail,source=excluded.source,
                            last_attempt_at=excluded.last_attempt_at,
                            last_sent_at=COALESCE(excluded.last_sent_at,article_deliveries.last_sent_at)
                        ''', [(*row, row[0], row[1]) for row in deliveries])
                        for feed in {row[0] for row in articles}:
                            await self.store.db.execute('DELETE FROM article_cache WHERE feed_id=? AND id NOT IN '
                                                        '(SELECT id FROM article_cache WHERE feed_id=? ORDER BY observed DESC,id DESC LIMIT ?)',
                                                        (feed, feed, RETENTION['per_feed']))
                        await self.store.db.execute('DELETE FROM article_cache WHERE id NOT IN '
                                                    '(SELECT id FROM article_cache ORDER BY observed DESC,id DESC LIMIT ?)',
                                                    (RETENTION['max_entries'],))
                        await self.store.db.execute('DELETE FROM article_deliveries WHERE NOT EXISTS '
                                                    '(SELECT 1 FROM article_cache a WHERE a.feed_id=article_deliveries.feed_id AND a.entry_key=article_deliveries.entry_key)')
                        await self.store.db.execute('DELETE FROM article_deliveries WHERE rowid NOT IN '
                                                    '(SELECT rowid FROM article_deliveries ORDER BY last_attempt_at DESC,rowid DESC LIMIT ?)',
                                                    (MAX_DELIVERIES,))
                        await self.store.db.commit()
                    except BaseException:
                        await self.store.db.rollback()
                        raise
                self.degraded = False
            except asyncio.CancelledError:
                self.dropped += len(articles) + len(deliveries)
                raise
            except Exception:
                self.degraded = True
                self.dropped += len(articles) + len(deliveries)
                LOGGER.warning('Recent article cache storage failed; recent delivery evidence may be incomplete')

    async def history(self, feed_id, target_id):
        feed_id, target_id = ident(feed_id), ident(target_id)
        await self.flush()
        rows = await self.store.rows('''
            SELECT a.entry_key AS id,a.title,a.link,a.summary,a.published_at,a.fetched_at,
            CASE WHEN d.last_sent_at IS NOT NULL THEN 'sent' ELSE COALESCE(d.status,'not_recorded') END AS status,
            COALESCE(d.detail,'') AS detail,d.last_attempt_at,d.last_sent_at,
            d.status AS last_attempt_status,d.source
            FROM article_cache a LEFT JOIN article_deliveries d
            ON a.feed_id=d.feed_id AND a.entry_key=d.entry_key AND d.target_id=?
            WHERE a.feed_id=? ORDER BY a.observed DESC,a.id DESC LIMIT ?
        ''', (target_id, feed_id, RETENTION['per_feed']))
        for row in rows:
            row['title'] = plain(row['title'], 500)
            row['summary'] = plain(row['summary'], 2000)
            row['link'] = safe_link(row['link'])
            row['detail'] = diagnostic_text(row['detail'])
        settings = await self.store.settings()
        return dict(items=rows, retention=RETENTION.copy(), degraded=self.degraded, dropped=self.dropped,
                    pending=len(self.pending_articles) + len(self.pending_deliveries), started_at=settings.get('articles_started_at'))

    async def close(self):
        if self._close_task is None:
            self.closed = True
            self._close_task = asyncio.create_task(self._finish_close())
        await asyncio.shield(self._close_task)

    async def _finish_close(self):
        await self.flush()
        self.task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self.task


def routes(routes, service, admin):
    from aiohttp import web

    @routes.get('/api/subscriptions/{id}/articles')
    async def subscription_articles(request):
        admin(request)
        sub = await service.subscription(request.match_info['id'], request['principal'])
        result = await service.store.articles.history(sub.feed_id, sub.user_id)
        target = (await service.store.target_map([sub.user_id])).get(str(sub.user_id), {})
        result.update(feed=dict(id=str(sub.feed_id), title=sub.feed.title), subscription_id=str(sub.id),
                      target=dict(id=str(sub.user_id), title=target.get('title') or str(sub.user_id)))
        return web.json_response(result)
