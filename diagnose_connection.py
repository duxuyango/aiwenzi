"""Probe the official API without a key, request body, or writing material."""
import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener, getproxies


def probe(opener):
    try:
        with opener.open(Request('https://api.deepseek.com/models'), timeout=12) as response:
            return {'reachable': True, 'http_status': response.status}
    except HTTPError as exc:
        status = exc.code
        exc.close()
        return {'reachable': True, 'http_status': status}
    except (URLError, OSError, TimeoutError) as exc:
        reason = getattr(exc, 'reason', exc)
        return {'reachable': False, 'error_type': type(reason).__name__,
                'errno': getattr(reason, 'errno', None), 'winerror': getattr(reason, 'winerror', None)}


def main():
    proxies = {}
    for scheme, value in getproxies().items():
        if scheme not in ('http', 'https', 'all'):
            continue
        parsed = urlsplit(value if '://' in value else 'http://' + value)
        try:
            port = parsed.port
        except ValueError:
            port = None
        proxies[scheme] = {'host': parsed.hostname, 'port': port}
    report = {'proxy': proxies, 'system_route': probe(build_opener()),
              'direct_route': probe(build_opener(ProxyHandler({})))}
    print(json.dumps(report, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
