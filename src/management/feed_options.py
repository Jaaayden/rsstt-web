"""Optional shared feed fetch settings, independent of the upstream schema.

Per feed URL: a User-Agent and a proxy. The proxy is held in memory as well, so
the fetch path never touches the database to find it.
"""
import re
from urllib.parse import urlsplit

store = None
DIRECT = 'direct'
INVALID = ('代理地址无效。请填写 direct，或形如 socks5://主机:端口、http://用户名:密码@主机:端口 的地址，'
           '支持 http、socks4、socks5、socks5h，不能包含路径或参数。')
_proxies = {}


async def headers(url):
    if store is None:
        return {}
    rows = await store.rows('SELECT user_agent FROM feed_fetch_options WHERE url=?', (url,))
    return {'User-Agent': rows[0]['user_agent']} if rows else {}


def proxy_for(url):
    """Resolver installed into src.web.req: None = follow the global rules, False = direct, str = proxy URL."""
    value = _proxies.get(url)
    return None if value is None else False if value == DIRECT else value


def check(value):
    """Return a clean proxy setting (DIRECT or a proxy URL), or raise ValueError."""
    if not isinstance(value, str) or not value.strip() or len(value) > 4096 or re.search(r'[\x00-\x20\x7f]', value.strip()):
        raise ValueError('proxy')
    value = value.strip()
    if value.lower() == DIRECT:
        return DIRECT
    url = urlsplit(value)
    if url.scheme not in ('http', 'socks4', 'socks5', 'socks5h') or not url.hostname:
        raise ValueError('proxy')
    if url.path not in ('', '/') or url.query or url.fragment:
        raise ValueError('proxy')
    _ = url.port  # ValueError for an invalid port
    return value


def describe(url):
    """What the console may show: the mode and the host, never credentials."""
    value = _proxies.get(url)
    if value is None:
        return {'mode': 'inherit', 'host': None}
    if value == DIRECT:
        return {'mode': 'direct', 'host': None}
    parts = urlsplit(value)
    return {'mode': 'custom', 'host': f'{parts.hostname}:{parts.port}' if parts.port else parts.hostname,
            'scheme': parts.scheme}


async def load(db):
    """Fill the in-memory table from the console database (at start-up)."""
    _proxies.clear()
    for row in await db.rows('SELECT url, proxy FROM feed_proxies'):
        _proxies[row['url']] = row['proxy']


async def save_proxy(db, url, value):
    """value None = back to the global rules; DIRECT or a proxy URL otherwise."""
    if value is None:
        await db.execute('DELETE FROM feed_proxies WHERE url=?', (url,))
        _proxies.pop(url, None)
    else:
        await db.execute('INSERT INTO feed_proxies(url, proxy) VALUES (?,?) '
                         'ON CONFLICT(url) DO UPDATE SET proxy=excluded.proxy', (url, value))
        _proxies[url] = value
