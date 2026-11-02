"""Bounded, redacted operational history; business hooks never wait for SQLite."""
import asyncio
import contextlib
import hashlib
import json
import logging
import re
from collections import deque
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

LOGGER = logging.getLogger('RSStT.management.diagnostics')
CATEGORIES = ('fetch', 'delivery', 'notification', 'system')
LEVELS = ('info', 'warning', 'error')
RETENTION = dict(days=30, max_entries=5000, per_feed=100)
# The run log keeps every check, but consecutive identical results share one row (first and last time, how many
# times), so hours of "5 posts, 0 new" cost a single line. Kept apart from events so it cannot push out failures.
RUN_RETENTION = dict(days=30, per_feed=20)  # per_feed is the default; the console setting `fetch_run_rows` overrides it
RUN_ROWS_RANGE = (5, 200)
RUN_STATUSES = ('updated', 'unchanged', 'not_modified', 'empty', 'failed', 'exception')
MAX_PENDING = 256
MAX_PENDING_RUNS = 2048
_active = None
_URL = re.compile(r'(?:https?|ftp)://[^\s<>\"\']+', re.I)
_HEADER = re.compile(r'(?im)\b(authorization|proxy-authorization|cookie|set-cookie)\b[\"\']?\s*[:=][^\n]*')
_SENSITIVE = re.compile(
    r'(?i)\b(authorization|proxy-authorization|cookie|set-cookie|password|passwd|token|api[_-]?key|secret|session(?:[_-]?id)?|hash|salt)'
    r'\b[\"\']?\s*[:=]\s*[\"\']?(?:bearer\s+|basic\s+)?[^\s,;\"\'<>]+')
_TOKEN = re.compile(r'\b(?:r(?:st|ss)_[A-Za-z0-9_-]+|\d{5,20}:[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{40,})\b')
_IDENT = re.compile(r'-?\d{1,20}\Z')
_SYMBOL = re.compile(r'[A-Za-z0-9_.: /{}-]{1,120}\Z')
_CONTEXT = frozenset(('http_status', 'duration_ms', 'failures', 'next_retry_at', 'source_host',
                      'exception_type', 'attempt', 'channel', 'new_entries', 'stage', 'status', 'next_check_at',
                      'method', 'route', 'previous_failures', 'retry_after_seconds'))


def text(value, limit=2000):
    """Keep diagnostic prose, but never retain credential-bearing request URLs."""
    if value is None:
        return ''
    value = str(value)[:8192]

    def host(match):
        try:
            parsed = urlsplit(match.group())
            name = parsed.hostname or '[redacted]'
            return f'{parsed.scheme}://{name}/[redacted]'
        except ValueError:
            return '[redacted URL]'

    value = _URL.sub(host, value)
    value = _HEADER.sub(lambda match: match.group(1) + '=[redacted]', value)
    value = _SENSITIVE.sub(lambda match: match.group(1) + '=[redacted]', value)
    value = _TOKEN.sub('[redacted]', value)
    value = ''.join(char for char in value if char in '\n\t' or ord(char) >= 32)
    return value.encode('utf-8')[:limit].decode('utf-8', errors='ignore')


def ident(value):
    result = str(value) if value is not None else ''
    return result if _IDENT.fullmatch(result) and -(2 ** 63) <= int(result) < 2 ** 63 else None


def _context(values):
    result = {}
    if not isinstance(values, dict):
        return result
    for key in sorted(_CONTEXT & values.keys()):
        value = values[key]
        if value is None:
            continue
        if key in ('http_status', 'duration_ms', 'failures', 'attempt', 'new_entries', 'previous_failures', 'retry_after_seconds'):
            if type(value) in (int, float) and 0 <= value <= 10 ** 12:
                result[key] = int(value)
        elif key in ('next_retry_at', 'next_check_at'):
            try:
                date = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace('Z', '+00:00'))
                if date.tzinfo:
                    result[key] = date.astimezone(timezone.utc).isoformat()
            except (ValueError, TypeError, OverflowError):
                pass
        elif key == 'source_host':
            try:
                host = urlsplit(str(value) if '://' in str(value) else 'https://' + str(value)).hostname
                if host and re.fullmatch(r'[A-Za-z0-9.:[\]-]{1,253}', host):
                    result[key] = host
            except ValueError:
                pass
        elif isinstance(value, str) and _SYMBOL.fullmatch(value):
            result[key] = text(value, 120)
    return result


