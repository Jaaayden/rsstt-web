"""Bounded UTC aggregates; no article data or inferred historical counts."""
from datetime import datetime, timedelta, timezone

UTC = timezone.utc
FIELDS = ('fetched', 'delivered', 'failed')
RETENTION = {'hour': 31, 'day': 90}
MAX_BUCKETS = 744


def now_utc():
    return datetime.now(UTC)


def stamp(value):
    return value.astimezone(UTC).isoformat().replace('+00:00', 'Z')


def parse(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('时间必须包含时区。')
    return result.astimezone(UTC)


def floor(value, granularity):
    value = value.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    return value.replace(hour=0) if granularity == 'day' else value


async def initialize(store):
    # Keep the original metrics table and its total row for upgrade compatibility.
    await store.db.execute('''CREATE TABLE IF NOT EXISTS metrics_hourly (
        bucket TEXT PRIMARY KEY, fetched INTEGER NOT NULL DEFAULT 0,
        delivered INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0)''')
    await store.db.execute('INSERT OR IGNORE INTO meta VALUES (?,?)',
                           ('hourly_started_at', stamp(now_utc())))
    await prune(store, now_utc())


async def prune(store, now):
    # Current bucket plus preceding N-1 buckets; indexed range deletes.
    for granularity, table, column in (('hour', 'metrics_hourly', 'bucket'), ('day', 'metrics', 'day')):
        step = timedelta(hours=1) if granularity == 'hour' else timedelta(days=1)
        count = RETENTION[granularity] * (24 if granularity == 'hour' else 1)
        cutoff = floor(now, granularity) - step * (count - 1)
        key = stamp(cutoff) if granularity == 'hour' else cutoff.date().isoformat()
        await store.db.execute(f"DELETE FROM {table} WHERE {column}<? AND {column}!='total'", (key,))


async def increment(store, fetched=0, delivered=0, failed=0, day=None, at=None):
    if any(type(v) is not int or v < 0 for v in (fetched, delivered, failed)):
        raise ValueError('统计增量必须为非负整数。')
    if day is not None and at is not None:
        raise ValueError('day 和 at 不能同时指定。')
    record_hour = day is None
    now = now_utc()
    when = parse(at) if isinstance(at, str) else at or now
    if when.tzinfo is None:
        raise ValueError('时间必须包含时区。')
    when = when.astimezone(UTC)
    if when > now:
        raise ValueError('不能记录未来时间。')
    if day is not None:
        # Existing demo/import callers know only the date: never invent an hour.
        day = datetime.strptime(day, '%Y-%m-%d').date().isoformat()
        if day > now.date().isoformat():
            raise ValueError('不能记录未来日期。')
    else:
        day = when.date().isoformat()
    async with store.lock:
        try:
            await store.db.execute('BEGIN IMMEDIATE')
            for key in ('total', day):
                await store.db.execute('''INSERT INTO metrics VALUES (?,?,?,?) ON CONFLICT(day) DO UPDATE SET
                    fetched=fetched+excluded.fetched, delivered=delivered+excluded.delivered,
                    failed=failed+excluded.failed''', (key, fetched, delivered, failed))
            if record_hour:
                await store.db.execute('''INSERT INTO metrics_hourly VALUES (?,?,?,?) ON CONFLICT(bucket) DO UPDATE SET
                    fetched=fetched+excluded.fetched, delivered=delivered+excluded.delivered,
                    failed=failed+excluded.failed''', (stamp(floor(when, 'hour')), fetched, delivered, failed))
            await prune(store, now)
            await store.db.commit()
        except BaseException:
            await store.db.rollback()
            raise


async def query(store, granularity='hour', start=None, end=None, unavailable=False):
    if granularity not in RETENTION:
        raise ValueError('granularity 必须为 hour 或 day。')
    now = now_utc()
    step = timedelta(hours=1) if granularity == 'hour' else timedelta(days=1)
    end = parse(end) if end else floor(now, granularity) + step
    start = parse(start) if start else end - step * (24 if granularity == 'hour' else 30)
    if start != floor(start, granularity) or end != floor(end, granularity):
        raise ValueError('时间窗口必须按 UTC 小时或日期边界对齐。')
    size = (end - start) / step
    if size <= 0 or size > MAX_BUCKETS:
        raise ValueError(f'时间窗口必须包含 1 至 {MAX_BUCKETS} 个桶。')
    table, column = ('metrics_hourly', 'bucket') if granularity == 'hour' else ('metrics', 'day')
    key = stamp if granularity == 'hour' else lambda d: d.date().isoformat()
    async with store.lock:
        try:
            await store.db.execute('BEGIN IMMEDIATE')
            await prune(store, now)
            async with store.db.execute('SELECT key,value FROM meta') as cursor:
                meta = dict(await cursor.fetchall())
            async with store.db.execute(f'SELECT * FROM {table} WHERE {column}>=? AND {column}<? ORDER BY {column}',
                                        (key(start), key(end))) as cursor:
                rows = {r[column]: dict(r) for r in await cursor.fetchall()}
            async with store.db.execute("SELECT fetched,delivered,failed FROM metrics WHERE day='total'") as cursor:
                row = await cursor.fetchone()
                totals = dict(row) if row else dict.fromkeys(FIELDS, 0)
            await store.db.commit()
        except BaseException:
            await store.db.rollback()
            raise
    since = parse(meta['hourly_started_at' if granularity == 'hour' else 'started_at'])
    retained = floor(now, granularity) - step * (RETENTION[granularity] * (24 if granularity == 'hour' else 1) - 1)
    coverage = max(since, retained)
    buckets = []
    for i in range(int(size)):
        time = start + step * i
        status = ('unavailable' if unavailable or time + step <= coverage or time > now else
                  'partial' if time < coverage or time + step > now else 'available')
        values = rows.get(key(time), dict.fromkeys(FIELDS, 0))
        buckets.append({'start': stamp(time), 'end': stamp(time + step), 'availability': status,
                        **{f: None if status == 'unavailable' else values[f] for f in FIELDS}})
    return {'available': not unavailable, 'timezone': 'UTC', 'granularity': granularity,
            'start': stamp(start), 'end': stamp(end), 'recorded_since': None if unavailable else stamp(since),
            'retained_since': stamp(retained), 'retention_days': RETENTION, 'max_buckets': MAX_BUCKETS,
            'totals': dict.fromkeys(FIELDS) if unavailable else totals,
            'totals_since': None if unavailable else meta['started_at'],
            'history_before_recording': 'unavailable', 'buckets': buckets}


async def usage(store=None):
    """Aggregate in SQL without materializing every user or subscription."""
    from tortoise.functions import Count
    from .. import db
    known = dict(private=0, channel=0, group=0, unknown=0, total=0)
    active = dict(known)
    for query_set, result in ((db.User.all(), known),
                              (db.User.filter(subs__state=1, subs__feed__state=1).exclude(state=-1), active)):
        # Separate by ID sign and upstream explicit state; old negative IDs stay unknown.
        for positive in (True, False):
            rows = await query_set.filter(**{'id__gt' if positive else 'id__lte': 0}).annotate(
                count=Count('id', distinct=True)).group_by('state').values('state', 'count')
            for row in rows:
                kind = 'private' if positive else {50: 'channel', 51: 'group'}.get(row['state'], 'unknown')
                result[kind] += row['count']
                result['total'] += row['count']
    if store is not None:
        # The management and upstream databases may use different engines. Read
        # verified metadata in bounded keyset pages and aggregate corrections in
        # the upstream database; never load subscription rows or all target IDs.
        after = ''
        while True:
            metadata = await store.rows("""SELECT id,kind FROM targets
                WHERE id>? AND membership IN ('known','available','joined')
                AND kind IN ('private','channel','group') ORDER BY id LIMIT 400""", (after,))
            if not metadata:
                break
            after = metadata[-1]['id']
            for verified_kind in ('private', 'channel', 'group'):
                ids = []
                for target in metadata:
                    if target['kind'] != verified_kind:
                        continue
                    try:
                        ident = int(target['id'])
                    except ValueError:
                        continue
                    if (ident > 0 and verified_kind == 'private') or (ident < 0 and verified_kind != 'private'):
                        ids.append(ident)
                if not ids:
                    continue
                for query_set, result in ((db.User.filter(id__in=ids), known),
                        (db.User.filter(id__in=ids, subs__state=1, subs__feed__state=1).exclude(state=-1), active)):
                    rows = await query_set.annotate(count=Count('id', distinct=True)).group_by('state').values('state', 'count')
                    for row in rows:
                        previous = ('private' if verified_kind == 'private' else
                                    {50: 'channel', 51: 'group'}.get(row['state'], 'unknown'))
                        result[previous] -= row['count']
                        result[verified_kind] += row['count']
    count = await db.Sub.filter(state=1, feed__state=1).exclude(user__state=-1).count()
    if store is not None:
        after = ''
        while True:
            departed = await store.rows("""SELECT id FROM targets WHERE id>?
                AND membership IN ('left','banned','disabled') ORDER BY id LIMIT 400""", (after,))
            if not departed:
                break
            after = departed[-1]['id']
            ids = []
            for row in departed:
                try:
                    ids.append(int(row['id']))
                except ValueError:
                    continue
            if not ids:
                continue
            eligible = db.User.filter(id__in=ids, subs__state=1, subs__feed__state=1).exclude(state=-1)
            for positive in (True, False):
                rows = await eligible.filter(**{'id__gt' if positive else 'id__lte': 0}).annotate(
                    count=Count('id', distinct=True)).group_by('state').values('state', 'count')
                for row in rows:
                    previous = 'private' if positive else {50: 'channel', 51: 'group'}.get(row['state'], 'unknown')
                    active[previous] -= row['count']
                    active['total'] -= row['count']
            count -= await db.Sub.filter(user_id__in=ids, state=1, feed__state=1).exclude(user__state=-1).count()
    return {'known': known, 'active': active, 'active_subscriptions': count,
            'definition': 'subscription.state=1 AND feed.state=1 AND user.state!=-1 AND bot_not_departed',
            'unknown_type': '未核验类型的群组/频道；不按 ID 推测具体类型'}
