"""Explicit opt-in Agent route registry. New management routes fail closed."""
# A write token includes read. No token includes console administration.
AGENT_ROUTES = {
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


def openapi():
    paths = {}
    for (method, path), scope in AGENT_ROUTES.items():
        operation = {
            'operationId': method.lower() + '_' + path.removeprefix('/api/').replace('/', '_').replace('{', '').replace('}', '').replace('.', '_'),
            'security': [{'bearerAuth': []}],
            'x-required-capability': scope,
            'description': 'Target scope is checked before any mutation. Telegram IDs are strings.',
            'responses': {'200': {'description': 'Success'}, '400': {'description': 'INVALID_REQUEST'}, '401': {'description': 'UNAUTHENTICATED'}, '403': {'description': 'FORBIDDEN'}, '409': {'description': 'CONFLICT'}},
        }
        if '{id}' in path:
            operation['parameters'] = [{'name': 'id', 'in': 'path', 'required': True, 'schema': {'type': 'string'}}]
        if method in ('POST', 'PATCH') and not path.endswith('/refresh'):
            properties = {
                '/api/subscriptions': {'target': {'type': 'string'}, 'urls': {'type': 'array', 'maxItems': 100, 'items': {'type': 'string', 'format': 'uri'}}},
                '/api/subscriptions/batch': {'ids': {'type': 'array', 'maxItems': 100, 'items': {'type': 'integer'}}, 'action': {'enum': ['pause', 'resume', 'delete']}},
                '/api/targets/{id}/opml': {'opml': {'type': 'string', 'maxLength': 524288}},
                '/api/subscriptions/{id}': {'state': {'enum': [0, 1]}, 'title': {'type': ['string', 'null']}, 'tags': {'type': ['string', 'null']}, 'interval': {'type': ['integer', 'null']}},
            }[path]
            operation['requestBody'] = {'required': True, 'content': {'application/json': {'schema': {'type': 'object', 'properties': properties}}}}
        paths.setdefault(path, {})[method.lower()] = operation
    return {'openapi': '3.1.0', 'info': {'title': 'RSStT Agent API', 'version': '1.0.0'}, 'paths': paths,
            'components': {'securitySchemes': {'bearerAuth': {'type': 'http', 'scheme': 'bearer'}},
                           'schemas': {'Error': {'type': 'object', 'required': ['error', 'code'], 'properties': {'error': {'type': 'string'}, 'code': {'type': 'string'}}}}}}