def _entry(category, level, code, message, *, detail='', feed_id=None, target_id=None, context=None):
    if category not in CATEGORIES or level not in LEVELS or not isinstance(code, str) or not re.fullmatch(r'[a-z][a-z0-9_.]{0,79}', code):
        return None
    return (datetime.now(timezone.utc).isoformat(), category, level, code, text(message, 400),
            text(detail), ident(feed_id), ident(target_id), json.dumps(_context(context), ensure_ascii=False, allow_nan=False))


def restored_rows(columns, rows):
    """Treat imported log text as untrusted, including otherwise valid backups."""
    sanitized = []
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=RETENTION['days'])
    for row in rows:
        source = dict(zip(columns, row))
        at = datetime.fromisoformat(source['at'])
        if not at.tzinfo or at > now + timedelta(days=1):
            raise ValueError('Invalid diagnostic timestamp')
        context = json.loads(source['context'])
        if not isinstance(context, dict) or type(source['id']) is not int or source['id'] < 1:
            raise ValueError('Invalid diagnostic event')
        entry = _entry(source['category'], source['level'], source['code'], source['message'],
                       detail=source['detail'], feed_id=source['feed_id'], target_id=source['target_id'], context=context)
        if entry is None:
            raise ValueError('Invalid diagnostic event')
        if at >= cutoff:
            sanitized.append((source['id'], at.astimezone(timezone.utc).isoformat(), *entry[1:]))
    selected, per_feed = [], {}
    for row in sorted(sanitized, key=lambda item: item[0], reverse=True):
        feed_id = row[7]
        if feed_id is not None:
            if per_feed.get(feed_id, 0) >= RETENTION['per_feed']:
                continue
            per_feed[feed_id] = per_feed.get(feed_id, 0) + 1
        selected.append(row)
        if len(selected) >= RETENTION['max_entries']:
            break
    return list(reversed(selected))


async def initialize(store):
    if getattr(store, 'diagnostics', None) is not None:
        return store.diagnostics
    await store.db.executescript('''
        CREATE TABLE IF NOT EXISTS diagnostic_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
            category TEXT NOT NULL, level TEXT NOT NULL, code TEXT NOT NULL,
            message TEXT NOT NULL, detail TEXT NOT NULL, feed_id TEXT,
            target_id TEXT, context TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS diagnostic_events_feed ON diagnostic_events(feed_id,id DESC);
        CREATE INDEX IF NOT EXISTS diagnostic_events_target ON diagnostic_events(target_id,id DESC);
        CREATE INDEX IF NOT EXISTS diagnostic_events_category ON diagnostic_events(category,level,id DESC);
        CREATE INDEX IF NOT EXISTS diagnostic_events_at ON diagnostic_events(at);
        CREATE TABLE IF NOT EXISTS fetch_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, last_at TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1,
            feed_id TEXT NOT NULL, status TEXT NOT NULL, http_status INTEGER, entries INTEGER,
            new_entries INTEGER NOT NULL DEFAULT 0, manual INTEGER NOT NULL DEFAULT 0, detail TEXT NOT NULL DEFAULT '',
            ms_min INTEGER NOT NULL DEFAULT 0, ms_max INTEGER NOT NULL DEFAULT 0, ms_sum INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS fetch_runs_feed ON fetch_runs(feed_id,id DESC);
        CREATE INDEX IF NOT EXISTS fetch_runs_at ON fetch_runs(last_at);
    ''')
    await store.db.execute('INSERT OR IGNORE INTO meta VALUES (?,?)',
                           ('diagnostics_started_at', datetime.now(timezone.utc).isoformat()))
    await store.db.commit()
    store.diagnostics = Journal(store)
    try:
        rows = int((await store.settings()).get('fetch_run_rows', ''))
        if RUN_ROWS_RANGE[0] <= rows <= RUN_ROWS_RANGE[1]:
            store.diagnostics.run_rows = rows
    except ValueError:
        pass
    return store.diagnostics


