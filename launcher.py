"""Windows desktop entry point; the same loopback-only writing server."""
import argparse
import json
from pathlib import Path
import ssl
import threading
import tkinter as tk
from tkinter import messagebox, ttk
from urllib.request import ProxyHandler, build_opener
import webbrowser

from plugin import build_messages
from server import API_PROTOCOL, Handler, LocalHTTPServer, VERSION

APP_ID = 'aitext-literary'


def read_running_server(port):
    """Only inspect localhost directly, without forwarding local traffic to a proxy."""
    try:
        with build_opener(ProxyHandler({})).open(f'http://127.0.0.1:{port}/api/config', timeout=2) as reply:
            data = json.loads(reply.read(200000))
        if (isinstance(data, dict) and data.get('application') == APP_ID
                and data.get('version') == VERSION and data.get('api_protocol') == API_PROTOCOL):
            return True
    except (OSError, ValueError):
        pass
    return False


def acquire_server(port):
    try:
        return LocalHTTPServer(('127.0.0.1', port), Handler)
    except OSError:
        if read_running_server(port):
            return None
        raise RuntimeError(f'本地端口 {port} 已被其他程序或旧版 ai文字占用。\n'
                           '请先保存稿件，再关闭旧启动窗口；本程序不会自动停止其他服务。\n'
                           f'如需独立地址，可运行：ai文字.exe --port {port + 1}') from None


def open_browser(root, url):
    try:
        opened = webbrowser.open(url)
    except OSError:
        opened = False
    if not opened:
        messagebox.showinfo('打开写作台', f'请把这个地址复制到浏览器：\n{url}', parent=root)


def build_window(root, server):
    url = f'http://127.0.0.1:{server.server_port}/'
    root.title(f'ai文字 · 启动器 v{VERSION}')
    root.geometry('560x280')
    root.resizable(False, False)
    frame = ttk.Frame(root, padding=24)
    frame.pack(fill='both', expand=True)
    ttk.Label(frame, text='ai文字 · 文学写作台', font=('Microsoft YaHei UI', 18)).pack(anchor='w')
    ttk.Label(frame, text='服务正在运行，可以在浏览器中写作。', padding=(0, 12)).pack(anchor='w')
    address = ttk.Entry(frame, font=('Segoe UI', 12))
    address.insert(0, url)
    address.configure(state='readonly')
    address.pack(fill='x', pady=(0, 12))
    ttk.Label(frame, text='关闭浏览器不会停止服务。退出启动器前，请下载需要保留的稿件。',
              wraplength=500).pack(anchor='w')
    buttons = ttk.Frame(frame)
    buttons.pack(fill='x', pady=(18, 0))
    ttk.Button(buttons, text='打开写作台', command=lambda: open_browser(root, url)).pack(side='left')

    def stop():
        if messagebox.askokcancel('停止 ai文字', '请确认已下载需要保留的稿件。\n停止后，正在生成的任务可能中断。', parent=root):
            root.destroy()

    ttk.Button(buttons, text='停止并退出', command=stop).pack(side='right')
    root.protocol('WM_DELETE_WINDOW', stop)
    return url


def smoke_test(report_path):
    """Exercise bundled resources, the launcher UI and local HTTP; no provider requests."""
    root = None
    server = None
    thread = None
    report = {'ok': False, 'version': VERSION}
    try:
        root = tk.Tk()
        root.withdraw()
        server = acquire_server(0)
        url = build_window(root, server)
        root.update()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        opener = build_opener(ProxyHandler({}))
        assets = {}
        for path in ('', 'app.js', 'state.js', 'style.css', 'api/config'):
            with opener.open(url + path, timeout=5) as reply:
                assets[path or 'index.html'] = reply.read()
        config = json.loads(assets['api/config'])
        assert config['application'] == APP_ID and config['version'] == VERSION
        assert len(config['providers']) == 10
        for stage in ('draft', 'review', 'revise'):
            assert build_messages({'brief': '写一个清晨的场景。'}, stage=stage, draft='清晨。', review='保留细节。')
        assert all(assets.values())
        assert ssl.create_default_context().cert_store_stats()['x509_ca'] > 0
        report.update(ok=True, providers=len(config['providers']), gui=root.title(),
                      assets={name: len(data) for name, data in assets.items()}, tls=True)
    except Exception as error:
        report['error'] = type(error).__name__ + ': ' + str(error)
    finally:
        if server:
            if thread:
                server.shutdown()
                thread.join(timeout=3)
            server.server_close()
        if root:
            root.destroy()
        Path(report_path).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    return 0 if report['ok'] else 1


def main():
    parser = argparse.ArgumentParser(description='ai文字 Windows 启动器')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true', help='启动后不自动打开浏览器')
    parser.add_argument('--self-test', metavar='REPORT', help='只检查打包完整性并写入报告，不调用模型')
    args = parser.parse_args()
    if args.self_test:
        return smoke_test(args.self_test)
    root = tk.Tk()
    root.withdraw()
    server = None
    thread = None
    try:
        if not 1 <= args.port <= 65535:
            raise ValueError('端口须在 1 至 65535 之间。')
        server = acquire_server(args.port)
        if server is None:
            if not args.no_browser:
                open_browser(root, f'http://127.0.0.1:{args.port}/')
            return 0
        url = build_window(root, server)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        root.deiconify()
        if not args.no_browser:
            root.after(150, lambda: open_browser(root, url))
        root.mainloop()
        return 0
    except Exception as error:
        messagebox.showerror('ai文字启动失败', str(error), parent=root)
        return 1
    finally:
        if server:
            if thread:
                server.shutdown()
                thread.join(timeout=3)
            server.server_close()
        try:
            root.destroy()
        except tk.TclError:
            pass


if __name__ == '__main__':
    raise SystemExit(main())
