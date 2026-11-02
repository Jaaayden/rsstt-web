"""Persistent console-only administrator; never reads Telegram credentials."""
import asyncio
import hashlib
import hmac
import secrets
import re
import time
from collections import OrderedDict

USERNAME = re.compile(r'[A-Za-z0-9._@+-]{1,64}')


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

    async def verify(self, password, address, username=None):
        """`username` is checked when given (the sign-in form always sends it); scripts may still omit it."""
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
            raise Problem('登录凭据不正确。', 401, code='INVALID_CREDENTIALS')
        async with self.lock:
            result = await asyncio.to_thread(self.hash, password)
        wrong_user = username is not None and not (
            isinstance(username, str) and hmac.compare_digest(username.strip().encode(), self.username.encode()))
        if not hmac.compare_digest(result, self.password) or wrong_user:
            raise Problem('登录凭据不正确。', 401, code='INVALID_CREDENTIALS')
        self.attempts.pop(address, None)

    async def change(self, password=None, username=None):
        from .service import Problem
        if username is not None and not USERNAME.fullmatch(username):
            raise Problem('账号需为 1–64 个字符，可用字母、数字和 . _ @ + -。', code='NEW_USERNAME_INVALID')
        salt, hashed = self.salt, self.password
        if password is not None:
            try:
                self.validate(password)
            except ValueError:
                raise Problem('新密码需为 16–512 个字符。', code='NEW_PASSWORD_INVALID')
            salt = secrets.token_bytes(16)
            hashed = await asyncio.to_thread(hashlib.scrypt, password.encode(), salt=salt, n=16384, r=8, p=1)
        name = self.username if username is None else username
        async with self.store.lock:
            try:
                await self.store.db.execute('UPDATE console_admin SET username=?,salt=?,hash=? WHERE id=1', (name, salt, hashed))
                await self.store.db.execute("DELETE FROM credentials WHERE kind='session'")
                await self.store.db.commit()
            except BaseException:
                await self.store.db.rollback()
                raise
        self.salt, self.password, self.username = salt, hashed, name
