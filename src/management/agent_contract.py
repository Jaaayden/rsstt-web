"""Explicit opt-in Agent route registry. New management routes fail closed."""
# A write token includes read. No token includes console administration.
AGENT_ROUTES = {
    ('GET', '/api/subscriptions/opml'): 'subscriptions:read',
    ('GET', '/api/feeds/{id}/recipients'): 'subscriptions:read',
    ('PUT', '/api/feeds/{id}/recipients'): 'subscriptions:write',
    ('GET', '/api/session'): 'subscriptions:read',
    ('GET', '/api/openapi.json'): 'subscriptions:read',
    ('GET', '/api/targets'): 'subscriptions:read',
    ('GET', '/api/subscriptions'): 'subscriptions:read',
    ('GET', '/api/targets/{id}/opml'): 'subscriptions:read',
    ('POST', '/api/subscriptions'): 'subscriptions:write',
    ('PATCH', '/api/subscriptions/{id}'): 'subscriptions:write',
    ('DELETE', '/api/subscriptions/{id}'): 'subscriptions:write',
    ('POST', '/api/subscriptions/batch'): 'subscriptions:write',
    ('POST', '/api/targets/{id}/opml'): 'subscriptions:write',
    ('POST', '/api/targets/{id}/refresh'): 'subscriptions:write',
}


def authorize_agent(request, principal):
    from .service import Problem
    resource = request.match_info.route.resource
    capability = AGENT_ROUTES.get((request.method, resource.canonical if resource else ''))
    permitted = {'subscriptions:read'}
    if principal['permission'] == 'write':
        permitted.add('subscriptions:write')
    if capability not in permitted:
        raise Problem('连接授权不允许访问此操作。', 403)


def obj(properties, required=()):
    return {'type': 'object', 'properties': properties, 'required': list(required)}


def array(items, **limits):
    return {'type': 'array', 'items': items, **limits}


def ref(name):
    return {'$ref': '#/components/schemas/' + name}


STRING = {'type': 'string'}
INTEGER = {'type': 'integer'}
BOOLEAN = {'type': 'boolean'}
CHAT_ID = {'type': 'string', 'pattern': r'^-?\d+$', 'description': 'Telegram ID, encoded as string'}
SCHEMAS = {
    'Error': obj({'error': STRING, 'code': STRING}, ('error', 'code')),
    'Ok': obj({'ok': BOOLEAN}, ('ok',)),
    'Target': obj({'id': CHAT_ID, 'title': STRING, 'kind': STRING, 'membership': STRING,
                   'state': INTEGER, 'archived': BOOLEAN, 'subscriptions': INTEGER, 'attention': INTEGER, 'options': {'type': 'object'}},
                  ('id', 'title', 'kind', 'membership', 'state', 'subscriptions', 'attention', 'options')),
    'Subscription': obj({'id': INTEGER, 'feed_id': INTEGER, 'target': CHAT_ID, 'target_title': STRING,
                         'title': STRING, 'custom_title': {'type': ['string', 'null']}, 'url': STRING,
                         'state': {'enum': [0, 1]}, 'tags': {'type': ['string', 'null']}, 'errors': INTEGER,
                         'feed_state': INTEGER, 'updated_at': STRING, 'next_check': {'type': ['string', 'null']},
                         'effective_interval': INTEGER, 'options': {'type': 'object'}},
                        ('id', 'target', 'title', 'url', 'state', 'errors', 'options')),
    'Session': obj({'name': STRING, 'permission': {'enum': ['read', 'write', 'admin']},
                    'targets': {'oneOf': [array(CHAT_ID), {'type': 'null'}]}, 'demo': BOOLEAN,
                    'account_type': {'enum': ['agent', 'preview_admin', 'console_admin']},
                    'expires_at': {'type': 'number'}, 'capabilities': array(STRING)},
                   ('name', 'permission', 'targets', 'demo', 'account_type', 'expires_at', 'capabilities')),
    'Recipients': obj({'feed_id': INTEGER, 'scope': {'enum': ['all', 'authorized_targets']},
                       'items': {**array(ref('Subscription')), 'description': 'Editable recipients only: blocked and archived chats are hidden; their existing subscriptions are preserved by replacement.'}}, ('feed_id', 'scope', 'items')),
    'AddResults': obj({'results': array(obj({'url': STRING, 'status': {'enum': ['created', 'existing', 'failed']},
                                           'message': STRING, 'id': INTEGER}, ('url', 'status')))}, ('results',)),
    'BatchResults': obj({'results': array(obj({'id': INTEGER, 'ok': BOOLEAN, 'error': STRING}, ('id', 'ok')))}, ('results',)),
}
for name, item in (('TargetPage', 'Target'), ('SubscriptionPage', 'Subscription')):
    SCHEMAS[name] = obj({'items': array(ref(item)), 'total': INTEGER, 'page': INTEGER, 'size': INTEGER},
                        ('items', 'total', 'page', 'size'))

BODY_SCHEMAS = {
    ('POST', '/api/subscriptions'): obj({'target': CHAT_ID, 'urls': array(STRING, minItems=1, maxItems=100)}, ('target', 'urls')),
    ('POST', '/api/subscriptions/batch'): obj({'ids': array(INTEGER, minItems=1, maxItems=100), 'action': {'enum': ['pause', 'resume', 'delete']}}, ('ids', 'action')),
    ('POST', '/api/targets/{id}/opml'): obj({'opml': {'type': 'string', 'maxLength': 524288}}, ('opml',)),
    ('PUT', '/api/feeds/{id}/recipients'): obj({'mode': {'enum': ['append', 'replace']}, 'targets': array(CHAT_ID, maxItems=100)}, ('mode', 'targets')),
    ('PATCH', '/api/subscriptions/{id}'): obj({'state': {'enum': [0, 1]}, 'title': {'type': ['string', 'null']},
                                             'tags': {'type': ['string', 'null']}, 'interval': {'type': ['integer', 'null']}}),
}


