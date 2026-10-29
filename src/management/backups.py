"""Bounded logical SQLite backups. No uploaded SQL, paths or archive extraction.

Restore is deliberately offline: both databases participate in one SQLite
super-journal transaction, with FULL synchronous DELETE journals. Runtime must
hold InstanceLock for its entire lifetime. Deployments must stop old versions too.
"""
import argparse
import base64
import contextlib
import hashlib
import json
import os
import re
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from . import backup_runtime

MAX_BYTES = 32 * 1024 * 1024
MAIN_TABLES = ('user', 'feed', 'sub', 'option')
# Extensions register trusted table names here. Sensitive groups are opt-in on
# BOTH export and restore. Unknown tables/keys are never implicitly included.
COMPONENTS = {
    'data': ('targets', 'metrics', 'activity'),
    'agent_tokens': ('credentials',),
    'admin_credentials': ('console_admin',),
    'runtime_config': (),
    'notification_secrets': ('notify_config',),
}
EXTENSION_DATA = ('metrics_hourly', 'notify_seen', 'feed_fetch_options', 'chat_events', 'diagnostic_events')
META_KEYS = ('started_at', 'attention_threshold', 'hourly_started_at', 'diagnostics_started_at')
OPTION_KEYS = ('default_interval', 'minimal_interval', 'user_sub_limit',
               'channel_or_group_sub_limit', 'sub_limit_reached_message')
SENSITIVE = ('agent_tokens', 'admin_credentials', 'runtime_config', 'notification_secrets')


class BackupError(ValueError):
    pass


def safe_path(path, exists=True):
    path = Path(os.path.abspath(path))
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise BackupError('备份路径不能包含符号链接。')
    if exists and not path.is_file():
        raise BackupError('数据库或备份文件不存在。')
    return path


