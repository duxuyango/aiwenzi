"""Loopback-only host for the writing plugin. No external dependencies."""
import argparse
import json
import os
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from plugin import APIError, DeepSeekClient, PROFILES, normalize_task, prompt, run_pipeline
from providers import create_client, public_providers

WEB = Path(__file__).resolve().parent / 'web'
VERSION = '1.3.1'
API_PROTOCOL = 5


class LocalHTTPServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR allows two servers to bind the same address.
    # Prevent dispatch to an old backend after the source files are updated.
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_bytes(self, code, content, content_type):
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(content)

    def send_json(self, code, content):
        self.send_bytes(code, json.dumps(content, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8')

    def valid_host(self):
        return self.headers.get('Host') == f'127.0.0.1:{self.server.server_port}'

    def reject_post(self, code, message):
        # Drain small rejected bodies so Windows does not reset the socket
        # before the browser receives our JSON error response.
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if 0 < length <= 1000000:
                self.connection.settimeout(2)
                self.rfile.read(length)
        except (ValueError, OSError):
            pass
        return self.send_json(code, {'error': message})

    def do_GET(self):
        if not self.valid_host():
            return self.send_json(403, {'error': '请使用启动器显示的本地地址。'})
        if self.path == '/api/config':
            return self.send_json(200, {'application': 'aitext-literary', 'profiles': PROFILES, 'system_prompt': prompt('literary-system.txt'),
                                        'has_env_key': bool(os.environ.get('DEEPSEEK_API_KEY')),
                                        'version': VERSION, 'api_protocol': API_PROTOCOL,
                                        'providers': public_providers(),
                                        'capabilities': ['write', 'test-connection', 'transport', 'timeout', 'providers', 'models', 'stage-usage', 'provider-adapters']})
        files = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
                 '/style.css': ('style.css', 'text/css; charset=utf-8'), '/state.js': ('state.js', 'text/javascript; charset=utf-8')}
        item = files.get(self.path)
        if not item:
            return self.send_json(404, {'error': '页面不存在。'})
        return self.send_bytes(200, (WEB / item[0]).read_bytes(), item[1])

    def do_POST(self):
        expected_origin = f'http://127.0.0.1:{self.server.server_port}'
        if not self.valid_host() or self.headers.get('Origin') != expected_origin:
            return self.reject_post(403, '仅接受本地页面发起的请求。')
        if self.path not in ('/api/write', '/api/test-connection', '/api/models'):
            return self.reject_post(404, '接口不存在。')
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.reject_post(415, '请求须使用 JSON。')
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > 1000000:
                return self.send_json(413, {'error': '请求为空或超过 1 MB。'})
            body = json.loads(self.rfile.read(length).decode('utf-8'))
            if not isinstance(body, dict) or not isinstance(body.get('connection', {}), dict):
                raise ValueError('请求格式无效。')
            task = normalize_task(body.get('task')) if self.path == '/api/write' else None
            options = body.get('connection', {})
            if self.path == '/api/models' and not options.get('model'):
                options = {**options, 'model': '__list_models__'}
            client = create_client(options)
        except (ValueError, TypeError, UnicodeError) as exc:
            return self.send_json(400, {'error': str(exc)})
        if self.path in ('/api/test-connection', '/api/models'):
            try:
                return self.send_json(200, {'models': client.list_models(), 'catalog': client.model_catalog} if self.path == '/api/models' else client.test_connection())
            except APIError as exc:
                return self.send_json(400, {'error': str(exc)})
        self.send_response(200)
        self.send_header('Content-Type', 'application/x-ndjson; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        try:
            for event in run_pipeline(task, client):
                self.wfile.write((json.dumps(event, ensure_ascii=False) + '\n').encode('utf-8'))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    try:
        server = LocalHTTPServer(('127.0.0.1', args.port), Handler)
    except OSError:
        parser.exit(1, f'ai文字端口 {args.port} 已有服务。请关闭之前的ai文字启动窗口，再重新启动。\n也可使用独立地址：python server.py --port 8766\n')
    print(f'ai文字 v{VERSION} 已启动：http://127.0.0.1:{server.server_port}', flush=True)
    print('浏览器打开上面地址。按 Ctrl+C 停止服务。配置可主动保存到本机浏览器，作品请下载保存。', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