def query_parameters(path):
    fields = {}
    if path in ('/api/targets', '/api/subscriptions', '/api/subscriptions/opml'):
        fields['q'] = {'type': 'string', 'maxLength': 200}
        if path != '/api/subscriptions/opml':
            fields.update(page={'type': 'integer', 'minimum': 1, 'maximum': 100000, 'default': 1},
                          size={'type': 'integer', 'minimum': 1, 'maximum': 100, 'default': 20})
        if path == '/api/targets':
            fields['kind'] = {'enum': ['private', 'channel', 'group', 'unknown']}
            fields['archive'] = {'enum': ['visible', 'archived', 'all'], 'default': 'visible',
                                 'description': 'Archive filter applies before pagination. Archived chats retain subscriptions, roles and settings.'}
            fields['visibility'] = {'enum': ['all', 'unbanned', 'active', 'inactive', 'banned'], 'default': 'all',
                                    'description': 'Active: unbanned chat with an enabled subscription to an enabled feed. Inactive: unbanned chat without one. Applied before pagination; omitted means all authorized chats within the archive filter.'}
        else:
            fields.update(target={**CHAT_ID, 'description': 'Explicit chat scope, including its retained blocked subscriptions. Without target, blocked chats are excluded.'}, state={'enum': ['0', '1']}, attention={'enum': ['0', '1']})
        if path == '/api/subscriptions/opml':
            fields['ids'] = {'type': 'string', 'pattern': r'^\d+(,\d+){0,99}$', 'description': 'Up to 100 subscription IDs; intersects other filters. Pagination is ignored.'}
    return [{'name': name, 'in': 'query', 'required': False, 'schema': schema} for name, schema in fields.items()]


def response_schema(method, path):
    if path.endswith('/recipients'):
        return ref('Recipients')
    if path == '/api/session':
        return ref('Session')
    if path == '/api/targets':
        return ref('TargetPage')
    if path == '/api/subscriptions':
        return ref('SubscriptionPage' if method == 'GET' else 'AddResults')
    if path.endswith('/batch'):
        return ref('BatchResults')
    if method == 'PATCH':
        return ref('Subscription')
    if path.endswith('/refresh'):
        return ref('Target')
    if path.endswith('/opml'):
        return ref('AddResults')
    return {'type': 'object'} if path.endswith('openapi.json') else ref('Ok')


def openapi(router):
    """Advertise only capabilities whose method and canonical route are installed."""
    from copy import deepcopy
    from ..command.inner.customization import SUB_OPTIONS_EXHAUSTIVE_VALUES

    body_schemas = deepcopy(BODY_SCHEMAS)
    patch = body_schemas['PATCH', '/api/subscriptions/{id}']
    patch.update(minProperties=1, additionalProperties=False)
    patch['properties'].update({name: {'enum': list(values) + [-100]} for name, values in SUB_OPTIONS_EXHAUSTIVE_VALUES.items()})
    patch['properties'].update(length_limit={'oneOf': [{'const': -100}, {'type': 'integer', 'minimum': 0, 'maximum': 4096}]})
    patch['properties']['title']['maxLength'] = 1024
    patch['properties']['tags']['maxLength'] = 255
    patch['properties']['interval'].update(minimum=1, maximum=32767, description='null inherits defaults; non-null must meet the configured minimal_interval')
    installed = {(route.method, route.resource.canonical) for route in router.routes() if route.resource}
    paths = {}
    for (method, path), scope in AGENT_ROUTES.items():
        if (method, path) not in installed:
            continue
        xml = method == 'GET' and path.endswith('/opml')
        operation = {
            'operationId': method.lower() + '_' + path.removeprefix('/api/').replace('/', '_').replace('{', '').replace('}', '').replace('.', '_'),
            'security': [{'bearerAuth': []}],
            'x-required-capability': scope,
            'description': 'Target scope is checked before any mutation. Telegram IDs are strings.',
            'responses': {'200': {'description': 'Success', 'content': {
                'text/xml' if xml else 'application/json': {'schema': STRING if xml else response_schema(method, path)}}}},
        }
        if path.endswith('/recipients'):
            operation['description'] = 'Only authorized relationships are visible. append adds missing relationships; replace changes only authorized relationships and preserves all out-of-scope relationships. Empty targets may remove all authorized relationships.'
        for status, code in ((400, 'INVALID_REQUEST'), (401, 'UNAUTHENTICATED'), (403, 'FORBIDDEN'), (404, 'NOT_FOUND'), (409, 'CONFLICT'), (429, 'RATE_LIMITED'), (500, 'INTERNAL_ERROR')):
            operation['responses'][str(status)] = {'description': code, 'content': {'application/json': {'schema': ref('Error')}}}
        params = query_parameters(path) if method == 'GET' else []
        if '{id}' in path:
            params.append({'name': 'id', 'in': 'path', 'required': True,
                           'schema': CHAT_ID if path.startswith('/api/targets/') else {'type': 'integer', 'minimum': 1}})
        if params:
            operation['parameters'] = params
        if (method, path) in body_schemas:
            operation['requestBody'] = {'required': True, 'content': {'application/json': {'schema': body_schemas[method, path]}}}
        paths.setdefault(path, {})[method.lower()] = operation
    return {'openapi': '3.1.0', 'info': {'title': 'RSStT Agent API', 'version': '1.1.0'}, 'paths': paths,
            'components': {'securitySchemes': {'bearerAuth': {'type': 'http', 'scheme': 'bearer'}}, 'schemas': SCHEMAS}}
