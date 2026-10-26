"""Persistent console-only administrator; never reads Telegram credentials."""
import asyncio
import hashlib
import hmac
import secrets
import time
from collections import OrderedDict


# Backup integrations preserve these tables unless credentials are explicitly
# selected for replacement. Never expose their contents to Agent routes.
AUTH_TABLES = frozenset({'console_admin', 'credentials'})


async def revoke_browser_sessions(store):
    await store.execute("DELETE FROM credentials WHERE kind='session'")


class Auth:
    @classmethod
    async def load(cls, store, bootstrap_password, username='admin'):
        await store.execute('CREATE TABLE IF NOT EXISTS console_admin (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, salt BLOB NOT NULL, hash BLOB NOT NULL)')
        rows = await store.rows('SELECT * FROM console_admin WHERE id=1')
        self = cls()
        self.store, self.username = store, username
        self.attempts = OrderedDict()
        self.lock = asyncio.Semaphore(2)
        self.change_lock = asyncio.Lock()
        if rows:
            self.username, self.salt, self.password = (rows[0][k] for k in ('username', 'salt', 'hash'))
        else:
            self.validate(bootstrap_password)
            self.salt = secrets.token_bytes(16)
            self.password = await asyncio.to_thread(self.hash, bootstrap_password)
            await store.execute('INSERT INTO console_admin VALUES (1,?,?,?)', (username, self.salt, self.password))
        return self

    @staticmethod
    def validate(password):
        if not isinstance(password, str) or not 16 <= len(password) <= 512:
            raise ValueError('Initialize console with WEB_PASSWORD containing 16–512 characters')

    def hash(self, password):
        return hashlib.scrypt(password.encode(), salt=self.salt, n=16384, r=8, p=1)

    async def verify(self, password, address):
        from .service import Problem
        now = time.monotonic()
        count, since = self.attempts.pop(address, (0, now))
        if now - since > 300:
            count, since = 0, now
        self.attempts[address] = (count + 1, since)
        while len(self.attempts) > 1024:
            self.attempts.popitem(last=False)
        if count >= 10:
            raise Problem('尝试次数过多，请在 5 分钟后重试。', 429)
        if not isinstance(password, str) or len(password) > 512:
            raise Problem('登录凭据不正确。', 401)
        async with self.lock:
            result = await asyncio.to_thread(self.hash, password)
        if not hmac.compare_digest(result, self.password):
            raise Problem('登录凭据不正确。', 401)
        self.attempts.pop(address, None)

    async def change(self, password):
        from .service import Problem
        try:
            self.validate(password)
        except ValueError:
            raise Problem('新密码需为 16–512 个字符。')
        salt = secrets.token_bytes(16)
        hashed = await asyncio.to_thread(hashlib.scrypt, password.encode(), salt=salt, n=16384, r=8, p=1)
        async with self.store.lock:
            try:
                await self.store.db.execute('UPDATE console_admin SET salt=?,hash=? WHERE id=1', (salt, hashed))
                await self.store.db.execute("DELETE FROM credentials WHERE kind='session'")
                await self.store.db.commit()
            except BaseException:
                await self.store.db.rollback()
                raise
        self.salt, self.password = salt, hashed
