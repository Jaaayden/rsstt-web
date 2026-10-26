"""Authenticated, same-origin API and dependency-free static web application."""
import asyncio
import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import web

from .. import db, env
from ..command import inner
from . import metrics
from .service import Problem, Service, chat_id, integer
from .store import Store
from .auth import Auth, revoke_browser_sessions
from .agent_contract import authorize_agent, openapi

LOGGER = logging.getLogger('RSStT.management')
STATIC = Path(__file__).parent / 'static'
SAFE = {'GET', 'HEAD', 'OPTIONS'}


async def body(request):
    if request.content_type != 'application/json':
        raise Problem('请求必须使用 application/json。', 415)
    try:
        result = await request.json()
    except (ValueError, UnicodeError):
        raise Problem('JSON 格式错误。')
    if not isinstance(result, dict):
        raise Problem('请求内容必须是 JSON 对象。')
    return result


def admin(request):
    if request['principal']['kind'] != 'session' or request['principal']['permission'] != 'admin':
        raise Problem('此操作需要管理台管理员权限。', 403)


async def create_app(store, password, origin, gateway=None, demo=False, snapshot=None):
    parsed = urlsplit(origin)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        raise ValueError('WEB_ORIGIN must be an absolute HTTP(S) origin without a path')
    origin = origin.rstrip('/')
    if snapshot and (not demo or parsed.hostname != '127.0.0.1'):
        raise ValueError('Snapshot preview requires local offline demo mode')
    # Cookies are shared across ports; keep parallel local previews independent.
    cookie_name = f'rsstt_session_{parsed.port}' if demo else 'rsstt_session'
    service = Service(store, gateway, demo)
    from ..runtime_config import RuntimeConfig, ConfigError
    runtime = RuntimeConfig(store.path.parent,
                            applied=getattr(env, 'RUNTIME_CONFIG_OVERRIDES', {}),
                            environment=getattr(env, 'RUNTIME_CONFIG_ENVIRONMENT', {}))
    auth = await Auth.load(store, password, "preview-admin" if demo else "admin")
    # Re-authenticate after restart/password rotation; integration tokens persist.
    await revoke_browser_sessions(store)

    @web.middleware
    async def boundary(request, handler):
        try:
            if request.path.startswith('/api/'):
                if request.path not in ('/api/login', '/api/public'):
                    bearer = request.headers.get('Authorization', '')
                    secret = bearer[7:] if bearer.startswith('Bearer ') else '' if bearer else request.cookies.get(cookie_name, '')
                    principal = await store.credential(secret) if secret else None
                    if not principal or (bearer and principal['kind'] != 'token') or (not bearer and principal['kind'] != 'session'):
                        raise Problem('请先登录管理台。', 401)
                    request['principal'] = principal
                    if bearer:
                        authorize_agent(request, principal)
                    if request.method not in SAFE:
                        if principal['permission'] == 'read':
                            raise Problem('这个连接授权只有读取权限。', 403)
                        if not bearer and request.headers.get('Origin') != origin:
                            raise Problem('请求来源不匹配，请通过配置的管理台地址访问。', 403)
                elif request.path == '/api/login' and request.headers.get('Origin') != origin:
                    raise Problem('登录来源与 WEB_ORIGIN 不匹配。', 403)
            response = await handler(request)
        except Problem as error:
            response = web.json_response({'error': error.message, 'code': getattr(error, 'code', None) or {400: 'INVALID_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 415: 'UNSUPPORTED_MEDIA_TYPE', 429: 'RATE_LIMITED'}.get(error.status, 'REQUEST_FAILED')}, status=error.status)
        except web.HTTPException as error:
            response = web.json_response({'error': '请求过大。' if error.status == 413 else '请求地址或方法无效。', 'code': 'PAYLOAD_TOO_LARGE' if error.status == 413 else 'INVALID_ROUTE'}, status=error.status)
        except Exception:
            LOGGER.exception('Console request failed: %s %s', request.method, request.path)
            response = web.json_response({'error': '操作未完成，请查看服务日志后重试。', 'code': 'INTERNAL_ERROR'}, status=500)
        if request.get('principal', {}).get('kind') == 'token':
            await store.audit(request['principal']['id'], 'agent_request', f"{request.method} {request.match_info.route.resource.canonical if request.match_info.route.resource else '/unknown'} {response.status}")
        response.headers.update({
            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        })
        return response

    app = web.Application(middlewares=[boundary], client_max_size=600 * 1024)
    app[web.AppKey('service', Service)] = service
    routes = web.RouteTableDef()

    @routes.get('/api/public')
    async def public(request):
        return web.json_response({'demo': demo, 'snapshot': snapshot})

    @routes.post('/api/login')
    async def login(request):
        values = await body(request)
        async with auth.change_lock:
            await auth.verify(values.get('password'), request.remote)
            await store.execute("DELETE FROM credentials WHERE kind='session' AND id NOT IN (SELECT id FROM credentials WHERE kind='session' ORDER BY created_at DESC LIMIT 19)")
            if values.get('username', auth.username) != auth.username:
                raise Problem('登录凭据不正确。', 401)
            _, secret = await store.issue(auth.username, days=1 / 3)
        await store.audit(auth.username, 'login', 'success')
        response = web.json_response({'ok': True})
        response.set_cookie(cookie_name, secret, httponly=True, secure=parsed.scheme == 'https', samesite='Strict', max_age=28800, path='/')
        return response

    @routes.get('/api/session')
    async def session(request):
        p = request['principal']
        return web.json_response({'name': p['name'], 'permission': p['permission'], 'targets': p['targets'], 'demo': demo, 'account_type': 'agent' if p['kind'] == 'token' else 'preview_admin' if demo else 'console_admin', 'expires_at': p['expires_at'], 'capabilities': ['subscriptions:read', 'subscriptions:write'] if p['permission'] == 'write' else ['subscriptions:read'] if p['permission'] == 'read' else ['console:admin']})

    @routes.get('/api/auth/account')
    async def account(request):
        admin(request)
        return web.json_response({'username': auth.username, 'account_type': 'preview_admin' if demo else 'console_admin'})

    @routes.post('/api/auth/password')
    async def password_change(request):
        admin(request)
        values = await body(request)
        async with auth.change_lock:
            await auth.verify(values.get('current_password'), request.remote)
            await auth.change(values.get('new_password'))
        await store.audit(auth.username, 'password_changed', 'all browser sessions revoked')
        response = web.json_response({'ok': True})
        response.del_cookie(cookie_name)
        return response

    @routes.get('/api/auth/sessions')
    async def sessions(request):
        admin(request)
        return web.json_response({'items': await store.rows("SELECT id,name,created_at,expires_at FROM credentials WHERE kind='session' AND expires_at>?", (time.time(),))})

    @routes.delete('/api/auth/sessions')
    async def revoke_sessions(request):
        admin(request)
        async with auth.change_lock:
            await revoke_browser_sessions(store)
        await store.audit(auth.username, 'sessions_revoked', 'all')
        return web.json_response({'ok': True})

    @routes.get('/api/openapi.json')
    async def contract(request):
        return web.json_response(openapi(request.app.router))

    @routes.post('/api/logout')
    async def logout(request):
        await store.execute('DELETE FROM credentials WHERE id=?', (request['principal']['id'],))
        response = web.json_response({'ok': True})
        response.del_cookie(cookie_name)
        return response

    @routes.get('/api/dashboard')
    async def dashboard(request):
        admin(request)
        threshold = await service.threshold()
        total, active, feeds, users, channels, groups, attention = await asyncio.gather(
            db.Sub.all().count(), db.Sub.filter(state=1).count(), db.Feed.all().count(),
            db.User.filter(id__gt=0).count(), db.User.filter(state=50).count(),
            db.User.filter(id__lt=0).exclude(state=50).count(),
            db.Sub.filter(state=1, feed__error_count__gte=threshold).count())
        settings = await store.settings()
        statistics = await store.statistics()
        if snapshot:
            statistics = {'available': False, 'totals': {'fetched': None, 'delivered': None, 'failed': None}, 'daily': []}
        return web.json_response({
            'counts': dict(subscriptions=total, active=active, feeds=feeds, users=users, channels=channels, groups=groups, attention=attention),
            'statistics': statistics, 'started_at': settings['started_at'],
            'bot': service.gateway.status(), 'uptime_seconds': round((datetime.now(service.started.tzinfo) - service.started).total_seconds()),
            'threshold': threshold, 'metrics_error': metrics.last_error,
            'activity': await store.rows('SELECT * FROM activity ORDER BY id DESC LIMIT 8'),
            'attention': (await service.subscriptions(request['principal'], {'attention': '1', 'size': '5'}))['items'],
        })

    @routes.get('/api/targets')
    async def targets(request):
        return web.json_response(await service.targets(request['principal'], request.query))

    @routes.post('/api/targets')
    async def register(request):
        admin(request)
        values = await body(request)
        async with service.mutation:
            result = await service.register(values.get('id'), request['principal'])
        await store.audit(request['principal']['name'], '登记会话', result['title'])
        return web.json_response(result, status=201)

    @routes.post('/api/targets/{id}/refresh')
    async def refresh(request):
        if snapshot:
            raise Problem('离线预览使用快照中的会话名称，无法实时同步 Telegram 名称与权限。', 409)
        return web.json_response(await service.refresh(request.match_info['id'], request['principal']))

    @routes.patch('/api/targets/{id}')
    async def patch_target(request):
        admin(request)
        values = await body(request)
        async with service.mutation:
            user = await service.user(request.match_info['id'], request['principal'])
            await service.patch(user, values)
        await store.audit(request['principal']['name'], '修改会话默认设置', str(user.id))
        return web.json_response((await service.target_data([user]))[0])

    @routes.patch('/api/targets/{id}/role')
    async def patch_role(request):
        admin(request)
        values = await body(request)
        roles = {'banned': -1, 'guest': 0, 'user': 1, 'admin': 100}
        if set(values) != {'role'} or not isinstance(values.get('role'), str) or values['role'] not in roles:
            raise Problem('角色必须是 banned、guest、user 或 admin。')
        from ..command.inner.users import set_user_state
        async with service.mutation:
            user = await service.user(request.match_info['id'], request['principal'])
            # Preserve destination type separately before changing upstream state.
            current = (await service.target_data([user]))[0]
            meta = (await store.target_map([user.id])).get(str(user.id))
            if not meta:
                await store.target(user.id, current['title'], current['username'], current['kind'], current['membership'])
            actor_id = request['principal'].get('telegram_id')
            try:
                await set_user_state(user, roles[values['role']], int(actor_id) if actor_id is not None else None)
            except ValueError as error:
                raise Problem(str(error), 409)
        await store.audit(request['principal']['name'], '修改用户角色', f'{user.id}: {values["role"]}')
        return web.json_response((await service.target_data([user]))[0])

    @routes.post('/api/targets/{id}/leave')
    async def leave(request):
        admin(request)
        values = await body(request)
        if values.get('confirm') != request.match_info['id']:
            raise Problem('请输入会话 ID 确认退出。')
        async with service.mutation:
            user = await service.user(request.match_info['id'], request['principal'])
            await service.leave(user)
        await store.audit(request['principal']['name'], '退出会话并暂停订阅', str(user.id))
        return web.json_response({'ok': True})

    @routes.get('/api/targets/{id}/opml')
    async def export(request):
        user = await service.user(request.match_info['id'], request['principal'])
        return web.Response(body=await service.export(user), content_type='text/xml', headers={'Content-Disposition': f'attachment; filename="rsstt-{user.id}.opml"'})

    @routes.post('/api/targets/{id}/opml')
    async def import_opml(request):
        values = await body(request)
        urls = service.parse_opml(values.get('opml'))
        async with service.mutation:
            result = await service.add(request.match_info['id'], urls, request['principal'])
        await store.audit(request['principal']['name'], '导入 OPML', f"{request.match_info['id']} · {len(urls)} 个地址")
        return web.json_response(result)

    @routes.get('/api/subscriptions')
    async def subscriptions(request):
        return web.json_response(await service.subscriptions(request['principal'], request.query))

    @routes.post('/api/subscriptions')
    async def add(request):
        values = await body(request)
        async with service.mutation:
            result = await service.add(values.get('target'), values.get('urls'), request['principal'])
        await store.audit(request['principal']['name'], '添加订阅', f"{values['target']} · {sum(r['status']=='created' for r in result['results'])} 个新增")
        return web.json_response(result)

    @routes.patch('/api/subscriptions/{id}')
    async def patch_subscription(request):
        values = await body(request)
        async with service.mutation:
            sub = await service.subscription(request.match_info['id'], request['principal'])
            if values.get('state') == 1:
                if sub.user.state == -1:
                    raise Problem('这个用户已被封禁。', 409)
                await service.refresh(sub.user_id, request['principal'])
            await service.patch(sub, values)
        await store.audit(request['principal']['name'], '修改订阅', str(sub.id))
        return web.json_response((await service.sub_data([sub]))[0])

    @routes.delete('/api/subscriptions/{id}')
    async def delete(request):
        async with service.mutation:
            sub = await service.subscription(request.match_info['id'], request['principal'])
            await service.delete(sub)
        await store.audit(request['principal']['name'], '取消订阅', str(sub.id))
        return web.json_response({'ok': True})

    @routes.post('/api/subscriptions/batch')
    async def batch(request):
        values = await body(request)
        ids, action = values.get('ids'), values.get('action')
        if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or action not in ('pause', 'resume', 'delete'):
            raise Problem('每次可处理 1–100 条订阅，操作可选 pause、resume、delete。')
        result = []
        async with service.mutation:
            # Authorize the entire selection before applying any writes.
            subs = [await service.subscription(ident, request['principal']) for ident in dict.fromkeys(ids)]
            for sub in subs:
                try:
                    if action == 'delete':
                        await service.delete(sub)
                    else:
                        if action == 'resume':
                            if sub.user.state == -1:
                                raise Problem('这个用户已被封禁。', 409)
                            await service.refresh(sub.user_id, request['principal'])
                        await service.patch(sub, {'state': 1 if action == 'resume' else 0})
                    result.append({'id': sub.id, 'ok': True})
                except Problem as error:
                    result.append({'id': sub.id, 'ok': False, 'error': error.message})
        await store.audit(request['principal']['name'], '批量处理订阅', f'{action} · {len(result)} 条')
        return web.json_response({'results': result})

    @routes.get('/api/settings')
    async def settings(request):
        admin(request)
        return web.json_response({'options': db.EffectiveOptions.options, 'console': await store.settings(),
                                  'bot': service.gateway.status(), 'origin': origin, 'demo': demo,
                                  'database': env.DATABASE_URL.split(':', 1)[0], 'version': env.VERSION})

    @routes.patch('/api/settings')
    async def patch_settings(request):
        admin(request)
        values = await body(request)
        if not values or set(values) - (set(db.EffectiveOptions.options) | {'attention_threshold'}):
            raise Problem('包含不支持的设置项。')
        clean = {}
        for key, value in values.items():
            if key == 'sub_limit_reached_message':
                if not isinstance(value, str) or len(value) > 2000:
                    raise Problem('订阅上限提示最多 2000 个字符。')
                clean[key] = value
            else:
                clean[key] = integer(value, key, -1 if key.endswith('sub_limit') else 1, 100 if key == 'attention_threshold' else 32767)
        merged = {**db.EffectiveOptions.options, **clean}
        if merged['default_interval'] < merged['minimal_interval']:
            raise Problem('默认更新间隔不能小于最短更新间隔。')
        async with service.mutation:
            for key, value in clean.items():
                if key == 'attention_threshold':
                    await store.set_setting(key, value)
                else:
                    await db.EffectiveOptions.set(key, value)
            if 'default_interval' in clean:
                async for feed in db.Feed.filter(state=1):
                    await inner.utils.update_interval(feed)
        await store.audit(request['principal']['name'], '更新设置', '、'.join(clean))
        return web.json_response({'ok': True})

    @routes.get('/api/runtime-config')
    async def runtime_config(request):
        admin(request)
        try:
            return web.json_response(runtime.describe())
        except ConfigError as error:
            raise Problem(str(error), 409)

    @routes.patch('/api/runtime-config')
    async def patch_runtime_config(request):
        admin(request)
        values = await body(request)
        if not values:
            raise Problem('没有可保存的运行配置。')
        async with service.mutation:
            try:
                result = runtime.save(values)
            except ConfigError as error:
                raise Problem(str(error))
        await store.audit(request['principal']['name'], '保存运行配置（待重启）', '、'.join(sorted(values)))
        return web.json_response(result)

    @routes.get('/api/tokens')
    async def tokens(request):
        admin(request)
        items = await store.tokens()
        for item in items:
            item['targets'] = json.loads(item['targets'])
        return web.json_response({'items': items})

    @routes.post('/api/tokens')
    async def issue(request):
        admin(request)
        values = await body(request)
        name, permission, target_ids = values.get('name'), values.get('permission'), values.get('targets')
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80 or permission not in ('read', 'write'):
            raise Problem('请填写名称并选择 read 或 write 权限。')
        if values.get('all_targets') is True:
            target_ids = None
        elif not isinstance(target_ids, list) or not 1 <= len(target_ids) <= 100:
            raise Problem('请选择至少一个会话，或明确允许全部会话。')
        else:
            target_ids = list(dict.fromkeys(str(chat_id(ident)) for ident in target_ids))
            for ident in target_ids:
                await service.user(ident, request['principal'])
        days = integer(values.get('days', 90), '有效天数', 1, 365)
        if len(await store.tokens()) >= 100:
            raise Problem('最多保留 100 个有效连接授权。')
        ident, secret = await store.issue(name.strip(), 'token', permission, target_ids, days)
        await store.audit('管理员', '创建连接授权', name.strip())
        return web.json_response({'id': ident, 'token': secret}, status=201)

    @routes.delete('/api/tokens/{id}')
    async def revoke(request):
        admin(request)
        await store.execute("DELETE FROM credentials WHERE id=? AND kind='token'", (request.match_info['id'],))
        await store.audit('管理员', '撤销连接授权', request.match_info['id'])
        return web.json_response({'ok': True})

    @routes.get('/')
    async def index(request):
        return web.FileResponse(STATIC / 'index.html')

    @routes.get('/assets/{name}')
    async def assets(request):
        name = request.match_info['name']
        if name not in ('app.js', 'app.css', 'mark.svg'):
            raise web.HTTPNotFound()
        return web.FileResponse(STATIC / name)

    app.add_routes(routes)
    return app


_runner = None
_store = None


async def start():
    global _runner, _store
    if os.environ.get('WEB_ENABLED', '').lower() not in ('1', 'true', 'yes'):
        return
    host = os.environ.get('WEB_HOST', '127.0.0.1')
    port = int(os.environ.get('WEB_PORT', '8730'))
    origin = os.environ.get('WEB_ORIGIN', f'http://127.0.0.1:{port}')
    password = os.environ.get('WEB_PASSWORD', '')
    _store = await Store(Path(env.config_folder_path) / 'console.sqlite3').open()
    try:
        app = await create_app(_store, password, origin)
        _runner = web.AppRunner(app, access_log=None)
        await _runner.setup()
        await web.TCPSite(_runner, host, port).start()
        metrics.store = _store
    except BaseException:
        await stop()
        raise
    LOGGER.info('RSStT web console listening on %s:%s', host, port)


async def stop():
    global _runner, _store
    metrics.store = None
    if _runner:
        await _runner.cleanup()
        _runner = None
    if _store:
        await _store.close()
        _store = None