class InstanceLock:
    def __init__(self, database):
        self.path = safe_path(str(Path(database).resolve()) + '.maintenance.lock', exists=False)
        self.fd = None

    def __enter__(self):
        self.fd = os.open(self.path, os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        try:
            if os.name == 'nt':
                import msvcrt
                if os.fstat(self.fd).st_size == 0:
                    os.write(self.fd, b'0')
                os.lseek(self.fd, 0, os.SEEK_SET)
                msvcrt.locking(self.fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(self.fd)
            self.fd = None
            raise BackupError('实例正在运行；请先停止机器人及预览进程。') from None
        return self

    def __exit__(self, *args):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


def sqlite_path(url):
    if not url.startswith('sqlite:') or ':memory:' in url:
        raise BackupError('网页备份仅支持文件 SQLite；PostgreSQL 请按维护文档使用 pg_dump/pg_restore。')
    path = url[len('sqlite:'):]
    if path.startswith('//'):
        path = path[2:]
    return safe_path(path)


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def flags(values):
    if not isinstance(values, dict) or set(values) - set(SENSITIVE):
        raise BackupError('包含未知备份选项。')
    if any(type(v) is not bool for v in values.values()):
        raise BackupError('备份选项必须为布尔值。')
    for name, enabled in values.items():
        if enabled and not COMPONENTS[name] and not (name == 'runtime_config' and backup_runtime.available()):
            raise BackupError(f'{name} 尚未注册可备份组件；部署环境中的凭据永不导出。')
    return {name: values.get(name, False) for name in SENSITIVE}


def tables(options, extensions=()):
    result = [('main', name) for name in MAIN_TABLES] + [('console', 'meta')]
    for group, names in COMPONENTS.items():
        if group == 'data' or options.get(group):
            result.extend(('console', name) for name in names)
    if set(extensions) - set(EXTENSION_DATA):
        raise BackupError('未知扩展数据。')
    result.extend(('console', name) for name in extensions)
    return result


def ident(name):
    if not re.fullmatch(r'[a-z][a-z0-9_]*', name):
        raise BackupError('无效表名称。')
    return '"' + name + '"'


def connect(main, console):
    main, console = safe_path(main), safe_path(console)
    if main == console or os.path.samefile(main, console):
        raise BackupError('主数据库与管理数据库必须不同。')
    for path in (main, console):
        for suffix in ('-wal', '-shm', '-journal'):
            safe_path(str(path) + suffix, exists=False)
    connection = sqlite3.connect(main.as_uri() + '?mode=rw', uri=True, timeout=5)
    try:
        connection.execute('ATTACH DATABASE ? AS console', (str(console),))
        connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, MAX_BYTES)
        connection.execute('PRAGMA foreign_keys=ON')
        connection.execute('PRAGMA trusted_schema=OFF')
        return connection
    except BaseException:
        connection.close()
        raise


def columns(connection, schema, table):
    rows = connection.execute(f'PRAGMA {schema}.table_info({ident(table)})').fetchall()
    if not rows:
        raise BackupError('目标缺少备份组件所需的表。')
    return [row[1] for row in rows]


def where(table):
    if table == 'credentials':
        return " WHERE kind='token'", ()
    if table == 'meta':
        return ' WHERE key IN (' + ','.join('?' for _ in META_KEYS) + ')', META_KEYS
    return '', ()


def capture(connection, options, console=None):
    data = {}
    budget = 0
    existing = {row[0] for row in connection.execute("SELECT name FROM console.sqlite_master WHERE type='table'")}
    extensions = [name for name in EXTENSION_DATA if name in existing]
    for schema, table in tables(options, extensions):
        cols = columns(connection, schema, table)
        clause, args = where(table)
        rows = []
        for row in connection.execute(f'SELECT * FROM {schema}.{ident(table)}{clause}', args):
            row = [{'blob': base64.b64encode(v).decode()} if isinstance(v, bytes) else v for v in row]
            budget += len(encode(row))
            if budget > MAX_BYTES - 4096 or len(rows) >= 100000:
                raise BackupError('备份超出大小或单表 100000 行限制。')
            rows.append(row)
        data[f'{schema}.{table}'] = {'columns': cols, 'rows': rows}
    if options['runtime_config']:
        data['runtime.config'] = backup_runtime.export(Path(console).parent)
    payload = encode(data)
    if len(payload) > MAX_BYTES - 4096:
        raise BackupError('备份超过 32 MiB 限制，请使用停机数据库工具。')
    manifest = {'format': 'rsstt-logical-backup', 'version': 1, 'database': 'sqlite',
                'created_at': datetime.now(timezone.utc).isoformat(),
                'included': options, 'extensions': extensions, 'sha256': hashlib.sha256(payload).hexdigest(),
                'excluded': ['web_sessions', 'bot_token', 'telethon_session', 'deployment_environment', 'notify_jobs', 'recent_articles'],
                'consistency': 'single SQLite transaction across main and console'}
    return encode({'manifest': manifest, 'data': data})


def export(main, console, options=None):
    options = flags(options or {})
    with contextlib.closing(connect(main, console)) as connection:
        # BEGIN IMMEDIATE obtains write reservations on all attached databases.
        # Readers continue; writers wait while both logical snapshots are read.
        connection.execute('BEGIN IMMEDIATE')
        try:
            return capture(connection, options, console)
        finally:
            connection.rollback()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise BackupError('备份含重复 JSON 字段。')
        result[key] = value
    return result


def unpack(raw):
    if len(raw) > MAX_BYTES:
        raise BackupError('备份超过 32 MiB 限制。')
    try:
        package = json.loads(raw, object_pairs_hook=unique_object)
        if set(package) != {'manifest', 'data'}:
            raise ValueError()
        manifest, data = package['manifest'], package['data']
        if (manifest['format'], manifest['version'], manifest['database']) != ('rsstt-logical-backup', 1, 'sqlite'):
            raise ValueError()
        if not isinstance(manifest['created_at'], str):
            raise ValueError()
        datetime.fromisoformat(manifest['created_at'])
        options = flags(manifest['included'])
        expected = {f'{s}.{t}' for s, t in tables(options, manifest.get('extensions', []))} | ({'runtime.config'} if options['runtime_config'] else set())
        if set(data) != expected:
            raise ValueError()
        if hashlib.sha256(encode(data)).hexdigest() != manifest['sha256']:
            raise ValueError()
        if options['runtime_config']:
            backup_runtime.validate(data['runtime.config'])
        for key, item in data.items():
            if key == 'runtime.config':
                continue
            if set(item) != {'columns', 'rows'} or not isinstance(item['columns'], list) or not isinstance(item['rows'], list):
                raise ValueError()
            if len(item['rows']) > 100000 or len(item['columns']) > 128:
                raise ValueError()
            if len(item['columns']) != len(set(item['columns'])):
                raise ValueError()
            for row in item['rows']:
                if not isinstance(row, list) or len(row) != len(item['columns']):
                    raise ValueError()
                if any(type(v) not in (str, int, float, type(None)) and not (isinstance(v, dict) and set(v) == {'blob'} and isinstance(v['blob'], str)) for v in row):
                    raise ValueError()
                for v in row:
                    if isinstance(v, dict):
                        base64.b64decode(v['blob'], validate=True)
        return package
    except (ValueError, TypeError, KeyError, RecursionError, OverflowError) as error:
        raise BackupError('备份格式、版本、组件或完整性校验失败。') from error


def apply_rows(connection, package, options):
    included = package['manifest']['included']
    if any(enabled and not included.get(name) for name, enabled in options.items()):
        raise BackupError('备份不含选定的覆盖组件。')
    selected = tables(options, package['manifest'].get('extensions', []))
    diagnostic_rows = None
    # Validate EVERY component even when not selected for overwrite.
    for schema, table in tables(included, package['manifest'].get('extensions', [])):
        item = package['data'][f'{schema}.{table}']
        if item['columns'] != columns(connection, schema, table):
            raise BackupError('备份与目标数据库结构不一致，请先使用相同版本。')
        if table == 'console_admin' and len(item['rows']) != 1:
            raise BackupError('管理员备份必须包含且仅包含一个账户。')
        cols = item['columns']
        if table == 'diagnostic_events':
            from .diagnostics import restored_rows
            try:
                diagnostic_rows = restored_rows(cols, item['rows'])
            except (ValueError, KeyError, TypeError, OverflowError) as error:
                raise BackupError('备份中的运行日志格式无效。') from error
        definitions = connection.execute(f'PRAGMA {schema}.table_info({ident(table)})').fetchall()
        for row in item['rows']:
            for definition, value in zip(definitions, row):
                _, column, declared, required, _, primary = definition
                declared = declared.upper()
                if value is None:
                    if required or primary:
                        raise BackupError('必填数据库字段为空。')
                    continue
                if 'INT' in declared:
                    valid = type(value) is int and -(2 ** 63) <= value < 2 ** 63
                elif any(kind in declared for kind in ('REAL', 'FLOAT', 'DOUBLE')):
                    valid = type(value) in (int, float)
                elif 'BLOB' in declared:
                    valid = isinstance(value, dict) and set(value) == {'blob'}
                else:
                    valid = isinstance(value, str)
                if not valid:
                    raise BackupError('数据库字段类型无效。')
                if 'JSON' in declared:
                    json.loads(value)
                if 'TIMESTAMP' in declared or 'DATETIME' in declared:
                    datetime.fromisoformat(value)
            values = dict(zip(cols, row))
            if table == 'credentials':
                if values.get('kind') != 'token' or values.get('permission') not in ('read', 'write'):
                    raise BackupError('备份仅允许普通 read/write 连接令牌，不能导入管理员令牌或网页登录会话。')
                scope = json.loads(values['targets'])
                if scope is not None and (not isinstance(scope, list) or any(not isinstance(v, str) or not re.fullmatch(r'-?[0-9]+', v) for v in scope)):
                    raise BackupError('连接令牌会话范围无效。')
            if table == 'console_admin':
                if values.get('id') != 1 or not isinstance(values.get('username'), str) or not 1 <= len(values['username']) <= 80:
                    raise BackupError('管理员记录无效。')
                for field, size in (('salt', 16), ('hash', 64)):
                    if not isinstance(values.get(field), dict) or len(base64.b64decode(values[field]['blob'], validate=True)) != size:
                        raise BackupError('管理员密码哈希格式无效。')
            if table == 'meta' and values.get('key') not in META_KEYS:
                raise BackupError('备份包含未注册的管理配置。')
            if table == 'option':
                if values.get('key') not in OPTION_KEYS:
                    raise BackupError('备份包含未注册的运行配置。')
                if values['key'] != 'sub_limit_reached_message':
                    number = int(values['value'])
                    if not (-1 if values['key'].endswith('sub_limit') else 1) <= number <= 32767:
                        raise BackupError('全局配置值超出范围。')
            if table == 'meta' and values['key'] == 'attention_threshold':
                if not 1 <= int(values['value']) <= 100:
                    raise BackupError('提醒阈值超出范围。')
            if table in ('metrics', 'metrics_hourly'):
                if any(values[k] < 0 for k in ('fetched', 'delivered', 'failed')):
                    raise BackupError('统计计数不能为负数。')
    # Defer FK validation so parent/child tables can be replaced together.
    connection.execute('PRAGMA defer_foreign_keys=ON')
    for schema, table in reversed(selected):
        clause, args = where(table)
        connection.execute(f'DELETE FROM {schema}.{ident(table)}{clause}', args)
    for schema, table in selected:
        item = package['data'][f'{schema}.{table}']
        cols = ','.join(ident(c) for c in item['columns'])
        placeholders = ','.join('?' for _ in item['columns'])
        decoded = [[base64.b64decode(v['blob'], validate=True) if isinstance(v, dict) else v for v in row] for row in item['rows']]
        if table == 'diagnostic_events':
            decoded = diagnostic_rows
        connection.executemany(f'INSERT INTO {schema}.{ident(table)} ({cols}) VALUES ({placeholders})', decoded)
    if 'chat_events' not in package['manifest'].get('extensions', []) and connection.execute(
            "SELECT 1 FROM console.sqlite_master WHERE type='table' AND name='chat_events'").fetchone():
        connection.execute('DELETE FROM console.chat_events')
    if 'diagnostic_events' not in package['manifest'].get('extensions', []) and connection.execute(
            "SELECT 1 FROM console.sqlite_master WHERE type='table' AND name='diagnostic_events'").fetchone():
        connection.execute('DELETE FROM console.diagnostic_events')
    if connection.execute("SELECT 1 FROM console.sqlite_master WHERE type='table' AND name='notify_jobs'").fetchone():
        connection.execute('DELETE FROM console.notify_jobs')
    # The disposable article cache refers to upstream numeric IDs. They may be
    # reused by restored data, so no old delivery evidence may survive a restore.
    for cache in ('article_deliveries', 'article_cache'):
        if connection.execute('SELECT 1 FROM console.sqlite_master WHERE type=\'table\' AND name=?', (cache,)).fetchone():
            connection.execute(f'DELETE FROM console.{ident(cache)}')
    connection.execute("DELETE FROM console.meta WHERE key='articles_started_at'")
    # Restore invalidates target sessions too. Source sessions are never included.
    connection.execute("DELETE FROM console.credentials WHERE kind='session'")
    for schema in ('main', 'console'):
        if connection.execute(f'PRAGMA {schema}.foreign_key_check').fetchall():
            raise BackupError('备份存在无效关联。')
        if connection.execute(f'PRAGMA {schema}.quick_check').fetchone()[0] != 'ok':
            raise BackupError('恢复后的数据库完整性检查失败。')


def snapshot(connection, folder):
    for schema, name in (('main', 'main.sqlite3'), ('console', 'console.sqlite3')):
        path = folder / name
        with contextlib.closing(sqlite3.connect(path)) as target:
            connection.backup(target, name=schema)
        path.chmod(0o600)
    sync_directory(folder)


def validate(main, console, raw, options=None):
    if os.name == 'nt':
        raise BackupError('Windows 支持正常 Bot 启动和备份导出；自动恢复须在 POSIX 主机执行。')
    package, options = unpack(raw), flags(options or {})
    with tempfile.TemporaryDirectory(prefix='rsstt-preflight-') as folder:
        folder = Path(folder).resolve()
        with contextlib.closing(connect(main, console)) as source:
            # SQLite backup captures each DB consistently. Final apply rechecks
            # against the stopped target; this preview is not an apply promise.
            snapshot(source, folder)
        with contextlib.closing(connect(folder / 'main.sqlite3', folder / 'console.sqlite3')) as target:
            target.execute('BEGIN IMMEDIATE')
            try:
                # Check constraints of all supplied data, including opt-in groups.
                apply_rows(target, package, package['manifest']['included'])
                target.commit()
            except BaseException:
                target.rollback()
                raise
    if any(v and not package['manifest']['included'].get(k) for k, v in options.items()):
        raise BackupError('备份不含选定的覆盖组件。')
    return {'sha256': hashlib.sha256(raw).hexdigest(), 'created_at': package['manifest']['created_at'],
            'counts': {k: len(v.get('rows', v.get('values', {}))) for k, v in package['data'].items()},
            'included': package['manifest']['included'], 'overwrite': options,
            'status': 'validated', 'requires_stopped_instance': True,
            'authentication': 'preserve_target' if not options['admin_credentials'] else 'overwrite_registered_admin_component',
            'web_sessions': 'invalidate_all', 'bot_token': 'never', 'telethon_session': 'never'}


def restore(main, console, raw, options=None, *, main_locked=False):
    """Offline only. Do not call from an HTTP handler or a running ORM process."""
    options = flags(options or {})
    with (contextlib.nullcontext() if main_locked else InstanceLock(main)), InstanceLock(console):
        recover(main, console)
        summary = validate(main, console, raw, options)
        package = unpack(raw)
        with contextlib.closing(connect(main, console)) as connection:
            # Atomic commit across attached SQLite files requires rollback journals,
            # not WAL. No runtime connections are allowed while doing this.
            for schema in ('main', 'console'):
                if connection.execute(f'PRAGMA {schema}.journal_mode=DELETE').fetchone()[0] != 'delete':
                    raise BackupError('无法启用原子恢复所需的 DELETE 日志模式。')
                connection.execute(f'PRAGMA {schema}.synchronous=FULL')
            rollback = Path(tempfile.mkdtemp(prefix='rollback-', dir=safe_path(console).parent))
            snapshot(connection, rollback)
            runtime = safe_path(Path(console).parent / 'runtime-config.json', exists=False)
            if runtime.exists():
                write_private(rollback / 'runtime-config.json', runtime.read_bytes())
            recovery = safe_path(Path(console).parent / '.restore-recovery.json', exists=False)
            write_private(recovery, encode({'rollback': str(rollback), 'main': str(safe_path(main))}))
            try:
                connection.execute('BEGIN IMMEDIATE')
                apply_rows(connection, package, options)
                connection.commit()
                if options['runtime_config']:
                    backup_runtime.restore(Path(console).parent, package['data']['runtime.config'])
                recovery.unlink()
                sync_directory(recovery.parent)
            except BaseException:
                connection.rollback()
                # Release every DB connection before compensating a committed
                # transaction whose following config-file publication failed.
                connection.close()
                recover(main, console)
                raise
        return {**summary, 'status': 'applied_offline', 'rollback_directory': str(rollback),
                'next_step': 'Start the instance normally to initialize ORM, options and scheduler.'}


def recover(main, console):
    """Interrupted cross-file restore: return to durable rollback snapshots first."""
    folder = Path(console).parent
    marker = safe_path(folder / '.restore-recovery.json', exists=False)
    if not marker.exists():
        return
    task = json.loads(marker.read_bytes())
    rollback = Path(task['rollback'])
    if rollback.parent != folder or not rollback.name.startswith('rollback-') or task['main'] != str(safe_path(main)):
        raise BackupError('恢复日志路径不匹配；请人工检查。')
    for target_path, filename in ((main, 'main.sqlite3'), (console, 'console.sqlite3')):
        original = safe_path(rollback / filename)
        with contextlib.closing(sqlite3.connect(original)) as source, contextlib.closing(sqlite3.connect(safe_path(target_path))) as target:
            source.backup(target)
    runtime = safe_path(folder / 'runtime-config.json', exists=False)
    original_runtime = safe_path(rollback / 'runtime-config.json', exists=False)
    if original_runtime.exists():
        temp = safe_path(folder / '.runtime-recovery.tmp', exists=False)
        temp.unlink(missing_ok=True)
        write_private(temp, original_runtime.read_bytes())
        os.replace(temp, runtime)
    else:
        runtime.unlink(missing_ok=True)
    marker.unlink()


_runtime_lock = None


def acquire_runtime(main):
    global _runtime_lock
    if _runtime_lock is None:
        candidate = InstanceLock(main)
        candidate.__enter__()
        _runtime_lock = candidate
    return _runtime_lock


def release_runtime():
    global _runtime_lock
    if _runtime_lock is not None:
        _runtime_lock.__exit__()
        _runtime_lock = None


def early_startup(database_url, config):
    """Must run after .env, BEFORE PR2 load_startup and env-derived objects."""
    folder = Path(config)
    if not any((folder / name).exists() for name in ('.restore-pending.json', '.restore-recovery.json')):
        return
    main = sqlite_path(database_url)
    acquire_runtime(main)
    console = folder / 'console.sqlite3'
    with InstanceLock(console):
        recover(main, console)
    apply_pending(main, console)


def sync_directory(folder):
    if os.name == 'nt':
        return  # Windows exports fsync the file; automatic restore is disabled.
    fd = os.open(folder, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_private(path, content):
    path = safe_path(path, exists=False)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(content)
        out.flush()
        os.fsync(out.fileno())
    sync_directory(path.parent)


def result_file(console, value):
    path = safe_path(Path(console).parent / '.restore-result.json', exists=False)
    temp = path.with_suffix('.tmp')
    safe_path(temp, exists=False)
    temp.unlink(missing_ok=True)
    write_private(temp, encode(value))
    os.replace(temp, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def apply_pending(main, console):
    """Called before ORM opens, while early_startup holds main InstanceLock."""
    path = safe_path(Path(console).parent / '.restore-pending.json', exists=False)
    if not path.exists():
        return
    applied = False
    try:
        if path.stat().st_size > MAX_BYTES * 2 + 8192:
            raise BackupError('待恢复文件超过限制。')
        job = json.loads(path.read_bytes(), object_pairs_hook=unique_object)
        raw = job['backup'].encode()
        if hashlib.sha256(raw).hexdigest() != job['sha256']:
            raise BackupError('待恢复任务校验失败。')
        result_file(console, {'status': 'applying', 'sha256': job['sha256']})
        result = restore(main, console, raw, job['overwrite'], main_locked=True)
        applied = True
        result_file(console, {**result, 'status': 'succeeded', 'applied': True})
        path.unlink()
    except Exception as error:
        result_file(console, {'status': 'failed', 'applied': applied,
                              'at': datetime.now(timezone.utc).isoformat(),
                              'exception_type': type(error).__name__,
                              'error': str(error) if isinstance(error, BackupError) else
                              '恢复或结果记录失败，启动已停止；请检查维护日志和回退副本后重试。'})
        # Preserve failed input for operator diagnostics, but don't retry on every
        # restart. No failed task may prevent recovering access to the old data.
        failed = safe_path(path.with_name('.restore-failed.json'), exists=False)
        os.replace(path, failed)
        raise BackupError('待恢复任务失败，已保留失败包。再次启动使用原数据库。') from error


def main():
    parser = argparse.ArgumentParser(description='Offline SQLite maintenance; never reads bot.session or .env')
    parser.add_argument('action', choices=('export', 'restore'))
    parser.add_argument('--database', required=True, type=Path)
    parser.add_argument('--console', required=True, type=Path)
    parser.add_argument('--file', required=True, type=Path)
    for name in SENSITIVE:
        parser.add_argument('--' + name.replace('_', '-'), action='store_true')
    args = parser.parse_args()
    options = {name: getattr(args, name) for name in SENSITIVE}
    try:
        if args.action == 'export':
            with InstanceLock(args.database), InstanceLock(args.console):
                write_private(args.file, export(args.database, args.console, options))
            print('Backup exported (no bot/session/deployment secrets).')
        else:
            path = safe_path(args.file)
            if path.stat().st_size > MAX_BYTES:
                raise BackupError('备份超过 32 MiB 限制。')
            print(json.dumps(restore(args.database, args.console, path.read_bytes(), options), ensure_ascii=False))
    except (BackupError, sqlite3.Error) as error:
        parser.exit(1, f'维护未完成：{error}\n')


if __name__ == '__main__':
    main()
