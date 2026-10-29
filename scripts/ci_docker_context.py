"""Verify .dockerignore with a scratch build containing synthetic private files."""
import shutil
import subprocess
import tempfile
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='rsstt-context-ci-') as temporary:
        directory = Path(temporary)
        context, output = directory / 'context', directory / 'output'
        context.mkdir()
        shutil.copyfile(root / '.dockerignore', context / '.dockerignore')
        (context / 'Dockerfile').write_text('FROM scratch\nCOPY . /context/\n')
        private = ('.preview/source/metadata.json', '.preview/snapshot.tar.gz',
                   '.demo/console.sqlite3', '.test-data/private.txt', '.env',
                   '.env.local', '.env.testing', 'config/bot.session', 'node_modules/private.txt')
        for filename in (*private, 'src/management/public.txt'):
            file = context / filename
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('Synthetic build-context fixture\n')
        subprocess.run(['docker', 'buildx', 'build', '--no-cache', '--output',
                        f'type=local,dest={output}', str(context)], check=True, timeout=90)
        leaked = [name for name in private if (output / 'context' / name).exists()]
        if leaked:
            raise ValueError('Docker context includes private fixtures: ' + ', '.join(leaked))
        assert (output / 'context/src/management/public.txt').is_file()
        print('Docker context excludes synthetic preview, credentials, config and dependency files')


if __name__ == '__main__':
    main()
