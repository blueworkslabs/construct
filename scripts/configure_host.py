#!/usr/bin/env python3
"""Generate ignored, narrowly scoped Android deployment resources; never change defaults."""
import argparse
from pathlib import Path
import ssl
import re
from cryptography import x509
from urllib.parse import urlsplit
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]

def registry_url(value):
    u = urlsplit(value)
    if (u.scheme != 'https' or not u.hostname or u.username is not None or u.password is not None
            or u.query or u.fragment or not u.path.endswith('/index.json')
            or not re.fullmatch(r"https://[A-Za-z0-9.\[\]:_-]+/[A-Za-z0-9_./%-]*index\.json", value)):
        raise ValueError('Registry must be HTTPS /index.json without userinfo, query, fragment or whitespace')
    if u.port is not None and not 1 <= u.port <= 65535:
        raise ValueError('Invalid registry port')
    return u

def configure(registry, ca=None, destination=None):
    u = registry_url(registry)
    cert = None
    if ca is not None:
        cert = Path(ca).read_bytes()
        if b'PRIVATE KEY' in cert or cert.count(b'BEGIN CERTIFICATE') != 1:
            raise ValueError('Supply one public PEM CA certificate, never a private key')
        ssl.PEM_cert_to_DER_cert(cert.decode('ascii'))
        parsed=x509.load_pem_x509_certificate(cert)
        if not parsed.extensions.get_extension_for_class(x509.BasicConstraints).value.ca:
            raise ValueError('Expected a CA certificate')
    base = destination or ROOT / 'core/app/src/deployment/res'
    (base/'values').mkdir(parents=True, exist_ok=True)
    (base/'xml').mkdir(parents=True, exist_ok=True)
    (base/'values/deployment.xml').write_text('<resources><string name="configured_registry" translatable="false">'+escape(registry)+'</string></resources>\n')
    domain = ''
    if cert is not None:
        (base/'raw').mkdir(exist_ok=True)
        (base/'raw/operator_ca.crt').write_bytes(cert)
        domain = ('<domain-config cleartextTrafficPermitted="false"><domain includeSubdomains="false">'
                  +escape(u.hostname)+'</domain><trust-anchors><certificates src="@raw/operator_ca" />'
                  '</trust-anchors></domain-config>')
    # An old certificate file, if present, is unreferenced when system trust is selected.
    (base/'xml/network_security_config.xml').write_text('<?xml version="1.0" encoding="utf-8"?>\n'
        '<network-security-config><base-config cleartextTrafficPermitted="false">'
        '<trust-anchors><certificates src="system" /></trust-anchors></base-config>'
        +domain+'</network-security-config>\n')

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--registry', required=True)
    p.add_argument('--ca-cert', type=Path, help='Optional public PEM CA, trusted only for the registry hostname')
    a=p.parse_args();configure(a.registry,a.ca_cert)
    print('Generated ignored deployment resources; rebuild the APK to apply them.')
