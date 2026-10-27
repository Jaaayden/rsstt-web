"""Whitelisted restart configuration. Independent of env/Telegram for backup tools.

All settings are loaded BEFORE env creates clients, proxies and event loops.
Never mutate a running object's environment to claim a setting took effect.
"""
import json
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

# Authentication, manager identity, database locations and listeners stay deployment-owned.
DEPLOYMENT = ('MANAGER', 'CHATID', 'MANAGER_PRIVILEGED', 'DATABASE_URL',
              'DATABASE_PRIVATE_URL', 'DATABASE_PUBLIC_URL', 'WEB_ENABLED', 'WEB_HOST',
              'WEB_PORT', 'WEB_ORIGIN', 'WEB_PASSWORD', 'PORT', 'RAILWAY_STATIC_URL',
              'NO_UVLOOP', 'MULTIPROCESSING', 'EXECUTOR_NICENESS_INCREMENT', 'DEBUG')
BOOLS = ('MULTIUSER', 'PROXY_BYPASS_PRIVATE', 'IPV6_PRIOR', 'VERIFY_TLS',
         'TABLE_TO_IMAGE', 'TRAFFIC_SAVING', 'LAZY_MEDIA_VALIDATION')
INTS = {'API_ID': (1, 2147483647), 'CRON_SECOND': (0, 59), 'HTTP_TIMEOUT': (1, 300),
        'HTTP_CONCURRENCY': (0, 4096), 'HTTP_CONCURRENCY_PER_HOST': (0, 1024),
        'HTTP_MAX_LINE_SIZE': (1024, 1048576), 'HTTP_MAX_FIELD_SIZE': (1024, 1048576)}
PROXIES = ('SOCKS_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'T_PROXY', 'R_PROXY')
STRINGS = ('TOKEN', 'API_HASH', 'TELEGRAPH_TOKEN', 'ERROR_LOGGING_CHAT',
           'PROXY_BYPASS_DOMAINS', 'USER_AGENT', 'IMG_RELAY_SERVER', 'IMAGES_WESERV_NL', *PROXIES)
SECRETS = frozenset(('TOKEN', 'API_HASH', 'TELEGRAPH_TOKEN', *PROXIES))
KEYS = frozenset((*BOOLS, *INTS, *STRINGS))


class ConfigError(ValueError):
    pass


def validate(values):
    if not isinstance(values, dict) or set(values) - KEYS:
        raise ConfigError('包含不支持的运行配置。')
    clean = {}
    for key, value in values.items():
        if value is None:  # Remove override; deployment/default is used on restart.
            clean[key] = None
            continue
        error = ConfigError(f'{key} 的配置值无效。')  # Never include submitted values.
        if key in BOOLS:
            if type(value) is not bool:
                raise error
        elif key in INTS:
            if type(value) is not int or not INTS[key][0] <= value <= INTS[key][1]:
                raise error
        else:
            if not isinstance(value, str) or len(value) > 4096 or any(ord(c) < 32 for c in value):
                raise error
            if key == 'TOKEN' and not re.fullmatch(r'\d+:[A-Za-z0-9_-]{20,}', value):
                raise error
            if key == 'API_HASH' and value and not re.fullmatch(r'[a-fA-F0-9]{32}', value):
                raise error
            if key == 'ERROR_LOGGING_CHAT' and not re.fullmatch(r'-?[1-9]\d{0,15}', value):
                raise error
            if key in (*PROXIES, 'IMG_RELAY_SERVER', 'IMAGES_WESERV_NL') and value:
                try:
                    url = urlsplit(value)
                    schemes = ('http', 'socks4', 'socks5', 'socks5h') if key in PROXIES else ('http', 'https')
                    if url.scheme not in schemes or not url.hostname or url.fragment:
                        raise error
                    if key in PROXIES and (url.path not in ('', '/') or url.query):
                        raise error
                    if key not in PROXIES and (url.username or url.password):
                        raise error
                    _ = url.port
                except ValueError:
                    raise error from None
        clean[key] = value
    return clean


class RuntimeConfig:
    filename = 'runtime-config.json'

    def __init__(self, folder, applied=None, environment=None):
        self.path = Path(folder) / self.filename
        self.applied = dict(applied or {})
        self.environment = dict(environment or {})

    def _read(self):
        if not self.path.exists():
            return {}
        try:
            if self.path.is_symlink() or self.path.stat().st_size > 65536:
                raise ConfigError('运行配置文件无效。')
            data = json.loads(self.path.read_text())
            if not isinstance(data, dict) or data.get('version') != 1 or set(data) != {'version', 'values'}:
                raise ConfigError('运行配置文件版本无效。')
            values = validate(data['values'])
            if any(v is None for v in values.values()):
                raise ConfigError('运行配置文件无效。')
            self.path.chmod(0o600)
            return values
        except (OSError, ValueError, TypeError):
            raise ConfigError('无法读取有效的运行配置文件；请检查本地配置。') from None

    def save(self, patch):
        clean = validate(patch)
        values = self._read()
        for key, value in clean.items():
            if value is None:
                values.pop(key, None)
            else:
                values[key] = value
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix='.runtime-', dir=self.path.parent)
        try:
            with os.fdopen(fd, 'w') as file:
                json.dump({'version': 1, 'values': values}, file, ensure_ascii=False)
                file.flush()
                os.fsync(file.fileno())
            os.replace(name, self.path)  # mkstemp creates mode 0600; atomic publication.
        finally:
            if os.path.exists(name):
                os.unlink(name)
        return self.describe()

    def safe_export(self):
        """Backup API: portable nonsecret overrides only. No secret value or fingerprint."""
        return {'version': 1, 'values': {k: v for k, v in self._read().items() if k not in SECRETS}}

    def describe(self):
        saved = self._read()
        items = []
        for key in sorted(KEYS):
            configured = key in saved
            row = dict(key=key, sensitive=key in SECRETS, configured=configured,
                       effective_configured=bool(self.environment.get(key)),
                       source='web' if key in self.applied else 'deployment_or_default',
                       apply='restart', pending_restart=saved.get(key) != self.applied.get(key),
                       type='boolean' if key in BOOLS else 'integer' if key in INTS else 'string')
            if key in INTS:
                row.update(min=INTS[key][0], max=INTS[key][1])
            if key not in SECRETS:
                row['value'] = saved.get(key)
                row['effective_value'] = self.environment.get(key)
            items.append(row)
        return {'items': items, 'pending_restart': any(r['pending_restart'] for r in items),
                'deployment_only': list(DEPLOYMENT)}


def load_startup(folder, environment):
    """Precedence: validated saved overrides > loaded .env > process environment > defaults."""
    values = RuntimeConfig(folder)._read()
    for key, value in values.items():
        environment[key] = ('1' if value else '0') if type(value) is bool else str(value)
    return values
