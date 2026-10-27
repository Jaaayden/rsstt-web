"""Hooks count committed new entries and successfully delivered logical posts."""
import logging

store = None
last_error = None


async def record(**counts):
    global last_error
    if store is None:
        return
    try:
        await store.increment(**counts)
        last_error = None
    except Exception:
        # Observability must not interrupt the bot; expose degradation in the console.
        last_error = '统计写入失败，请检查磁盘和服务日志。'
        logging.getLogger('RSStT.management').exception('Failed to persist console metrics')
