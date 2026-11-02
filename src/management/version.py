"""RSStT Web's own release version.

The console and logs show this version plus the upstream RSS-to-Telegram-Bot
release it is based on (core()). Release tags must be web-v<WEB_VERSION>
(checked by the publish workflow).
"""
import re
from pathlib import Path

WEB_VERSION = '1.0.2'


def core():
    """The upstream RSS-to-Telegram-Bot release this build is based on.

    env.VERSION is not used: upstream's parser returns the raw build string for
    some commits and falls back to the package version for others.
    """
    from ..version import __version__
    return f'v{__version__}'


def build():
    """Short commit of this build, from the .version file the Docker image writes."""
    try:
        line = (Path(__file__).resolve().parents[2] / '.version').read_text().splitlines()[0]
    except (OSError, IndexError):
        return None
    commit = line.strip().split('@', 1)[0]
    return commit if re.fullmatch(r'[0-9a-f]{7,40}', commit) else None


def label():
    commit = build()
    return f'RSStT Web {WEB_VERSION}' + (f' ({commit})' if commit else '')
