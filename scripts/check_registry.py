#!/usr/bin/env python3
"""Read-only explicit registry checks. No built-in operator endpoint or trust material."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import ssl
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import padding
from configure_host import registry_url

ROOT=Path(__file__).resolve().parents[1]

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def bounded_read(opener, request, maximum):
    with opener.open(request, timeout=10) as response:
        data = response.read(maximum + 1)
    if len(data) > maximum:
        raise ValueError('Response exceeds the configured size limit')
    return data


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--catalog',required=True,action='append',help='Explicit HTTPS index URL, may be repeated')
    p.add_argument('--public-key',type=Path,default=ROOT/'core/app/src/main/assets/registry-public.der')
    p.add_argument('--ca-cert',type=Path)
    a=p.parse_args()
    for url in a.catalog:registry_url(url)
    ctx=ssl.create_default_context(cafile=str(a.ca_cert) if a.ca_cert else None)
    key=serialization.load_der_public_key(a.public_key.read_bytes())
    opener=urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx),NoRedirect())
    for url in a.catalog:
        base=url.rsplit('/',1)[0]+'/'
        index=json.loads(bounded_read(opener,url,1024*1024))
        if index.get('schemaVersion')!=1:raise ValueError('Unexpected catalog schema')
        for module in index['modules']:
            for version in module['versions']:
                artifact=version['artifact']
                if not re.fullmatch(r'[A-Za-z0-9_.-]+\.zip',artifact):raise ValueError('Unsafe artifact path')
                data=bounded_read(opener,base+artifact,4*1024*1024)
                if len(data)>4*1024*1024 or hashlib.sha256(data).hexdigest()!=version['sha256']:raise ValueError('Artifact size/hash mismatch')
                key.verify(base64.b64decode(version['signature'],validate=True),data,padding.PKCS1v15(),hashes.SHA256())
                print('Verified HTTPS/hash/signature:',module['id'],version['version'])
        for path,method,code in [('', 'GET',404),('.publish.lock','GET',404),('missing.zip','GET',404),('nested/nope.zip','GET',404),('index.json?extra=1','GET',404),('index.json','POST',403)]:
            try:bounded_read(opener,urllib.request.Request(base+path,method=method),1024*1024)
            except urllib.error.HTTPError as e:
                if e.code!=code:raise
            else:raise ValueError('Unexpected exposed path or method')
        print('Catalog path/method restrictions passed')

if __name__=='__main__':main()
