"""A task-local permission check used only by explicit manual deliveries."""
from contextlib import contextmanager
from contextvars import ContextVar

_current = ContextVar('rsstt_manual_send_guard', default=None)


class SendStopped(Exception):
    def __init__(self, partial=False):
        self.partial = partial
        self.status = 'unconfirmed' if partial else 'failed'
        self.detail = ('发送被停止，可能已有部分消息送达。' if partial else
                       '发送已停止，本篇未发送。')
        super().__init__(self.detail)


class Guard:
    def __init__(self, resolve, target_id):
        self.resolve, self.target_id = resolve, target_id
        self.attempted = False

    async def check(self):
        try:
            sub = await self.resolve()
            if sub is None:
                raise ValueError('Subscription is no longer eligible')
            return sub
        except Exception as error:
            raise SendStopped(self.attempted) from error


@contextmanager
def enforce(resolve, target_id):
    guard = Guard(resolve, target_id)
    token = _current.set(guard)
    try:
        yield guard
    finally:
        _current.reset(token)


async def check(target_id):
    guard = _current.get()
    if guard is not None and guard.target_id == target_id:
        await guard.check()


def attempted(target_id):
    guard = _current.get()
    if guard is not None and guard.target_id == target_id:
        guard.attempted = True
