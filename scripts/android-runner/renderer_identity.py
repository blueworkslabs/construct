"""Strict parsing for the disposable runner's single-renderer loss injection."""
import re


def selected_provider(report):
    matches = re.findall(r'^\s*Current WebView package \(name, version\): \(([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+), [^)]+\)\s*$', report, re.M)
    if len(matches) != 1:
        raise RuntimeError('Cannot uniquely identify the active WebView provider')
    return matches[0]


def renderer_candidates(processes, provider):
    candidates = {}
    for line in processes.splitlines()[1:]:
        fields = line.split(None, 2)
        if len(fields) != 3:
            continue
        pid, uid, args = fields
        if not args.startswith(provider + ':sandboxed_process') or 'SandboxedProcessService' not in args:
            continue
        if not pid.isdigit() or int(pid) <= 0:
            raise RuntimeError('Invalid renderer PID')
        if not (re.fullmatch(r'u0_i\d+', uid) or (uid.isdigit() and 90000 <= int(uid) <= 99999)):
            raise RuntimeError('Renderer is not an isolated UID')
        candidates[pid] = {'uid': uid, 'args': args}
    return candidates
