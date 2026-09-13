#!/usr/bin/env python3
"""Read-only static registry origin. Put behind a private, trusted HTTPS proxy."""
import argparse
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
from urllib.parse import urlsplit


class RegistryHandler(BaseHTTPRequestHandler):
    def __init__(self, *args, root, **kwargs):
        self.registry_root = root
        super().__init__(*args, **kwargs)

    def do_GET(self):
        url = urlsplit(self.path)
        name = url.path.removeprefix('/')
        if url.query or url.fragment or not re.fullmatch(r'(?:index\.json|[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*\.zip)', name):
            self.send_error(404)
            return
        path = self.registry_root / name
        if not path.is_file() or path.is_symlink() or path.stat().st_size > 4 * 1024 * 1024:
            self.send_error(404)
            return
        data = path.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json' if name == 'index.json' else 'application/zip')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store' if name == 'index.json' else 'public, max-age=31536000, immutable')
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        # Do not log request paths, headers, query strings, or authentication data.
        pass


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1] / 'dist/registry')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(RegistryHandler, root=root))
    print(f'Read-only registry origin listening on loopback port {args.port}; HTTPS proxy required for phone access.', flush=True)
    server.serve_forever()
