import functools
import http.client
from http.server import ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest

from serve_registry import RegistryHandler


class RegistryTest(unittest.TestCase):
    def test_only_catalog_and_packages_are_served(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'index.json').write_text('{"schemaVersion":1,"modules":[]}')
            (root / 'hello-0.1.0.zip').write_bytes(b'package')
            (root / 'private.pem').write_text('test-only sentinel, not a key')
            (root / 'link.zip').symlink_to(root / 'private.pem')
            server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(RegistryHandler, root=root))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                for path, expected in [('/index.json', 200), ('/hello-0.1.0.zip', 200),
                                       ('/', 404), ('/private.pem', 404), ('/link.zip', 404),
                                       ('/../private.pem', 404), ('/%2e%2e/private.pem', 404),
                                       ('/index.json?token=test', 404)]:
                    client = http.client.HTTPConnection('127.0.0.1', server.server_port)
                    client.request('GET', path)
                    response = client.getresponse()
                    self.assertEqual(expected, response.status, path)
                    response.read()
                    client.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
