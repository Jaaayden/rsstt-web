"""Exercise both Bot entry points and migrations without Telegram login."""
import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def run_smoke(database=None):
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='rsstt-ci-') as temporary:
        config = Path(temporary)
        environment = os.environ.copy()
        environment.update(TOKEN='test', MANAGER='1', MULTIPROCESSING='0',
                           WEB_ENABLED='0', TABLE_TO_IMAGE='1')
        for key in ('DATABASE_URL', 'DATABASE_PRIVATE_URL', 'DATABASE_PUBLIC_URL', 'TELEGRAPH_TOKEN'):
            environment.pop(key, None)
        if database:
            environment['DATABASE_URL'] = database
        commands = (
            [sys.executable, 'telegramRSSbot.py', '-c', str(config)],
            [sys.executable, '-m', 'src', '-c', str(config)],
        )
        for command in commands:
            subprocess.run(command, cwd=root, env=environment, check=True, timeout=90)
        db_url = database or f'sqlite://{config.as_posix()}/db.sqlite3'
        if db_url.startswith('sqlite:') and not db_url.startswith('sqlite://'):
            db_url = 'sqlite://' + db_url[len('sqlite:'):]
        for operation in (['history'], ['heads'], ['upgrade', 'True']):
            subprocess.run([sys.executable, 'scripts/aerich_helper.py', '-u', db_url, *operation],
                           cwd=root, env=environment, check=True, timeout=30)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database')
    run_smoke(parser.parse_args().database)
