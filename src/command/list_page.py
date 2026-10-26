"""Bounded Telegram /list rendering. No Telegram or management dependencies."""
from html import escape
from urllib.parse import urlsplit

from .. import db

TEXT_LIMIT = 4096  # Conservative UTF-16 budget, including heading and newlines.
ENTITY_LIMIT = 100
TITLE_LIMIT = 1024
URL_LIMIT = 2048  # Conservative UTF-8 budget; never truncate a destination URL.
BATCH_SIZE = 256


def utf16_length(text):
    return len(text.encode('utf-16-le')) // 2


def short_text(text, limit):
    # Normalise whitespace so titles cannot inject blank paragraphs. Remove lone
    # surrogates from corrupt imports before asking Telethon to encode the text.
    text = ' '.join(str(text).encode('utf-8', 'replace').decode().split())
    if utf16_length(text) <= limit:
        return text
    return text.encode('utf-16-le')[:(limit - 1) * 2].decode('utf-16-le', 'ignore') + '…'


def render_entry(title, url):
    label = short_text(title or '', TITLE_LIMIT) or short_text(url or '—', TITLE_LIMIT) or '—'
    try:
        parsed = urlsplit(url)
        linked = (parsed.scheme in ('http', 'https') and parsed.hostname
                  and not any(c.isspace() or ord(c) < 32 for c in url)
                  and len(url.encode('utf-8')) <= URL_LIMIT)
    except (ValueError, UnicodeError, TypeError):
        linked = False
    # Very long/invalid URLs stay in the database and OPML, but are not sent as
    # invalid Telegram entities. Escape quotes as well as text metacharacters.
    html = f'<a href="{escape(url, quote=True)}">{escape(label)}</a>' if linked else escape(label)
    return html, utf16_length(label), int(bool(linked))


async def get_list_page(user_id, page_number, heading):
    """Return (clamped page, page count, HTML, subscription count).

    Recompute boundaries on each request in descending subscription ID order.
    Keyset batches avoid loading all ORM models or retaining every rendered page.
    Rendering visits O(n) rows for an exact page count; memory is O(batch + one
    page). Database sort costs depend on the upstream schema and query planner.
    """
    wanted = max(1, page_number)
    heading = short_text(heading, 256)
    prefix = f'<b>{escape(heading)}</b>\n'
    base_length = utf16_length(heading) + 1
    lines, length, entities = [], base_length, 1
    page_count = total = 0
    selected = last = ''
    before = None
    while True:
        query = db.Sub.filter(user_id=user_id)
        if before is not None:
            query = query.filter(id__lt=before)
        rows = await query.order_by('-id').limit(BATCH_SIZE).values('id', 'title', 'feed__title', 'feed__link')
        if not rows:
            break
        for row in rows:
            html, units, count = render_entry(row['title'] or row['feed__title'], row['feed__link'])
            if lines and (length + 1 + units > TEXT_LIMIT or entities + count > ENTITY_LIMIT):
                page_count += 1
                last = prefix + '\n'.join(lines)
                if page_count == wanted:
                    selected = last
                lines, length, entities = [], base_length, 1
            length += units + bool(lines)
            entities += count
            lines.append(html)
            total += 1
        before = rows[-1]['id']
        if len(rows) < BATCH_SIZE:
            break
    if lines:
        page_count += 1
        last = prefix + '\n'.join(lines)
        if page_count == wanted:
            selected = last
    return min(wanted, page_count), page_count, selected or last, total
