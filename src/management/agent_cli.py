"""Standard-library-only Agent client: python -m src.management.agent_cli --help."""
import argparse
import json
import os
from pathlib import Path
import stat
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default=os.environ.get('RSSTT_URL'))
    parser.add_argument('--token-file', type=Path)
    parser.add_argument('--token-stdin', action='store_true')
    parser.add_argument('--method', choices=['GET', 'POST', 'PATCH', 'DELETE'], default='GET')
    parser.add_argument('--data', type=Path, help='JSON request body file (never credentials)')
    parser.add_argument('--apply', action='store_true', help='Execute a write; otherwise only print a local plan')
    parser.add_argument('--confirm-delete', action='store_true')
    parser.add_argument('path', help='API path, e.g. /api/subscriptions?target=-1001')
    args = parser.parse_args(argv)
    parsed = urlsplit(args.url or '')
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        parser.error('--url must be an HTTP(S) origin')
    if parsed.scheme != 'https' and parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
        parser.error('Remote credentials require HTTPS')
    if not args.path.startswith('/api/') or '#' in args.path or '\\' in args.path or any(c in args.path for c in '\r\n'):
        parser.error('path must start with /api/')
    if args.token_file and args.token_stdin:
        parser.error('choose one credential source')
    if args.token_file:
        with args.token_file.open() as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.getuid():
                parser.error('token file must be owned by current user with mode 0600')
            token = stream.read().strip()
    else:
        token = sys.stdin.read().strip() if args.token_stdin else os.environ.get('RSSTT_TOKEN', '')
    if not token or not token.startswith('rst_'):
        parser.error('provide an integration token through RSSTT_TOKEN, --token-file or --token-stdin')
    data = json.loads(args.data.read_text()) if args.data else None
    if args.method != 'GET' and not args.apply:
        print(json.dumps({'dry_run': True, 'validation': 'local_plan_only', 'method': args.method, 'path': args.path, 'body': data}, ensure_ascii=False))
        return 0
    if (args.method == 'DELETE' or isinstance(data, dict) and data.get('action') == 'delete') and not args.confirm_delete:
        parser.error('deletion requires --confirm-delete together with --apply')
    request = urllib.request.Request(args.url.rstrip('/') + args.path, method=args.method,
                                     data=json.dumps(data).encode() if data is not None else None,
                                     headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=30) as response:
            print(response.read().decode())
        return 0
    except urllib.error.HTTPError as error:
        print(error.read().decode(), file=sys.stderr)
        return 1
    except urllib.error.URLError:
        print(json.dumps({'error': 'Connection failed', 'code': 'CONNECTION_FAILED'}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
