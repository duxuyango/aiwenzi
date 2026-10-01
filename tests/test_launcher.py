"""Launcher service ownership checks; no browser or model provider calls."""
from http.server import BaseHTTPRequestHandler
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from launcher import acquire_server, read_running_server
from server import Handler, LocalHTTPServer


class ForeignHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"version":"1.3.1","api_protocol":5}')


class LauncherTests(unittest.TestCase):
    def running_server(self, handler=Handler):
        server = LocalHTTPServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def close():
            server.shutdown()
            thread.join(timeout=3)
            server.server_close()

        self.addCleanup(close)
        return server.server_port

    def test_free_port_is_owned_and_uses_loopback(self):
        server = acquire_server(0)
        self.addCleanup(server.server_close)
        self.assertEqual(server.server_address[0], '127.0.0.1')
        self.assertGreater(server.server_port, 0)

    def test_duplicate_launch_reuses_same_compatible_server(self):
        port = self.running_server()
        self.assertTrue(read_running_server(port))
        self.assertIsNone(acquire_server(port))

    def test_old_version_is_rejected_without_switching_ports(self):
        port = self.running_server()
        with patch('launcher.VERSION', 'older-version'):
            self.assertFalse(read_running_server(port))
            with self.assertRaisesRegex(RuntimeError, '旧版'):
                acquire_server(port)
        self.assertTrue(read_running_server(port))

    def test_unrelated_service_is_not_reused_or_stopped(self):
        port = self.running_server(ForeignHandler)
        self.assertFalse(read_running_server(port))
        with self.assertRaisesRegex(RuntimeError, '占用'):
            acquire_server(port)


if __name__ == '__main__':
    unittest.main()
