import datetime
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch
from cryptography import x509
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
import configure_host
import build_demo

class HostConfigurationTests(unittest.TestCase):
    def test_invalid_registry_cannot_generate_configuration(self):
        for url in ('http://example.org/index.json','https://example.org/index.json?x=1','https://example.org/index.json#x','https://example.org/catalog','https://example.org /index.json', "https://example.org/it's/index.json"):
            with self.subTest(url=url),self.assertRaises(ValueError):configure_host.registry_url(url)

    def test_system_trust_profile_has_no_private_anchor(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);configure_host.configure('https://registry.example.org/modules/index.json',destination=root)
            xml=ET.parse(root/'xml/network_security_config.xml').getroot()
            self.assertIsNone(xml.find('domain-config'))
            self.assertEqual(xml.find('base-config/trust-anchors/certificates').get('src'),'system')

    def test_ca_trust_is_exact_host_and_reset_drops_reference(self):
        key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Synthetic test CA')])
        now=datetime.datetime.now(datetime.timezone.utc)
        cert=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(1).not_valid_before(now).not_valid_after(now+datetime.timedelta(days=1)).add_extension(x509.BasicConstraints(ca=True,path_length=None),critical=True).sign(key,hashes.SHA256())
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);ca=root/'ca.crt';ca.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
            configure_host.configure('https://registry.example.org/modules/index.json',ca,root/'res')
            xml=ET.parse(root/'res/xml/network_security_config.xml').getroot()
            domain=xml.find('domain-config/domain')
            self.assertEqual(domain.text,'registry.example.org');self.assertEqual(domain.get('includeSubdomains'),'false')
            configure_host.configure('https://registry.example.org/modules/index.json',destination=root/'res')
            self.assertNotIn('operator_ca',(root/'res/xml/network_security_config.xml').read_text())

    def test_non_certificate_rejected_without_generating_resources(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);ca=root/'invalid.crt';ca.write_text('not a certificate')
            with self.assertRaises(ValueError):configure_host.configure('https://example.org/index.json',ca,root/'res')
            self.assertFalse((root/'res').exists())

    def test_development_signer_cannot_write_into_checkout(self):
        with patch.object(build_demo,'KEY_DIR',build_demo.ROOT/'ignored-signing-test'):
            with self.assertRaisesRegex(ValueError,'outside'):build_demo.signing_key()
        self.assertFalse((build_demo.ROOT/'ignored-signing-test').exists())

if __name__=='__main__':unittest.main()
