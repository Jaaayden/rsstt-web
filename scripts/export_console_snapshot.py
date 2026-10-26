"""Read-only SQLite snapshot to stdout; Python 3.11+, no third-party dependencies.

Can run over SSH stdin without installing or writing anything on the server.
The archive contains the subscription database and cached display names only.
"""
import argparse
import hashlib
import io
import json
import sqlite3
import sys
import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path


def export(database, session, output):
    deadline = time.monotonic() + 30

    def progress(*_):
        if time.monotonic() > deadline:
            raise TimeoutError('Snapshot timed out; the source has not been modified')

    source = sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True, timeout=3)
    snapshot = sqlite3.connect(':memory:')
    try:
        source.execute('PRAGMA query_only=ON')
        source.backup(snapshot, pages=256, progress=progress, sleep=0.05)
    finally:
        source.close()
    try:
        tables = {r[0] for r in snapshot.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        expected = {'aerich', 'feed', 'option', 'sub', 'user'}
        if not expected <= tables or tables - expected - {'sqlite_sequence'}:
            raise ValueError('Expected an unmodified RSStT subscription database')
        if snapshot.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('Snapshot integrity check failed')
        users = dict(snapshot.execute('SELECT id,state FROM user'))
        counts = {table: snapshot.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
                  for table in ('user', 'feed', 'sub')}
        # A serialized in-memory backup has no WAL file; normalize the header too.
        snapshot.execute('PRAGMA journal_mode=DELETE')
        database_bytes = snapshot.serialize()
    finally:
        snapshot.close()

    names = []
    if session and users:
        cache = sqlite3.connect(session.resolve().as_uri() + '?mode=ro', uri=True, timeout=3)
        try:
            cache.execute('PRAGMA query_only=ON')
            # Never select phone numbers, access hashes, or the sessions/auth_key table.
            identifiers = list(users)
            for start in range(0, len(identifiers), 500):
                batch = identifiers[start:start + 500]
                placeholders = ','.join('?' for _ in batch)
                for ident, name, username in cache.execute(
                        f'SELECT id,name,username FROM entities WHERE id IN ({placeholders})', batch):
                    names.append(dict(id=str(ident), title=name, username=username))
        finally:
            cache.close()

    metadata = dict(format=1, captured_at=datetime.now(timezone.utc).isoformat(), counts=counts,
                    sha256=hashlib.sha256(database_bytes).hexdigest(), targets=names)
    with tarfile.open(fileobj=output, mode='w|gz') as archive:
        for name, data in (('db.sqlite3', database_bytes),
                           ('metadata.json', json.dumps(metadata, ensure_ascii=False).encode())):
            entry = tarfile.TarInfo(name)
            entry.size, entry.mode = len(data), 0o400
            archive.addfile(entry, io.BytesIO(data))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True, type=Path)
    parser.add_argument('--session', type=Path, help='Optional Telethon session; read display names only')
    args = parser.parse_args()
    export(args.database, args.session, sys.stdout.buffer)


if __name__ == '__main__':
    main()
