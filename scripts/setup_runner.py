#!/usr/bin/env python3
"""Stage a configured runner in a NEW directory; no SDK install, service start or data reset."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import sys

SOURCE=Path(__file__).resolve().parent/'android-runner'

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',required=True,type=Path)
    p.add_argument('--expected-host',required=True)
    p.add_argument('--home-catalog',required=True)
    p.add_argument('--test-catalog',required=True)
    p.add_argument('--sdk',type=Path)
    p.add_argument('--avd-home',type=Path)
    p.add_argument('--api-level',type=int,default=36)
    p.add_argument('--single-avd',action='store_true',help='Share one app-free synthetic-camera snapshot across scopes')
    p.add_argument('--memory-mb',type=int,default=2048)
    p.add_argument('--enable-direct-memory',action='store_true',help='Enable required emulator graphics direct-memory/shared-slot features; record its evidence')
    p.add_argument('--service',default='construct-emulator-public.service')
    a=p.parse_args();root=a.root.expanduser().resolve()
    if root.exists():raise SystemExit('Runner root already exists; no files were replaced')
    raw=dict(root=str(root),sdk=str((a.sdk or root/'sdk').expanduser().resolve()),avd=str((a.avd_home or root/'avd').expanduser().resolve()),host=a.expected_host,home_catalog=a.home_catalog,test_catalog=a.test_catalog,disposable=True,api_level=a.api_level,single_avd=a.single_avd,service=a.service,direct_memory=a.enable_direct_memory,memory_mb=a.memory_mb)
    spec=importlib.util.spec_from_file_location('runner_config',SOURCE/'config.py');module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
    # Validate the chosen values before creating the target directory.
    import tempfile
    with tempfile.TemporaryDirectory() as temporary:
        f=Path(temporary)/'runner.local.json';f.write_text(json.dumps(raw));module.load(f)
    root.mkdir(parents=True,mode=0o700)
    for path in SOURCE.iterdir():
        if path.is_file() and (path.suffix in ('.py','.sh') or path.name=='requirements.txt'):
            shutil.copy2(path,root/path.name)
    config=root/'runner.local.json';config.write_text(json.dumps(raw,indent=2)+'\n');config.chmod(0o600)
    unit=(SOURCE/'construct-emulator.service').read_text().replace('/REPLACE_WITH_RUNNER_ROOT',str(root))
    (root/a.service).write_text(unit)
    (root/'results').mkdir(mode=0o700)
    print('Runner staged. Provision the SDK, virtualenv and app-free AVD snapshots before installing/starting its on-demand user service.')

if __name__=='__main__':main()
