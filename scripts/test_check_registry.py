import io
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import Mock
from check_registry import bounded_read, NoRedirect

class RegistryReadTests(unittest.TestCase):
    def test_oversized_response_is_rejected_not_truncated(self):
        opener=Mock();opener.open.return_value=io.BytesIO(b'12345')
        with self.assertRaises(ValueError):bounded_read(opener,'https://example.org/index.json',4)

    def test_redirect_cannot_substitute_another_endpoint(self):
        class Redirect(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(302)
                self.send_header('Location','https://elsewhere.invalid/index.json')
                self.end_headers()
            def log_message(self,*args): pass
        server=HTTPServer(('127.0.0.1',0),Redirect)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            opener=urllib.request.build_opener(NoRedirect())
            with self.assertRaises(urllib.error.HTTPError) as error:
                bounded_read(opener,'http://127.0.0.1:'+str(server.server_port)+'/index.json',100)
            self.assertEqual(error.exception.code,302)
        finally:
            server.shutdown();server.server_close();thread.join()
