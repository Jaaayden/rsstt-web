"""Web-facing operations reuse the same models and scheduler as Telegram commands."""
import asyncio
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit

from lxml import etree
from tortoise.expressions import Q
from tortoise.functions import Count

from .. import db, env
from ..command import inner
from ..command.inner.customization import SUB_OPTIONS_EXHAUSTIVE_VALUES


class Problem(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status
        super().__init__(message)


def integer(value, name, minimum, maximum):
    if isinstance(value, bool) or not re.fullmatch(r'-?\d+', str(value)):
        raise Problem(f'{name}必须是整数。')
    value = int(value)
    if not minimum <= value <= maximum:
        raise Problem(f'{name}应在 {minimum}–{maximum} 之间。')
    return value


def chat_id(value):
    return integer(value, '会话 ID', -(2**53 - 1), 2**53 - 1)


def feed_url(value):
    if not isinstance(value, str) or len(value) > 4096 or any(c.isspace() for c in value):
        raise Problem('请填写完整的 RSS 网址。')
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError()
        _ = parsed.port
    except ValueError:
        raise Problem('订阅地址只支持不含用户名、密码的 HTTP / HTTPS 网址。')
    return value


def kind(user):
    return 'private' if user.id > 0 else 'channel' if user.state == 50 else 'group' if user.state == 51 else 'unknown'


def options(obj):
    return {key: getattr(obj, key) for key in (*SUB_OPTIONS_EXHAUSTIVE_VALUES, 'interval', 'length_limit')}


class TelegramGateway:
    """Uses the running Telethon client; never starts another Telegram receiver."""
    async def inspect(self, ident):
        from telethon.tl.types import Channel, Chat
        from telethon.utils import get_display_name
        try:
            entity = await env.bot.get_entity(ident)
            target_kind = 'channel' if isinstance(entity, Channel) and entity.broadcast else 'group' if isinstance(entity, (Channel, Chat)) else 'private'
            if target_kind != 'private':
                permissions = await env.bot.get_permissions(entity, 'me')
                if permissions.has_left or permissions.is_banned:
                    raise Problem('机器人已经离开这个会话。', 409)
                if target_kind == 'channel' and not (permissions.is_creator or permissions.post_messages):
                    raise Problem('机器人没有在这个频道发布消息的权限。', 409)
                restrictions = getattr(entity, 'default_banned_rights', None)
                if target_kind == 'group' and not permissions.is_admin and restrictions and restrictions.send_messages:
                    raise Problem('群组当前禁止机器人发送消息。', 409)
            return dict(id=str(ident), title=get_display_name(entity), username=getattr(entity, 'username', None),
                        kind=target_kind, membership='known' if target_kind == 'private' else 'available')
        except Problem:
            raise
        except Exception:
            raise Problem('无法访问这个会话。请确认机器人已加入，并具有相应权限。', 409)

    async def leave(self, ident):
        from ..command.utils import leave_chat
        if not await leave_chat(ident):
            raise Problem('Telegram 未确认退出，请刷新会话状态后重试。', 502)

    def status(self):
        peer = env.bot_peer
        return {'connected': bool(env.bot and env.bot.is_connected()),
                'name': getattr(peer, 'first_name', 'RSStT'), 'username': getattr(peer, 'username', None)}


class Service:
    def __init__(self, store, gateway=None, demo=False):
        self.store = store
        self.gateway = gateway or TelegramGateway()
        self.demo = demo
        # Serializes web writes (including subscription limits and idempotent adds).
        # Telegram commands retain their own upstream safeguards and DB uniqueness.
        self.mutation = asyncio.Lock()
        self.started = datetime.now(timezone.utc)

    async def threshold(self):
        return int((await self.store.settings())['attention_threshold'])

    @staticmethod
    def scope(query, principal, field='user_id'):
        targets = principal['targets']
        return query if targets is None else query.filter(**{f'{field}__in': list(map(int, targets))})

    @staticmethod
    def allowed(principal, ident):
        if principal['targets'] is not None and str(ident) not in principal['targets']:
            raise Problem('连接授权不包含这个会话。', 403)

    async def user(self, ident, principal):
        ident = chat_id(ident)
        self.allowed(principal, ident)
        user = await db.User.get_or_none(id=ident)
        if not user:
            raise Problem('找不到这个会话。', 404)
        return user

    async def subscription(self, ident, principal):
        sub = await self.scope(db.Sub.filter(id=integer(ident, '订阅 ID', 1, 2**31 - 1)), principal).select_related('feed', 'user').first()
        if not sub:
            raise Problem('找不到订阅，或连接授权不包含该订阅。', 404)
        return sub

    async def target_data(self, users):
        ids = [u.id for u in users]
        metadata = await self.store.target_map(ids)
        counts = {str(r['user_id']): r['n'] for r in await db.Sub.filter(user_id__in=ids).group_by('user_id').annotate(n=Count('id')).values('user_id', 'n')}
        attention = {str(r['user_id']): r['n'] for r in await db.Sub.filter(user_id__in=ids, state=1, feed__error_count__gte=await self.threshold()).group_by('user_id').annotate(n=Count('id')).values('user_id', 'n')}
        return [dict(id=str(u.id), title=metadata.get(str(u.id), {}).get('title') or f'会话 {u.id}',
                     kind=metadata.get(str(u.id), {}).get('kind', kind(u)),
                     membership=metadata.get(str(u.id), {}).get('membership', 'unknown'),
                     username=metadata.get(str(u.id), {}).get('username'),
                     checked_at=metadata.get(str(u.id), {}).get('checked_at'), state=u.state,
                     sub_limit=u.sub_limit, lang=u.lang,
                     role=('manager' if u.id in env.MANAGER else 'banned' if u.state == -1 else
                           'admin' if u.id > 0 and u.state == 100 else 'guest' if u.state == 0 else 'user'),
                     role_protected=u.id in env.MANAGER, subscriptions=counts.get(str(u.id), 0),
                     attention=attention.get(str(u.id), 0), options=options(u)) for u in users]

    async def targets(self, principal, query):
        qs = self.scope(db.User.all(), principal, 'id')
        search = query.get('q', '').strip()[:200]
        if search:
            matches = await self.store.rows('SELECT id FROM targets WHERE title LIKE ? OR username LIKE ?', (f'%{search}%', f'%{search}%'))
            ids = [int(r['id']) for r in matches]
            if re.fullmatch(r'-?\d+', search):
                ids.append(chat_id(search))
            qs = qs.filter(id__in=ids)
        target_kind = query.get('kind')
        if target_kind in ('channel', 'group'):
            records = await self.store.rows('SELECT id, kind FROM targets')
            known = [int(r['id']) for r in records]
            matches = [int(r['id']) for r in records if r['kind'] == target_kind]
            qs = qs.filter(Q(id__in=matches) | (Q(state=50 if target_kind == 'channel' else 51) & ~Q(id__in=known)))
        elif target_kind == 'private':
            qs = qs.filter(id__gt=0)
        page, size = self.pagination(query)
        return {'total': await qs.count(), 'page': page, 'size': size,
                'items': await self.target_data(await qs.order_by('-created_at', 'id').offset((page - 1) * size).limit(size))}

    @staticmethod
    def pagination(query):
        return integer(query.get('page', 1), '页码', 1, 100000), integer(query.get('size', 20), '每页数量', 1, 100)

    def sub_query(self, principal, query):
        qs = self.scope(db.Sub.all(), principal)
        if query.get('target'):
            ident = chat_id(query['target'])
            self.allowed(principal, ident)
            qs = qs.filter(user_id=ident)
        if query.get('q'):
            search = query['q'].strip()[:200]
            qs = qs.filter(Q(title__icontains=search) | Q(feed__title__icontains=search) | Q(feed__link__icontains=search))
        if query.get('state') in ('0', '1'):
            qs = qs.filter(state=int(query['state']))
        return qs

    async def sub_data(self, subs):
        metadata = await self.store.target_map(list({s.user_id for s in subs}))
        return [dict(id=s.id, target=str(s.user_id), target_title=metadata.get(str(s.user_id), {}).get('title') or str(s.user_id),
                     title=s.title or s.feed.title, custom_title=s.title, url=s.feed.link, state=s.state,
                     tags=s.tags, errors=s.feed.error_count, feed_state=s.feed.state,
                     updated_at=s.feed.updated_at.isoformat(), next_check=s.feed.next_check_time.isoformat() if s.feed.next_check_time else None,
                     effective_interval=s.interval or s.user.interval or db.EffectiveOptions.default_interval,
                     options=options(s)) for s in subs]

    async def subscriptions(self, principal, query):
        qs = self.sub_query(principal, query)
        if query.get('attention') == '1':
            qs = qs.filter(state=1, feed__error_count__gte=await self.threshold())
        page, size = self.pagination(query)
        return {'total': await qs.count(), 'page': page, 'size': size,
                'items': await self.sub_data(await qs.select_related('feed', 'user').order_by('-id').offset((page - 1) * size).limit(size))}

    async def refresh(self, ident, principal):
        user = await self.user(ident, principal)
        data = await self.gateway.inspect(user.id)
        await self.store.target(**{k: data[k] for k in ('title', 'username', 'kind', 'membership')}, ident=user.id)
        # Telegram entity type is metadata, not an account permission change.
        # Keep explicit guest/user/banned states intact, including add() refreshes.
        return (await self.target_data([user]))[0]

    async def register(self, ident, principal):
        ident = chat_id(ident)
        data = await self.gateway.inspect(ident)
        user, _ = await db.User.get_or_create(id=ident, defaults={'state': 50 if data['kind'] == 'channel' else 51 if data['kind'] == 'group' else 1})
        await self.store.target(ident, data['title'], data['username'], data['kind'], data['membership'])
        return (await self.target_data([user]))[0]

    async def add(self, ident, urls, principal):
        user = await self.user(ident, principal)
        if user.state == -1:
            raise Problem('这个用户已被封禁。', 409)
        if not isinstance(urls, list) or not 1 <= len(urls) <= 100:
            raise Problem('每次可添加 1–100 个订阅地址。')
        urls = list(dict.fromkeys(feed_url(url) for url in urls))
        await self.refresh(user.id, principal)
        results = []
        for url in urls:
            existing = await db.Sub.filter(user_id=user.id, feed__link=url).first()
            if existing:
                results.append({'url': url, 'status': 'existing', 'id': existing.id})
                continue  # Retrying must not reset title, formatting, or paused state.
            reached, _, _, _ = await inner.utils.check_sub_limit(user.id)
            if reached:
                results.append({'url': url, 'status': 'failed', 'message': '已达到此会话的订阅数量上限。'})
                continue
            result = await inner.sub.sub(user.id, url, lang=user.lang)
            results.append({'url': url, 'status': 'created', 'id': result['sub'].id} if result['sub'] else
                           {'url': url, 'status': 'failed', 'message': str(result['msg'] or '无法读取订阅源。')})
        return {'results': results}

    async def patch(self, obj, values):
        if not isinstance(values, dict) or not values:
            raise Problem('没有可保存的设置。')
        is_sub = isinstance(obj, db.Sub)
        allowed = set(SUB_OPTIONS_EXHAUSTIVE_VALUES) | {'interval', 'length_limit'} | ({'title', 'tags', 'state'} if is_sub else {'sub_limit', 'lang'})
        if set(values) - allowed:
            raise Problem('包含不支持的设置项。')
        clean = {}
        for key, value in values.items():
            if key == 'lang':
                from ..i18n import ALL_LANGUAGES
                if value not in (*ALL_LANGUAGES, 'null'):
                    raise Problem('语言代码无效。')
                clean[key] = value
            elif key in ('title', 'tags'):
                if value is not None and (not isinstance(value, str) or len(value) > (1024 if key == 'title' else 255)):
                    raise Problem('标题或标签过长。')
                clean[key] = value or None
            elif key in ('interval', 'sub_limit') and value is None:
                clean[key] = None
            else:
                value = integer(value, key, -100, 32767)
                valid = SUB_OPTIONS_EXHAUSTIVE_VALUES.get(key)
                if valid and value not in (*valid, *([-100] if is_sub else [])):
                    raise Problem(f'{key} 的选项无效。')
                if key == 'state' and value not in (0, 1):
                    raise Problem('订阅状态无效。')
                if key == 'interval' and not db.EffectiveOptions.minimal_interval <= value <= 32767:
                    raise Problem(f'更新间隔不能小于 {db.EffectiveOptions.minimal_interval} 分钟。')
                if key == 'sub_limit' and value < -1:
                    raise Problem('订阅上限应为 -1（不限）或非负整数。')
                if key == 'length_limit' and not (0 <= value <= 4096 or (is_sub and value == -100)):
                    raise Problem('长度阈值应为 0–4096。')
                clean[key] = value
        if is_sub and clean.get('state') == 1:
            user = await db.User.get(id=obj.user_id)
            if user.state == -1:
                raise Problem('这个用户已被封禁。', 409)
        for key, value in clean.items():
            setattr(obj, key, value)
        await obj.save(update_fields=list(clean))
        if 'interval' in clean or 'state' in clean:
            if is_sub:
                await inner.utils.update_interval(obj)
            else:
                async for feed in db.Feed.filter(subs__user_id=obj.id, subs__interval__isnull=True).distinct():
                    await inner.utils.update_interval(feed)

    async def delete(self, sub):
        result = await inner.sub.unsub(sub.user_id, sub_id=sub.id)
        if not result['sub']:
            raise Problem('取消订阅失败，请刷新后重试。', 409)

    async def leave(self, user):
        if user.id > 0:
            raise Problem('机器人不能退出私聊，可暂停或取消该用户的订阅。')
        await self.gateway.leave(user.id)
        await inner.utils.activate_or_deactivate_all_subs(user.id, activate=False)
        meta = (await self.store.target_map([user.id])).get(str(user.id), {})
        await self.store.target(user.id, meta.get('title', str(user.id)), meta.get('username'), meta.get('kind', kind(user)), 'left')

    async def export(self, user):
        return await inner.sub.export_opml(user.id) or b'<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>RSStT</title></head><body/></opml>'

    @staticmethod
    def parse_opml(data):
        if not isinstance(data, str) or len(data.encode()) > 512 * 1024:
            raise Problem('OPML 文件不能超过 512 KB。')
        try:
            parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False)
            root = etree.fromstring(data.encode(), parser)
            if root.getroottree().docinfo.doctype or root.tag != 'opml':
                raise ValueError()
            urls = list(dict.fromkeys(root.xpath('.//outline/@xmlUrl')))
        except (etree.XMLSyntaxError, ValueError):
            raise Problem('不是有效的 OPML 文件，或文件包含不允许的 DTD。')
        if not 1 <= len(urls) <= 100:
            raise Problem('一次导入最多 100 个订阅，请拆分较大的文件。')
        return [feed_url(url) for url in urls]
