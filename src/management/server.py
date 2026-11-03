"""Authenticated, same-origin API and dependency-free static web application."""
import asyncio
import gzip
import json
import logging
import os
import secrets
import signal
import re
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import web

from .. import db, env
from ..command import inner
from . import articles, batch_settings, diagnostics, metrics, notifications
from . import version as web_version
from . import feed_options
from .statistics import usage
from .service import Problem, Service, chat_id, integer
from .store import Store
from .auth import Auth, revoke_browser_sessions
from .agent_contract import authorize_agent, openapi

LOGGER = logging.getLogger('RSStT.management')
STATIC = Path(__file__).parent / 'static'
SAFE = {'GET', 'HEAD', 'OPTIONS'}
ASSET = re.compile(r'[a-z0-9-]+\.(?:js|css|svg|png)')
NOTIFICATIONS_KEY = web.AppKey('notifications', notifications.Notifications)


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


def is_admin(request):
    return request['principal']['kind'] == 'session' and request['principal']['permission'] == 'admin'


def admin(request):
    if not is_admin(request):
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
    boot = secrets.token_hex(6)  # changes on every start; lets the page notice a restart
    service = Service(store, gateway, demo)
    await diagnostics.observe_restore(store)
    from . import chat_audit
    await chat_audit.initialize(store)
    from ..runtime_config import RuntimeConfig, ConfigError
    runtime = RuntimeConfig(store.path.parent,
                            applied=getattr(env, 'RUNTIME_CONFIG_OVERRIDES', {}),
                            environment=getattr(env, 'RUNTIME_CONFIG_ENVIRONMENT', {}),
                            deployment=getattr(env, 'RUNTIME_CONFIG_DEPLOYMENT', {}))

    def running_values():
        """What this process actually uses right now (secrets only as set / count)."""
        current = {}
        for key in ('MULTIUSER', 'VERIFY_TLS', 'PROXY_BYPASS_PRIVATE', 'IPV6_PRIOR', 'TABLE_TO_IMAGE',
                    'TRAFFIC_SAVING', 'LAZY_MEDIA_VALIDATION', 'CRON_SECOND', 'HTTP_TIMEOUT', 'HTTP_CONCURRENCY',
                    'HTTP_CONCURRENCY_PER_HOST', 'HTTP_MAX_LINE_SIZE', 'HTTP_MAX_FIELD_SIZE', 'USER_AGENT',
                    'IMG_RELAY_SERVER', 'IMAGES_WESERV_NL', 'API_ID', 'ERROR_LOGGING_CHAT'):
            if hasattr(env, key):
                value = getattr(env, key)
                current[key] = str(value) if key == 'ERROR_LOGGING_CHAT' and value is not None else value
        current['PROXY_BYPASS_DOMAINS'] = ' '.join(getattr(env, 'PROXY_BYPASS_DOMAINS', []) or []) or None
        current['TELEGRAPH_TOKEN'] = len(getattr(env, 'TELEGRAPH_TOKEN', []) or [])
        current['TOKEN'] = bool(getattr(env, 'TOKEN', None))
        current['API_HASH'] = bool(getattr(env, 'API_HASH', None))
        current['T_PROXY'] = bool(getattr(env, 'TELEGRAM_PROXY', None))
        current['R_PROXY'] = bool(getattr(env, 'R_PROXY', None))
        for key in ('SOCKS_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY'):
            current[key] = bool(getattr(env, 'RUNTIME_CONFIG_ENVIRONMENT', {}).get(key))
        return current

    def describe_runtime():
        result = runtime.describe()
        current = running_values()
        for row in result['items']:
            if row['key'] in current:
                row['current'] = current[row['key']]
            row['current_source'] = ('web' if row['key'] in runtime.applied else
                                     'deployment' if row['deployment_set'] else 'default')
        return result
    auth = await Auth.load(store, password, "preview-admin" if demo else "admin")
    # Re-authenticate after restart/password rotation; integration tokens persist.
    await revoke_browser_sessions(store)

    def same_origin(request):
        """Accept the configured origin, or the origin the browser actually used for this host.

        Opening the console via localhost, an IP or a second domain used to make
        sign-in fail. Cookies are SameSite=Strict, so matching the Host header
        is still a sound CSRF check.
        """
        sent = request.headers.get('Origin')
        if not sent:
            return False
        if sent.rstrip('/') == origin:
            return True
        try:
            parts = urlsplit(sent)
        except ValueError:
            return False
        forwarded = request.headers.get('X-Forwarded-Host', '').split(',')[0].strip()
        return parts.scheme in ('http', 'https') and parts.netloc in {request.host, forwarded} - {''}

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
                        if not bearer and not same_origin(request):
                            raise Problem('请求来源不匹配，请通过配置的管理台地址访问。', 403)
                elif request.path == '/api/login' and not same_origin(request):
                    raise Problem('登录请求来源与当前访问地址不一致，请直接打开管理台地址后重试。', 403)
            from .web_audit import trace
            async with trace(request, service, store):
                response = await handler(request)
        except Problem as error:
            response = web.json_response({'error': error.message, 'code': getattr(error, 'code', None) or {400: 'INVALID_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 415: 'UNSUPPORTED_MEDIA_TYPE', 429: 'RATE_LIMITED'}.get(error.status, 'REQUEST_FAILED')}, status=error.status)
        except web.HTTPException as error:
            response = web.json_response({'error': '请求过大。' if error.status == 413 else '请求地址或方法无效。', 'code': 'PAYLOAD_TOO_LARGE' if error.status == 413 else 'INVALID_ROUTE'}, status=error.status)
        except Exception as error:
            LOGGER.exception('Console request failed: %s %s', request.method, request.path)
            resource = request.match_info.route.resource
            store.diagnostics.emit('system', 'error', 'console.request_failed', '网页管理操作发生后台异常。',
                                   detail=type(error).__name__,
                                   context={'exception_type': type(error).__name__, 'method': request.method,
                                            'route': resource.canonical if resource else '/unknown'})
            response = web.json_response({'error': '操作未完成，请查看服务日志后重试。', 'code': 'INTERNAL_ERROR'}, status=500)
        if request.get('principal', {}).get('kind') == 'token':
            await store.audit(request['principal']['id'], 'agent_request', f"{request.method} {request.match_info.route.resource.canonical if request.match_info.route.resource else '/unknown'} {response.status}")
        if not request.path.startswith('/assets/'):
            response.headers['Cache-Control'] = 'no-store'
        response.headers.update({
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        })
        return response

    app = web.Application(middlewares=[boundary], client_max_size=600 * 1024)
    app[web.AppKey('service', Service)] = service
    routes = web.RouteTableDef()

    @routes.get('/api/public')
    async def public(request):
        paths = {route.resource.canonical for route in request.app.router.routes()}
        features = {name: path in paths for name, path in {
            'security': '/api/auth/account', 'runtime': '/api/runtime-config',
            'notifications': '/api/notifications', 'backups': '/api/backups',
            'recipients': '/api/feeds/{id}/recipients', 'statistics': '/api/statistics',
            'chat_activity': '/api/targets/{id}/activity',
            'diagnostics': '/api/diagnostics',
            'manual_fetch': '/api/subscriptions/{id}/fetch-now',
            'articles': '/api/subscriptions/{id}/articles',
        }.items()}
        return web.json_response({'demo': demo, 'snapshot': snapshot, 'features': features, 'boot': boot,
                                  'version': web_version.WEB_VERSION})

    @routes.post('/api/login')
    async def login(request):
        values = await body(request)
        async with auth.change_lock:
            try:
                await auth.verify(values.get('password'), client_ip(request), values.get('username'))
            except Problem:
                store.diagnostics.emit('system', 'warning', 'auth.sign_in_failed', '管理台登录失败，请检查账号、密码或稍后重试。')
                raise
            await store.execute("DELETE FROM credentials WHERE kind='session' AND id NOT IN (SELECT id FROM credentials WHERE kind='session' ORDER BY created_at DESC LIMIT 19)")
            _, secret = await store.issue(auth.username, days=1 / 3)
        await store.audit(auth.username, 'login', 'success')
        store.diagnostics.emit('system', 'info', 'auth.signed_in', '管理员已登录网页管理台。')
        response = web.json_response({'ok': True})
        response.set_cookie(cookie_name, secret, httponly=True, secure=served_over_https(request), samesite='Strict', max_age=28800, path='/')
        return response

    @routes.get('/api/session')
    async def session(request):
        p = request['principal']
        return web.json_response({'name': p['name'], 'permission': p['permission'], 'targets': p['targets'], 'demo': demo, 'account_type': 'agent' if p['kind'] == 'token' else 'preview_admin' if demo else 'console_admin', 'expires_at': p['expires_at'], 'version': web_version.WEB_VERSION, 'build': web_version.build(), 'capabilities': ['subscriptions:read', 'subscriptions:write'] if p['permission'] == 'write' else ['subscriptions:read'] if p['permission'] == 'read' else ['console:admin']})

    @routes.get('/api/auth/account')
    async def account(request):
        admin(request)
        return web.json_response({'username': auth.username, 'account_type': 'preview_admin' if demo else 'console_admin'})

    @routes.post('/api/auth/password')
    async def password_change(request):
        admin(request)
        values = await body(request)
        async with auth.change_lock:
            try:
                await auth.verify(values.get('current_password'), client_ip(request))
            except Problem as error:
                if error.code == 'INVALID_CREDENTIALS':
                    store.diagnostics.emit('system', 'warning', 'auth.password_change_rejected', '管理台密码未修改：当前密码不正确。')
                    raise Problem('当前密码不正确，密码未修改。', code='CURRENT_PASSWORD_INCORRECT') from None
                raise
            new_password, new_username = values.get('new_password'), values.get('username')
            if new_username is not None and new_username == auth.username:
                new_username = None
            if new_password is None and new_username is None:
                raise Problem('没有需要修改的内容。', code='NOTHING_TO_CHANGE')
            await auth.change(new_password, new_username)
        await store.audit(auth.username, 'password_changed' if new_password is not None else 'username_changed',
                          'all browser sessions revoked')
        if new_password is not None:
            store.diagnostics.emit('system', 'info', 'auth.password_changed', '管理台密码已修改，原有网页登录已失效。')
        else:
            store.diagnostics.emit('system', 'info', 'auth.username_changed', '管理台账号已修改，原有网页登录已失效。')
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
        total, active, feeds, attention = await asyncio.gather(
            db.Sub.all().count(), db.Sub.filter(state=1).count(), db.Feed.all().count(),
            db.Sub.filter(state=1, feed__error_count__gte=threshold).count())
        settings = await store.settings()
        usage_counts = await usage(store)
        statistics = await store.statistics()
        if snapshot:
            statistics = {'available': False, 'totals': {'fetched': None, 'delivered': None, 'failed': None}, 'daily': []}
        return web.json_response({
            'counts': dict(subscriptions=total, active=active, feeds=feeds, users=usage_counts['known']['private'], channels=usage_counts['known']['channel'], groups=usage_counts['known']['group'], unknown=usage_counts['known']['unknown'], attention=attention),
            'usage': usage_counts,
            'statistics': statistics, 'started_at': settings['started_at'],
            'bot': service.gateway.status(), 'uptime_seconds': round((datetime.now(service.started.tzinfo) - service.started).total_seconds()),
            'threshold': threshold, 'metrics_error': metrics.last_error,
            'activity': await store.rows('SELECT * FROM activity ORDER BY id DESC LIMIT 8'),
            'attention': await service.sub_data(
                await (await service.sub_query(request['principal'], {})).filter(state=1, feed__error_count__gte=threshold)
                .select_related('feed', 'user').order_by('-feed__error_count', 'feed_id').limit(30)),
        })

    @routes.get('/api/status')
    async def status(request):
        admin(request)
        threshold = await service.threshold()
        attention = await (await service.sub_query(request['principal'], {})).filter(
            state=1, feed__error_count__gte=threshold).count()
        return web.json_response({'bot': service.gateway.status(), 'attention': attention,
                                  'uptime_seconds': round((datetime.now(service.started.tzinfo) - service.started).total_seconds())})

    @routes.get('/api/statistics')
    async def statistics_window(request):
        admin(request)
        try:
            result = await store.statistics_window(
                request.query.get('granularity', 'hour'), request.query.get('start'),
                request.query.get('end'), unavailable=bool(snapshot))
        except (ValueError, OverflowError) as error:
            raise Problem(str(error), 400)
        return web.json_response(result)

    @routes.get('/api/targets')
    async def targets(request):
        return web.json_response(await service.targets(request['principal'], request.query))

    @routes.get('/api/targets/{id}/activity')
    async def chat_activity(request):
        admin(request)
        user = await service.user(request.match_info['id'], request['principal'])
        page, size = service.pagination(request.query)
        return web.json_response(await chat_audit.events(store, user.id, page=page, size=size))

    @routes.post('/api/targets')
    async def register(request):
        admin(request)
        values = await body(request)
        async with service.mutation:
            result = await service.register(values.get('id'), request['principal'])
        await store.audit(request['principal']['name'], '登记会话', result['title'])
        return web.json_response(result, status=201)

    @routes.post('/api/targets/names')
    async def complete_names(request):
        admin(request)
        if demo:
            raise Problem('离线预览和演示实例没有连接 Telegram，无法补全名称。', 409, code='OFFLINE')
        from . import chat_lifecycle
        return web.json_response(await chat_lifecycle.resolve_names())

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
        proxy = values.get('proxy')
        if proxy is not None:
            admin(request)  # proxy settings are administrator-only, like every other fetch option
            try:
                proxy = feed_options.check(proxy)
            except ValueError:
                raise Problem(feed_options.INVALID, code='INVALID_PROXY') from None
        async with service.mutation:
            result = await service.add(values.get('target'), values.get('urls'), request['principal'], proxy=proxy)
        await store.audit(request['principal']['name'], '添加订阅', f"{values['target']} · {sum(r['status']=='created' for r in result['results'])} 个新增")
        return web.json_response(result)

    @routes.get('/api/subscriptions/{id:\\d+}')
    async def subscription_detail(request):
        sub = await service.subscription(request.match_info['id'], request['principal'])
        return web.json_response((await service.sub_data([sub]))[0])

    @routes.patch('/api/subscriptions/{id}')
    async def patch_subscription(request):
        values = await body(request)
        async with service.mutation:
            sub = await service.subscription(request.match_info['id'], request['principal'])
            await service.update_sub(sub, values, request['principal'])
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
        if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or action not in ('pause', 'resume', 'delete', 'interval', 'settings'):
            raise Problem('每次可处理 1–100 条订阅，操作可选 pause、resume、delete、interval、settings。')
        if action == 'interval' and 'interval' not in values:
            raise Problem('请提供更新间隔（分钟）；null 表示跟随默认。')
        plan = None
        if action == 'settings':
            # Reject a malformed or forbidden request as a whole, before anything is written.
            plan = batch_settings.validate(service, request['principal'], values.get('changes'), is_admin(request))
        result = []
        async with service.mutation:
            # Authorize the entire selection before applying any writes.
            subs = [await service.subscription(ident, request['principal']) for ident in dict.fromkeys(ids)]
            if plan is not None:
                result = await batch_settings.apply(service, request['principal'], subs, plan)
            for sub in subs if plan is None else ():
                try:
                    if action == 'delete':
                        await service.delete(sub)
                    elif action == 'interval':
                        await service.patch(sub, {'interval': values['interval']})
                    else:
                        await service.update_sub(sub, {'state': 1 if action == 'resume' else 0}, request['principal'])
                    result.append({'id': sub.id, 'ok': True})
                except Problem as error:
                    result.append({'id': sub.id, 'ok': False, 'error': error.message, 'code': error.code, 'status': error.status})
        detail = f'{action} · {len(result)} 条'
        if plan is not None:
            # Names only: a proxy address may contain credentials.
            detail += ' · ' + ','.join(key for key in values['changes'])
        await store.audit(request['principal']['name'], '批量处理订阅', detail)
        return web.json_response({'results': result})

    @routes.get('/api/settings')
    async def settings(request):
        admin(request)
        return web.json_response({'options': db.EffectiveOptions.options, 'console': await store.settings(),
                                  'bot': service.gateway.status(), 'origin': origin, 'demo': demo,
                                  'database': env.DATABASE_URL.split(':', 1)[0], 'version': web_version.WEB_VERSION,
                                  'build': web_version.build(), 'upstream_version': web_version.core(),
                                  'restart': {'supported': not demo, 'container': in_container()}})

    @routes.post('/api/system/restart')
    async def restart(request):
        """Graceful exit, exactly like `docker restart`; the container's restart policy starts it again."""
        admin(request)
        values = await body(request)
        if values != {'confirm': True}:
            raise Problem('请确认重启。')
        if demo:
            raise Problem('演示和离线实例不能从网页重启。', 409, code='RESTART_UNAVAILABLE')
        await store.audit(request['principal']['name'], '重启机器人', 'web')
        await store.diagnostics.record('system', 'warning', 'system.restart_requested', '管理员从网页重启了机器人。',
                                       context={'stage': 'restart'})
        asyncio.get_running_loop().call_later(1.0, request_restart)
        return web.json_response({'ok': True, 'container': in_container()}, status=202)

    @routes.patch('/api/settings')
    async def patch_settings(request):
        admin(request)
        values = await body(request)
        if not values or set(values) - (set(db.EffectiveOptions.options) | {'attention_threshold', 'fetch_run_rows'}):
            raise Problem('包含不支持的设置项。')
        clean = {}
        for key, value in values.items():
            if key == 'sub_limit_reached_message':
                if not isinstance(value, str) or len(value) > 2000:
                    raise Problem('订阅上限提示最多 2000 个字符。')
                clean[key] = value
            elif key == 'fetch_run_rows':
                clean[key] = integer(value, key, *diagnostics.RUN_ROWS_RANGE)
            else:
                clean[key] = integer(value, key, -1 if key.endswith('sub_limit') else 1, 100 if key == 'attention_threshold' else 32767)
        merged = {**db.EffectiveOptions.options, **clean}
        if merged['default_interval'] < merged['minimal_interval']:
            raise Problem('默认更新间隔不能小于最短更新间隔。')
        async with service.mutation:
            for key, value in clean.items():
                if key == 'fetch_run_rows':
                    await store.set_setting(key, value)
                    store.diagnostics.run_rows = value  # trimmed on each feed's next check
                elif key == 'attention_threshold':
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
            return web.json_response(describe_runtime())
        except ConfigError as error:
            store.diagnostics.emit('system', 'error', 'runtime_config.read_failed', '无法读取运行配置，请检查配置文件。',
                                   detail=str(error), context={'stage': 'configuration', 'exception_type': type(error).__name__})
            raise Problem(str(error), 409)

    @routes.patch('/api/runtime-config')
    async def patch_runtime_config(request):
        admin(request)
        values = await body(request)
        if not values:
            raise Problem('没有可保存的运行配置。')
        async with service.mutation:
            try:
                runtime.save(values)
                result = describe_runtime()
            except ConfigError as error:
                store.diagnostics.emit('system', 'warning', 'runtime_config.rejected', '运行配置未保存，请检查配置项。',
                                       detail=str(error), context={'stage': 'configuration', 'exception_type': type(error).__name__})
                raise Problem(str(error))
        await store.audit(request['principal']['name'], '保存运行配置（待重启）', '、'.join(sorted(values)))
        store.diagnostics.emit('system', 'info', 'runtime_config.saved', '运行配置已保存，等待重启生效。',
                               context={'stage': 'configuration'})
        return web.json_response(result)

    @routes.post('/api/runtime-config/telegraph-tokens')
    async def telegraph_tokens(request):
        """Create Telegraph accounts (no sign-in needed) and save their tokens; applies on restart."""
        admin(request)
        values = await body(request)
        count = integer(values.get('count', 5), '数量', 1, 10)
        if demo:
            raise Problem('演示和离线实例不连接外网，无法自动获取 Telegraph Token。', 409, code='OFFLINE')
        tokens = await create_telegraph_tokens(count)
        from ..runtime_config import ConfigError as _ConfigError
        existing = runtime._read().get('TELEGRAPH_TOKEN') or ' '.join(getattr(env, 'TELEGRAPH_TOKEN', []) or [])
        merged = list(dict.fromkeys([*existing.split(), *tokens]))[:50]
        async with service.mutation:
            try:
                runtime.save({'TELEGRAPH_TOKEN': ' '.join(merged)})
            except _ConfigError as error:
                raise Problem(str(error)) from None
        await store.audit(request['principal']['name'], '自动获取 Telegraph Token（待重启）', f'{len(tokens)} 个')
        store.diagnostics.emit('system', 'info', 'runtime_config.saved', '运行配置已保存，等待重启生效。',
                               context={'stage': 'configuration'})
        return web.json_response({'added': len(tokens), 'total': len(merged), **describe_runtime()})

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
        store.diagnostics.emit('system', 'info', 'auth.token_issued', 'API 访问令牌已创建。')
        return web.json_response({'id': ident, 'token': secret}, status=201)

    @routes.delete('/api/tokens/{id}')
    async def revoke(request):
        admin(request)
        await store.execute("DELETE FROM credentials WHERE id=? AND kind='token'", (request.match_info['id'],))
        await store.audit('管理员', '撤销连接授权', request.match_info['id'])
        store.diagnostics.emit('system', 'info', 'auth.token_revoked', 'API 访问令牌已撤销。')
        return web.json_response({'ok': True})

    @routes.get('/')
    async def index(request):
        return web.FileResponse(STATIC / 'index.html')

    asset_cache = {}

    @routes.get('/assets/{name}')
    async def assets(request):
        name = request.match_info['name']
        path = STATIC / name
        if not ASSET.fullmatch(name) or not path.is_file():
            raise web.HTTPNotFound()
        stat = path.stat()
        key = (name, stat.st_mtime_ns, stat.st_size)
        cached = asset_cache.get(name)
        if not cached or cached[0] != key:
            raw = path.read_bytes()
            cached = asset_cache[name] = (key, raw, gzip.compress(raw, 9), f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"')
        _, raw, packed, etag = cached
        headers = {'ETag': etag, 'Cache-Control': 'no-cache', 'Vary': 'Accept-Encoding'}
        if request.headers.get('If-None-Match') == etag:
            return web.Response(status=304, headers=headers)
        content_type = {'.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png'}[path.suffix]
        if 'gzip' in request.headers.get('Accept-Encoding', '') and path.suffix != '.png':
            return web.Response(body=packed, content_type=content_type, charset=None if path.suffix == '.png' else 'utf-8',
                                headers={**headers, 'Content-Encoding': 'gzip'})
        return web.Response(body=raw, content_type=content_type, charset=None if path.suffix == '.png' else 'utf-8', headers=headers)

    from .backup_api import install as install_backups
    install_backups(routes, service, env.DATABASE_URL, admin, body)
    notifier = await notifications.Notifications(store, offline=demo or bool(snapshot), origin=origin).open()

    async def notification_start(app):
        notifier.start()

    async def notification_stop(app):
        await notifier.close()

    app.on_startup.append(notification_start)
    app.on_cleanup.append(notification_stop)
    app[NOTIFICATIONS_KEY] = notifier

    @routes.get('/api/notifications')
    async def notification_config(request):
        admin(request)
        return web.json_response(await notifier.summary())

    @routes.patch('/api/notifications')
    async def notification_save(request):
        admin(request)
        return web.json_response(await notifier.configure(await body(request)))

    @routes.get('/api/notifications/history')
    async def notification_history(request):
        admin(request)
        return web.json_response({'items': await notifier.history()})

    @routes.post('/api/notifications/test')
    async def notification_test(request):
        admin(request)
        return web.json_response(await notifier.test((await body(request)).get('channel')))

    from .subscriptions import install
    install(routes, service, body, admin)
    from .diagnostics_api import install as install_diagnostics
    install_diagnostics(routes, service, admin)
    articles.routes(routes, service, admin)
    from .manual_fetch import install as install_manual_fetch
    manual_fetch = install_manual_fetch(routes, service, admin, body, snapshot=snapshot)

    async def close_manual_fetch(application):
        await manual_fetch.close()

    app.on_cleanup.append(close_manual_fetch)
    app.add_routes(routes)
    return app


def client_ip(request):
    """The visitor's address for sign-in throttling.

    Behind the documented reverse proxy (nginx on the host, the container port
    published on 127.0.0.1) the TCP peer is a loopback or Docker-bridge
    address, so X-Real-IP set by that proxy is trusted. A request coming from
    any other peer cannot choose its own address this way.
    """
    import ipaddress
    peer = request.remote or ''
    try:
        local = ipaddress.ip_address(peer).is_loopback or ipaddress.ip_address(peer).is_private
    except ValueError:
        local = False
    forwarded = request.headers.get('X-Real-IP', '').strip()
    if local and forwarded:
        try:
            return str(ipaddress.ip_address(forwarded))
        except ValueError:
            pass
    return peer


def served_over_https(request):
    """Mark the session cookie Secure exactly when the browser is on HTTPS.

    Through the documented reverse proxy (X-Forwarded-Proto: https from a
    loopback/private peer) it is. Over an SSH tunnel to http://localhost:8730
    it is not, and a Secure cookie would be dropped by some browsers (Safari),
    making the emergency access path unusable; the tunnel itself is encrypted.
    """
    import ipaddress
    if request.secure:
        return True
    try:
        peer = ipaddress.ip_address(request.remote or '')
        local = peer.is_loopback or peer.is_private
    except ValueError:
        local = False
    return local and request.headers.get('X-Forwarded-Proto', '').lower() == 'https'


def in_container():
    return Path('/.dockerenv').exists() or Path('/run/.containerenv').exists() or bool(os.environ.get('container'))


def request_restart():
    """Same graceful shutdown path as SIGTERM from `docker restart` / `docker stop`."""
    LOGGER.warning('Restart requested from the web console')
    os.kill(os.getpid(), signal.SIGTERM)


async def create_telegraph_tokens(count):
    """Telegraph's createAccount needs no credentials; each call returns one access token."""
    import aiohttp
    connector = None
    proxy = getattr(env, 'TELEGRAM_PROXY', None)
    if proxy:
        from aiohttp_socks import ProxyConnector
        connector = ProxyConnector.from_url(proxy.replace('socks5h', 'socks5'), rdns=True)
    params = {'short_name': 'RSStT', 'author_name': 'Generated by RSStT',
              'author_url': 'https://github.com/Rongronggg9/RSS-to-Telegram-Bot'}
    tokens = []
    try:
        async with aiohttp.ClientSession(connector=connector, trust_env=False,
                                         timeout=aiohttp.ClientTimeout(total=15)) as client:
            for _ in range(count):
                async with client.get('https://api.telegra.ph/createAccount', params=params) as response:
                    data = await response.json(content_type=None)
                token = (data.get('result') or {}).get('access_token') if isinstance(data, dict) else None
                if not data.get('ok') or not isinstance(token, str) or not re.fullmatch(r'[0-9a-f]{20,128}', token):
                    raise ValueError('unexpected Telegraph response')
                tokens.append(token)
    except Exception as error:
        if tokens:
            return tokens
        LOGGER.warning('Telegraph token creation failed: %s', type(error).__name__)
        raise Problem('无法连接 Telegraph（api.telegra.ph）。请检查服务器网络或 Telegram 代理设置后重试。', 502,
                      code='TELEGRAPH_UNREACHABLE') from None
    return tokens


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
        diagnostics.install(_store)
        articles.install(_store)
        _store.diagnostics.emit('system', 'info', 'console.started', '网页管理台已启动。')
        notifier = app[NOTIFICATIONS_KEY]
        await notifier.baseline()
        notifications.active = notifier
        from . import chat_audit, chat_lifecycle
        chat_audit.install(_store)
        await chat_lifecycle.start(_store)
        feed_options.store = _store
        await feed_options.load(_store)
        from ..web import req as web_req
        web_req.proxy_override = feed_options.proxy_for
    except BaseException:
        await stop()
        raise
    LOGGER.info('%s web console listening on %s:%s (bot core RSS-to-Telegram-Bot %s)',
                web_version.label(), host, port, web_version.core())


async def stop():
    global _runner, _store
    from . import chat_audit, chat_lifecycle
    await chat_lifecycle.stop()
    chat_audit.uninstall(_store)
    if _store:
        _store.diagnostics.emit('system', 'info', 'console.stopped', '网页管理台正在正常停止。')
    diagnostics.uninstall(_store)
    articles.uninstall(_store)
    notifications.active = None
    metrics.store = None
    feed_options.store = None
    feed_options._proxies.clear()
    from ..web import req as web_req
    web_req.proxy_override = None
    if _runner:
        await _runner.cleanup()
        _runner = None
    if _store:
        await _store.close()
        _store = None
