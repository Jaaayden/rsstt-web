"""Small additive store; never changes the upstream RSStT database schema."""
import asyncio
import hashlib
import json
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

from . import statistics as aggregates


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = asyncio.Lock()
        self.db = None
        self.backup_lock = None

    async def open(self):
        try:
            return await self._open()
        except BaseException:
            await self.close()
            raise

    async def _open(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        from .backups import InstanceLock
        self.backup_lock = InstanceLock(self.path)
        self.backup_lock.__enter__()
        self.db = await aiosqlite.connect(self.path)
        self.db.row_factory = aiosqlite.Row
        await self.db.executescript('''
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=FULL;
            PRAGMA busy_timeout=5000;
            CREATE TABLE IF NOT EXISTS feed_fetch_options (url TEXT PRIMARY KEY, user_agent TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS targets (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, username TEXT,
                kind TEXT NOT NULL, membership TEXT NOT NULL, checked_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS credentials (
                id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
                kind TEXT NOT NULL, permission TEXT NOT NULL, targets TEXT NOT NULL,
                created_at REAL NOT NULL, expires_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS metrics (
                day TEXT PRIMARY KEY, fetched INTEGER NOT NULL DEFAULT 0,
                delivered INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS activity (
                id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
                actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL
            );
        ''')
        await self.db.execute('INSERT OR IGNORE INTO meta VALUES (?, ?)',
                              ('started_at', datetime.now(timezone.utc).isoformat()))
        await self.db.execute('INSERT OR IGNORE INTO meta VALUES (?, ?)', ('attention_threshold', '3'))
        await aggregates.initialize(self)
        await self.db.commit()
        self.path.chmod(0o600)
        return self

    async def close(self):
        if self.db:
            await self.db.close()
            self.db = None
        if self.backup_lock:
            self.backup_lock.__exit__()
            self.backup_lock = None

    async def rows(self, sql, args=()):
        async with self.lock:
            async with self.db.execute(sql, args) as cursor:
                return [dict(row) for row in await cursor.fetchall()]

    async def execute(self, sql, args=()):
        async with self.lock:
            try:
                await self.db.execute(sql, args)
                await self.db.commit()
            except BaseException:
                await self.db.rollback()
                raise

    async def settings(self):
        return {row['key']: row['value'] for row in await self.rows('SELECT * FROM meta')}

    async def set_setting(self, key, value):
        await self.execute('INSERT INTO meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                           (key, str(value)))

    async def credential(self, secret):
        rows = await self.rows('SELECT * FROM credentials WHERE hash=? AND expires_at>?',
                               (digest(secret), time.time()))
        if not rows:
            return None
        row = rows[0]
        row['targets'] = json.loads(row['targets'])
        return row

    async def issue(self, name, kind='session', permission='admin', targets=None, days=1):
        secret = ('rst_' if kind == 'token' else 'rss_') + secrets.token_urlsafe(32)
        ident = secrets.token_hex(8)
        now = time.time()
        await self.execute('DELETE FROM credentials WHERE expires_at<=?', (now,))
        await self.execute('INSERT INTO credentials VALUES (?,?,?,?,?,?,?,?)',
                           (ident, digest(secret), name, kind, permission, json.dumps(targets), now, now + days * 86400))
        return ident, secret

    async def tokens(self):
        return await self.rows("SELECT id,name,permission,targets,created_at,expires_at FROM credentials WHERE kind='token' AND expires_at>? ORDER BY created_at DESC", (time.time(),))

    async def target(self, ident, title, username, kind, membership):
        await self.execute('''INSERT INTO targets VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, username=excluded.username, kind=excluded.kind,
            membership=excluded.membership, checked_at=excluded.checked_at''',
                           (str(ident), title, username, kind, membership, datetime.now(timezone.utc).isoformat()))

    async def target_map(self, ids):
        if not ids:
            return {}
        placeholders = ','.join('?' for _ in ids)
        return {r['id']: r for r in await self.rows(f'SELECT * FROM targets WHERE id IN ({placeholders})', list(map(str, ids)))}

    async def audit(self, actor, action, detail):
        async with self.lock:
            await self.db.execute('INSERT INTO activity (at,actor,action,detail) VALUES (?,?,?,?)',
                                  (datetime.now(timezone.utc).isoformat(), actor, action, detail[:500]))
            await self.db.execute('DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT 200)')
            await self.db.commit()

    async def increment(self, fetched=0, delivered=0, failed=0, day=None, at=None):
        await aggregates.increment(self, fetched, delivered, failed, day, at)

    async def statistics_window(self, granularity='hour', start=None, end=None, unavailable=False):
        return await aggregates.query(self, granularity, start, end, unavailable)

    async def statistics(self):
        rows = await self.rows('SELECT * FROM metrics ORDER BY day')
        return {
            'totals': next((r for r in rows if r['day'] == 'total'), dict(fetched=0, delivered=0, failed=0)),
            'daily': [r for r in rows if r['day'] != 'total'],
        }
