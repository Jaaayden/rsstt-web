"""Exercise real process startup without Telegram, RSS fetches or production data."""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest


async def test_web_staging_then_real_offline_process_restart(tmp_path):
    root = Path(__file__).resolve().parents[2]
    origin = 'http://127.0.0.1:8746'
    environment = {**os.environ, 'WEB_PORT': '8746', 'WEB_DEMO_CONFIG': str(tmp_path),
                   'EXECUTOR_NICENESS_INCREMENT': '0'}
    cookie = ''
    process = None
    # Refuse to touch a pre-existing listener. The fixture owns only its child.
    import socket
    with socket.socket() as guard:
        try:
            guard.bind(('127.0.0.1', 8746))
        except OSError:
            pytest.fail('Independent backup test port 8746 is already occupied')

    def request(path, method='GET', data=None, extra=None):
        payload = data if isinstance(data, bytes) else json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(origin + path, data=payload, method=method,
                                     headers={'Origin': origin, 'Content-Type': 'application/json', 'Cookie': cookie, **(extra or {})})
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.headers, response.read()

    def start():
        child = subprocess.Popen([sys.executable, '-m', 'src.management.demo'], cwd=root,
                                 env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                if child.poll() is not None:
                    raise AssertionError('Offline child exited before startup')
                try:
                    request('/api/public')
                    return child
                except (OSError, urllib.error.URLError):
                    time.sleep(.1)
            raise AssertionError('Offline child startup timed out')
        except BaseException:
            child.terminate()
            child.wait(timeout=10)
            raise

    def login():
        headers, _ = request('/api/login', 'POST', {'password': 'rsstt-local-preview'})
        return headers['Set-Cookie'].split(';', 1)[0]

    try:
        process = start()
        cookie = login()
        _, raw = request('/api/backups/export', 'POST', {})
        _, data = request('/api/subscriptions?size=1')
        sub = json.loads(data)['items'][0]
        request('/api/subscriptions/' + str(sub['id']), 'PATCH', {'title': 'changed after backup'})
        request('/api/settings', 'PATCH', {'attention_threshold': 9})
        _, summary = request('/api/backups/preflight', 'POST', raw)
        digest = json.loads(summary)['sha256']
        _, staged = request('/api/backups/restore', 'POST', raw, {'X-Backup-SHA256': digest})
        assert json.loads(staged)['applied'] is False
        process.terminate()
        process.wait(timeout=10)
        process = start()
        with pytest.raises(urllib.error.HTTPError) as error:
            request('/api/backups')
        assert error.value.code == 401
        cookie = login()
        _, status = request('/api/backups')
        assert json.loads(status)['restore']['status'] == 'succeeded'
        _, settings = request('/api/settings')
        assert json.loads(settings)['console']['attention_threshold'] == '3'
        _, listing = request('/api/subscriptions?size=100')
        restored = next(item for item in json.loads(listing)['items'] if item['id'] == sub['id'])
        assert restored['title'] == sub['title']
        assert not (tmp_path / '.restore-pending.json').exists()
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            process.wait(timeout=10)