async def observe_restore(store):
    """Report each completed offline restore once when the console next starts."""
    try:
        from .backups import safe_path
        path = safe_path(store.path.parent / '.restore-result.json', exists=False)
        if not path.exists() or path.stat().st_size > 16384:
            return
        raw = path.read_bytes()
        fingerprint = hashlib.sha256(raw).hexdigest()
        if (await store.settings()).get('diagnostics_restore_result') == fingerprint:
            return
        result = json.loads(raw)
        if result.get('status') not in ('succeeded', 'failed'):
            return
        failed = result['status'] == 'failed'
        store.diagnostics.emit('system', 'error' if failed else 'info',
                               'backup.restore_failed' if failed else 'backup.restored',
                               '备份恢复失败；请检查维护日志与回退副本。' if failed else '备份已在启动前恢复。',
                               detail=result.get('error', '') if failed else '',
                               context={'exception_type': result.get('exception_type'), 'stage': 'restore',
                                        'status': result['status']})
        await store.set_setting('diagnostics_restore_result', fingerprint)
    except Exception:
        store.diagnostics.emit('system', 'warning', 'backup.restore_result_unavailable', '无法读取上次备份恢复结果。',
                               context={'stage': 'restore'})


def install(store):
    global _active
    _active = getattr(store, 'diagnostics', None)


def uninstall(store=None):
    global _active
    if store is None or (_active is not None and _active.store is store):
        _active = None


def emit(category, level, code, message, *, detail='', feed_id=None, target_id=None, context=None):
    if _active:
        return _active.emit(category, level, code, message, detail=detail, feed_id=feed_id,
                            target_id=target_id, context=context)
    return False


def run(feed_id, status, *, http_status=None, duration_ms=None, entries=None, new_entries=0, manual=False, detail=''):
    """One line per fetch: when, how long, what came back. Never blocks the monitor."""
    if _active:
        return _active.emit_run(feed_id, status, http_status=http_status, duration_ms=duration_ms, entries=entries,
                                new_entries=new_entries, manual=manual, detail=detail)
    return False


async def record(category, level, code, message, *, detail='', feed_id=None, target_id=None, context=None):
    return emit(category, level, code, message, detail=detail, feed_id=feed_id,
                target_id=target_id, context=context)


