"""Operator-owned runner configuration. No implicit authorization to reset a device."""
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import socket
from urllib.parse import urlsplit

SCRIPT_ROOT = Path(__file__).resolve().parent
SERIAL = 'emulator-5554'  # Deliberately not configurable to a physical phone.

@dataclass(frozen=True)
class RunnerConfig:
    root: Path
    sdk: Path
    avd: Path
    host: str
    home_catalog: str
    test_catalog: str
    disposable: bool
    service: str = 'construct-emulator-public.service'
    api_level: int = 36
    single_avd: bool = False

    def profile(self, camera=False):
        # A single space-saving AVD always uses synthetic camera hardware,
        # including baseline runs, so snapshot hardware never changes.
        dedicated_camera = camera and not self.single_avd
        return (f'construct-camera{self.api_level}' if dedicated_camera else f'construct-api{self.api_level}',
                'camera-clean' if dedicated_camera else 'clean', camera or self.single_avd)

def catalog(value):
    if not isinstance(value,str) or not re.fullmatch(r'https://[A-Za-z0-9._:-]+/[A-Za-z0-9_./-]*index\.json',value):
        raise ValueError('Catalog must be a shell-safe HTTPS index URL without userinfo or query')
    u=urlsplit(value)
    if not u.hostname or not u.path.endswith('/index.json') or u.port is not None and not 1<=u.port<=65535:
        raise ValueError('Invalid catalog')
    return value

def load(path=None):
    path=Path(path or os.environ.get('CONSTRUCT_RUNNER_CONFIG',SCRIPT_ROOT/'runner.local.json'))
    if not path.exists():
        return RunnerConfig(SCRIPT_ROOT,SCRIPT_ROOT/'sdk',SCRIPT_ROOT/'avd','','','',False)
    raw=json.loads(path.read_text())
    optional={'service','api_level','single_avd'}
    fields={'root','sdk','avd','host','home_catalog','test_catalog','disposable'} | optional
    if set(raw)-fields or not fields-optional <= set(raw):raise ValueError('Missing or unexpected runner configuration fields')
    for key in ('root','sdk','avd'):
        if not isinstance(raw[key],str) or not Path(raw[key]).is_absolute() or re.search(r'\s|["\\%]',raw[key]):
            raise ValueError('Runner paths must be absolute and contain no whitespace, quotes, backslash or percent')
    if not isinstance(raw['host'],str) or not re.fullmatch(r'[A-Za-z0-9_.-]+',raw['host']):raise ValueError('Expected hostname required')
    if type(raw['disposable']) is not bool:raise ValueError('Disposable flag must be a JSON boolean')
    service=raw.get('service','construct-emulator-public.service')
    if not re.fullmatch(r'construct-emulator-[A-Za-z0-9_-]+\.service',service):raise ValueError('Explicit Construct emulator service required')
    api=raw.get('api_level',36)
    single=raw.get('single_avd',False)
    if type(api) is not int or not 28 <= api <= 99:raise ValueError('Expected integer Android API level 28..99')
    if type(single) is not bool:raise ValueError('Single AVD flag must be a JSON boolean')
    return RunnerConfig(*(Path(raw[k]).resolve() for k in ('root','sdk','avd')),raw['host'],catalog(raw['home_catalog']),catalog(raw['test_catalog']),raw['disposable'],service,api,single)

CONFIG=load()

def require_runner(config=None):
    c=config or CONFIG
    if not c.disposable or c.host!=socket.gethostname():raise RuntimeError('Runner requires explicit disposable authorization and matching hostname')
    if c.root != SCRIPT_ROOT:raise RuntimeError('Configured root must be this installed runner directory')
    return c
