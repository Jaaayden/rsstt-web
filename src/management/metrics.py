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
        if last_error and (journal := getattr(store, 'diagnostics', None)) is not None:
            await journal.record('system', 'info', 'metrics.recovered', '统计记录已恢复。',
                                 context={'stage': 'metrics'})
        last_error = None
    except Exception as error:
        # Observability must not interrupt the bot; expose degradation in the console.
        if last_error is None and (journal := getattr(store, 'diagnostics', None)) is not None:
            await journal.record('system', 'error', 'metrics.failed', '统计记录写入失败。',
                                 context={'stage': 'metrics', 'exception_type': type(error).__name__})
        last_error = '统计写入失败，请检查磁盘和服务日志。'
        logging.getLogger('RSStT.management').exception('Failed to persist console metrics')
