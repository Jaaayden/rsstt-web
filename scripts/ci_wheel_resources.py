"""Fail if a wheel omits a current Web module or frontend resource."""
import argparse
import zipfile
from pathlib import Path


def check(directory):
    wheels = list(directory.glob('*.whl'))
    if len(wheels) != 1:
        raise ValueError('Expected exactly one built wheel')
    root = Path(__file__).resolve().parents[1]
    resources = root / 'src' / 'management'
    extensions = {'.py', '.html', '.js', '.mjs', '.css', '.svg', '.json'}
    expected = {'rsstt/management/' + file.relative_to(resources).as_posix()
                for file in resources.rglob('*') if file.is_file() and file.suffix in extensions}
    with zipfile.ZipFile(wheels[0]) as archive:
        missing = expected - set(archive.namelist())
        if missing:
            raise ValueError('Wheel is missing resources: ' + ', '.join(sorted(missing)))
        assert archive.testzip() is None
    print(f'Wheel contains all {len(expected)} Web modules and resources')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    check(parser.parse_args().directory)
