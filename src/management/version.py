"""RSStT Web's own release version.

The bot core keeps reporting the upstream RSS-to-Telegram-Bot version (env.VERSION);
the console and logs show this one. Release tags must be web-v<WEB_VERSION>
(checked by the publish workflow).
"""
import re
from pathlib import Path

WEB_VERSION = '1.0.1'


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
