"""Only reuse an explicitly installed development provider with verified APK bytes."""
import re

def installed_provider_sha(adb):
    present='package:com.android.webview' in adb('shell','pm','list','packages','com.android.webview').splitlines()
    if not present:return None
    paths=adb('shell','pm','path','com.android.webview').splitlines()
    if len(paths)!=1 or not paths[0].startswith('package:/data/app/'):return None
    installed=paths[0].removeprefix('package:').strip()
    fields=adb('shell','sha256sum',installed,timeout=90).split()
    if not fields or not re.fullmatch(r'[0-9a-f]{64}',fields[0]):raise RuntimeError('Invalid installed WebView hash output')
    return fields[0]
