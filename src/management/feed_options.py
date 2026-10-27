"""Optional shared feed fetch settings, independent of the upstream schema."""
store = None


async def headers(url):
    if store is None:
        return {}
    rows = await store.rows('SELECT user_agent FROM feed_fetch_options WHERE url=?', (url,))
    return {'User-Agent': rows[0]['user_agent']} if rows else {}
