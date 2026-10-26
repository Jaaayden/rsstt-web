"""Upgrade an immutable upstream Aerich 0.6 fixture into current schemas."""
import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from ci_bot_smoke import run_smoke


def upgrade(legacy_python, legacy_source, postgres):
    root = Path(__file__).resolve().parents[1]
    if any((folder / '.env').exists() for folder in (root, legacy_source)):
        raise RuntimeError('CI migration fixtures must not contain .env files')
    with tempfile.TemporaryDirectory(prefix='rsstt-migration-ci-') as temporary:
        for label, database in (('sqlite', None), ('postgres', postgres)):
            config = Path(temporary) / label
            config.mkdir()
            url = database or f'sqlite:{config.as_posix()}/db.sqlite3'
            environment = os.environ.copy()
            environment.update(TOKEN='test', MANAGER='1', MULTIPROCESSING='0',
                               WEB_ENABLED='0', DATABASE_URL=url)
            for key in ('DATABASE_PRIVATE_URL', 'DATABASE_PUBLIC_URL', 'TELEGRAPH_TOKEN'):
                environment.pop(key, None)
            subprocess.run([str(legacy_python), '-u', 'telegramRSSbot.py', '-c', str(config)],
                           cwd=legacy_source, env=environment, check=True, timeout=90)
            subprocess.run([sys.executable, '-u', 'telegramRSSbot.py', '-c', str(config)],
                           cwd=root, env=environment, check=True, timeout=90)
            # Verify idempotent modern entry points after the actual upgrade.
            run_smoke(url)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy-python', required=True, type=Path)
    parser.add_argument('--legacy-source', required=True, type=Path)
    parser.add_argument('--postgres', required=True)
    args = parser.parse_args()
    # Resolving the venv's python symlink would select the base interpreter and
    # lose the legacy dependencies installed into that virtual environment.
    upgrade(args.legacy_python.absolute(), args.legacy_source.resolve(), args.postgres)
