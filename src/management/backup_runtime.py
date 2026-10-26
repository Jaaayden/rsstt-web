"""Optional PR2 adapter. Only nonsecret overrides; TOKEN is never portable."""
from pathlib import Path


def available():
    try:
        from ..runtime_config import RuntimeConfig
    except ImportError:
        return False
    return True


def export(folder):
    from ..runtime_config import RuntimeConfig
    return RuntimeConfig(folder).safe_export()


def validate(value):
    from ..runtime_config import validate as validate_config, SECRETS
    if not isinstance(value, dict) or set(value) != {'version', 'values'} or value['version'] != 1:
        raise ValueError('Invalid runtime component')
    values = validate_config(value['values'])
    if set(values) & SECRETS:
        raise ValueError('Secret runtime configuration is never included')
    return values


def restore(folder, value):
    from ..runtime_config import RuntimeConfig
    RuntimeConfig(folder).save(validate(value))