class Journal:
    def __init__(self, store):
        self.store = store
        self.pending = deque()
        self.pending_runs = deque(maxlen=MAX_PENDING_RUNS)
        self.run_rows = RUN_RETENTION['per_feed']
        self.wakeup = asyncio.Event()
        self.lock = asyncio.Lock()
        self.closed = False
        self.degraded = False
        self.dropped = 0
        self.task = asyncio.create_task(self._run())

    def emit(self, category, level, code, message, *, detail='', feed_id=None, target_id=None, context=None):
        try:
            if self.closed:
                return False
            entry = _entry(category, level, code, message, detail=detail, feed_id=feed_id,
                           target_id=target_id, context=context)
            if entry is None:
                return False
            if len(self.pending) >= MAX_PENDING:
                self.pending.popleft()
                self.dropped += 1
            self.pending.append(entry)
            self.wakeup.set()
            return True
        except Exception:
            self.degraded = True
            self.dropped += 1
            return False

    def emit_run(self, feed_id, status, *, http_status=None, duration_ms=None, entries=None, new_entries=0,
                 manual=False, detail=''):
        try:
            key = ident(feed_id)
            if self.closed or key is None or status not in RUN_STATUSES:
                return False

            def count(value, upper=10 ** 9):
                return int(value) if type(value) in (int, float) and 0 <= value <= upper else None
            self.pending_runs.append((datetime.now(timezone.utc).isoformat(), key, status,
                                      count(http_status, 599), count(duration_ms, 10 ** 12), count(entries),
                                      count(new_entries) or 0, 1 if manual else 0, text(detail, 300)))
            self.wakeup.set()
            return True
        except Exception:
            self.degraded = True
            self.dropped += 1
            return False

    async def record(self, *args, **kwargs):
        return self.emit(*args, **kwargs)

    async def _run(self):
        while True:
            await self.wakeup.wait()
            # Coalesce concurrent monitor results into one bounded transaction.
            await asyncio.sleep(0.05)
            await self.flush()

    async def flush(self):
        async with self.lock:
            if not self.pending and not self.pending_runs:
                self.wakeup.clear()
                return
            batch = list(self.pending)
            runs = list(self.pending_runs)
            self.pending.clear()
            self.pending_runs.clear()
            self.wakeup.clear()
            try:
                async with self.store.lock:
                    try:
                        if batch:
                            await self.store.db.executemany(
                                'INSERT INTO diagnostic_events(at,category,level,code,message,detail,feed_id,target_id,context) VALUES (?,?,?,?,?,?,?,?,?)', batch)
                            await self.store.db.execute('DELETE FROM diagnostic_events WHERE at<?',
                                                        ((datetime.now(timezone.utc) - timedelta(days=RETENTION['days'])).isoformat(),))
                            for feed in {row[6] for row in batch if row[6] is not None}:
                                await self.store.db.execute('DELETE FROM diagnostic_events WHERE feed_id=? AND id NOT IN '
                                                            '(SELECT id FROM diagnostic_events WHERE feed_id=? ORDER BY id DESC LIMIT ?)',
                                                            (feed, feed, RETENTION['per_feed']))
                            await self.store.db.execute('DELETE FROM diagnostic_events WHERE id NOT IN '
                                                        '(SELECT id FROM diagnostic_events ORDER BY id DESC LIMIT ?)', (RETENTION['max_entries'],))
                        if runs:
                            await self._write_runs(runs)
                        await self.store.db.commit()
                    except BaseException:
                        await self.store.db.rollback()
                        raise
                self.degraded = False
            except asyncio.CancelledError:
                self.dropped += len(batch) + len(runs)
                raise
            except Exception:
                self.degraded = True
                self.dropped += len(batch) + len(runs)
                # Never interpolate an exception which may contain input or credentials.
                LOGGER.warning('Operational history storage failed; recent events could not be saved')

    async def _write_runs(self, runs):
        """Fold each check into the feed's newest row when the result is the same, else start a new row."""
        db, newest = self.store.db, {}
        for at, feed, status, http_status, duration, entries, new, manual, detail in runs:
            duration = duration or 0
            if feed not in newest:
                rows = await db.execute_fetchall(
                    'SELECT id,status,http_status,entries,new_entries,manual,detail FROM fetch_runs WHERE feed_id=? ORDER BY id DESC LIMIT 1', (feed,))
                newest[feed] = tuple(rows[0]) if rows else None
            same = (status, http_status, entries, new, manual, detail)
            if newest[feed] and newest[feed][1:] == same:
                await db.execute('UPDATE fetch_runs SET last_at=?, count=count+1, ms_min=MIN(ms_min,?), ms_max=MAX(ms_max,?), '
                                 'ms_sum=ms_sum+? WHERE id=?', (at, duration, duration, duration, newest[feed][0]))
            else:
                cursor = await db.execute(
                    'INSERT INTO fetch_runs(at,last_at,feed_id,status,http_status,entries,new_entries,manual,detail,ms_min,ms_max,ms_sum) '
                    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', (at, at, feed, status, http_status, entries, new, manual, detail,
                                                          duration, duration, duration))
                newest[feed] = (cursor.lastrowid, *same)
        await db.execute('DELETE FROM fetch_runs WHERE last_at<?',
                         ((datetime.now(timezone.utc) - timedelta(days=RUN_RETENTION['days'])).isoformat(),))
        for feed in newest:
            await db.execute('DELETE FROM fetch_runs WHERE feed_id=? AND id NOT IN '
                             '(SELECT id FROM fetch_runs WHERE feed_id=? ORDER BY id DESC LIMIT ?)',
                             (feed, feed, self.run_rows))

    async def runs(self, query):
        from .service import Problem, integer
        if set(query) - {'feed_id', 'status', 'page', 'size'}:
            raise Problem('日志筛选字段无效。')
        page = integer(query.get('page', 1), '页码', 1, 100000)
        size = integer(query.get('size', 30), '每页条数', 1, 100)
        clauses, args = ['last_at>=?'], [(datetime.now(timezone.utc) - timedelta(days=RUN_RETENTION['days'])).isoformat()]
        if query.get('feed_id'):
            if ident(query['feed_id']) is None:
                raise Problem('日志关联 ID 无效。')
            clauses.append('feed_id=?')
            args.append(str(query['feed_id']))
        status = query.get('status')
        if status:
            groups = {'ok': ('updated', 'unchanged', 'not_modified', 'empty'), 'failed': ('failed', 'exception'),
                      'updated': ('updated',)}
            if status not in groups:
                raise Problem('日志状态筛选无效。')
            clauses.append('status IN (%s)' % ','.join('?' * len(groups[status])))
            args.extend(groups[status])
        await self.flush()
        where = ' WHERE ' + ' AND '.join(clauses)
        rows = await self.store.rows('SELECT * FROM fetch_runs' + where + ' ORDER BY id DESC LIMIT ? OFFSET ?',
                                     (*args, size, (page - 1) * size))
        total = (await self.store.rows('SELECT COUNT(*) AS n FROM fetch_runs' + where, args))[0]['n']
        for row in rows:
            row['manual'] = bool(row['manual'])
            row['detail'] = text(row['detail'], 300)
            row['duration_ms'] = round(row['ms_sum'] / row['count']) if row['count'] else None  # average
            row['duration_min'], row['duration_max'] = row.pop('ms_min'), row.pop('ms_max')
            del row['ms_sum']
        settings = await self.store.settings()
        return dict(items=rows, total=total, page=page, size=size, retention={**RUN_RETENTION, 'per_feed': self.run_rows},
                    started_at=settings.get('diagnostics_started_at'))

    async def history(self, query):
        from .service import Problem, integer
        allowed = {'category', 'level', 'feed_id', 'target_id', 'page', 'size'}
        if set(query) - allowed:
            raise Problem('日志筛选字段无效。')
        page = integer(query.get('page', 1), '页码', 1, 100000)
        size = integer(query.get('size', 30), '每页条数', 1, 100)
        clauses, args = [], []
        for key, choices in (('category', CATEGORIES), ('level', LEVELS)):
            value = query.get(key)
            if value:
                if value not in choices:
                    raise Problem('日志分类或级别无效。')
                clauses.append(key + '=?')
                args.append(value)
        for key in ('feed_id', 'target_id'):
            value = query.get(key)
            if value:
                if ident(value) is None:
                    raise Problem('日志关联 ID 无效。')
                clauses.append(key + '=?')
                args.append(str(value))
        await self.flush()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION['days'])).isoformat()
        clauses.append('at>=?')
        args.append(cutoff)
        where = ' WHERE ' + ' AND '.join(clauses)
        rows = await self.store.rows('SELECT * FROM diagnostic_events' + where + ' ORDER BY id DESC LIMIT ? OFFSET ?',
                                     (*args, size, (page - 1) * size))
        total = (await self.store.rows('SELECT COUNT(*) AS n FROM diagnostic_events' + where, args))[0]['n']
        for row in rows:
            # Defence in depth for restored databases created by older versions.
            row['message'] = text(row['message'], 400)
            row['detail'] = text(row['detail'])
            try:
                row['context'] = _context(json.loads(row['context']))
            except (ValueError, TypeError):
                row['context'] = {}
        settings = await self.store.settings()
        return dict(items=rows, total=total, page=page, size=size, retention=RETENTION.copy(),
                    started_at=settings.get('diagnostics_started_at'), degraded=self.degraded, dropped=self.dropped)

    async def close(self):
        if self.closed:
            return
        self.closed = True
        # Let an in-flight transaction complete before cancelling the idle writer.
        await self.flush()
        self.task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self.task
