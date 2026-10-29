"""Administrator-only backup download, preflight and stopped-instance staging."""
import asyncio
import json
import os
import sqlite3
from aiohttp import web
from . import backups
from .service import Problem


def install(routes, service, database_url, admin, body):
    lock = asyncio.Lock()

    async def record(code, message, *, error=None, detail='', stage=None):
        journal = getattr(service.store, 'diagnostics', None)
        if journal is not None:
            context = {'stage': stage or 'backup'}
            if error is not None:
                context['exception_type'] = type(error).__name__
            await journal.record('system', 'error' if error is not None else 'info', code, message,
                                 detail=detail, context=context)

    def authorize(request):
        admin(request)
        if request['principal']['kind'] != 'session':
            raise Problem('备份包含全实例数据，仅允许网页登录管理员操作。', 403)

    def locations():
        return backups.sqlite_path(database_url), backups.safe_path(service.store.path)

    def options(request):
        if set(request.query) - set(backups.SENSITIVE):
            raise backups.BackupError('未知覆盖选项。')
        if any(value not in ('true', 'false') for value in request.query.values()):
            raise backups.BackupError('覆盖选项应为 true 或 false。')
        return backups.flags({key: value == 'true' for key, value in request.query.items()})

    async def uploaded(request):
        if request.content_type != 'application/json':
            raise Problem('请上传 JSON 备份文件。', 415)
        chunks = bytearray()
        async for chunk in request.content.iter_chunked(65536):
            chunks.extend(chunk)
            if len(chunks) > backups.MAX_BYTES:
                raise Problem('备份超过 32 MiB 限制。', 413)
        return bytes(chunks)

    async def run(function, *args):
        try:
            return await asyncio.to_thread(function, *args)
        except FileExistsError:
            raise
        except (backups.BackupError, sqlite3.Error, ValueError, OSError) as error:
            # BackupError contains our own validation messages, never file data.
            # SQLite and OS messages can contain paths or imported values.
            await record('backup.failed', '备份或恢复准备失败。', error=error,
                         detail=str(error) if isinstance(error, backups.BackupError) else '',
                         stage=function.__name__)
            # Never expose SQL data, schema details or private paths to the client.
            raise Problem('备份操作失败：请检查文件完整性、版本、选项、数据库结构或是否已有待恢复文件。', 400) from None

    def restore_status():
        folder = service.store.path.parent
        if (folder / '.restore-pending.json').exists():
            return {'status': 'pending_restart', 'applied': False}
        path = backups.safe_path(folder / '.restore-result.json', exists=False)
        return json.loads(path.read_bytes()) if path.exists() else {'status': 'none'}

    async def components():
        names = {row['name'] for row in await service.store.rows("SELECT name FROM sqlite_master WHERE type='table'")}
        result = {key: [name for name in value if name in names] for key, value in backups.COMPONENTS.items()}
        if backups.backup_runtime.available():
            result['runtime_config'] = ['runtime-config.json (nonsecret)']
        return result

    @routes.get('/api/backups')
    async def capabilities(request):
        authorize(request)
        return web.json_response({'format_version': 1, 'max_bytes': backups.MAX_BYTES,
                                  'sqlite': database_url.startswith('sqlite:'),
                                  'restore_supported': database_url.startswith('sqlite:') and os.name != 'nt',
                                  'mode': 'apply_on_restart', 'components': await components(),
                                  'restore': restore_status(),
                                  'never_included': ['web_sessions', 'bot_token', 'telethon_session', 'deployment_environment']})

    @routes.post('/api/backups/export')
    async def export(request):
        authorize(request)
        values = await body(request)
        try:
            selected = backups.flags(values)
            main, console = locations()
        except backups.BackupError as error:
            raise Problem(str(error), 400) from None
        async with lock, service.mutation:
            raw = await run(backups.export, main, console, selected)
        await record('backup.exported', '备份文件已生成。', stage='export')
        return web.Response(body=raw, content_type='application/json', headers={
            'Content-Disposition': 'attachment; filename="rsstt-backup.json"'})

    @routes.post('/api/backups/preflight')
    @routes.post('/api/backups/restore')
    async def preflight(request):
        authorize(request)
        try:
            main, console = locations()
            selected = options(request)
        except backups.BackupError as error:
            raise Problem(str(error), 400) from None
        raw = await uploaded(request)
        async with lock, service.mutation:
            summary = await run(backups.validate, main, console, raw, selected)
            if request.path.endswith('/restore'):
                if request.headers.get('X-Backup-SHA256') != summary['sha256']:
                    raise Problem('请先预检同一文件，再用返回的 SHA256 确认暂存。', 409)
                path = console.parent / '.restore-pending.json'
                try:
                    await run(backups.write_private, path, backups.encode({'backup': raw.decode(), 'overwrite': selected, 'sha256': summary['sha256']}))
                except FileExistsError:
                    raise Problem('已有待恢复文件，请先应用或取消。', 409) from None
                summary.update(status='pending_restart', applied=False,
                               instructions='任务已暂存，尚未恢复。请正常重启实例；启动前将自动恢复并重新初始化 ORM、配置和调度。')
        if summary['status'] == 'pending_restart':
            await record('backup.staged', '恢复任务已暂存，等待重启后应用。', stage='restore')
        else:
            await record('backup.validated', '备份预检通过。', stage='preflight')
        return web.json_response(summary, status=202 if summary['status'] == 'pending_restart' else 200)

    @routes.delete('/api/backups/pending')
    async def cancel(request):
        authorize(request)
        async with lock:
            try:
                path = backups.safe_path(service.store.path.parent / '.restore-pending.json', exists=False)
            except backups.BackupError as error:
                raise Problem(str(error), 400) from None
            path.unlink(missing_ok=True)
        await record('backup.cancelled', '已取消待恢复任务。', stage='restore')
        return web.json_response({'ok': True})
