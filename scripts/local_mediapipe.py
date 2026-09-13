"""Rebuild the pinned upstream AAR with a no-op stats factory and no remote loggers."""
import io
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

PREFIX = 'com/google/mediapipe/tasks/core/logging/'
REMOVED = {PREFIX+'RemoteLoggingClient.class', PREFIX+'TasksStatsProtoLogger.class'}
FACTORY = PREFIX+'TasksStatsLoggerFactory.class'

def verify_local(aar):
    with zipfile.ZipFile(aar) as outer, zipfile.ZipFile(io.BytesIO(outer.read('classes.jar'))) as jar:
        if REMOVED.intersection(jar.namelist()): raise ValueError('Remote stats implementation remains in local AAR')
        factory = jar.read(FACTORY)
        if b'TasksStatsDummyLogger' not in factory or b'TasksStatsProtoLogger' in factory:
            raise ValueError('Stats factory is not the no-op implementation')

def build(root, upstream):
    javac = str(Path(os.environ['JAVA_HOME'])/'bin/javac') if os.environ.get('JAVA_HOME') else shutil.which('javac')
    if not javac: raise RuntimeError('JDK compiler required to prepare the local vision runtime')
    with tempfile.TemporaryDirectory(prefix='construct-vision-') as temp:
        temp = Path(temp)
        with zipfile.ZipFile(upstream) as source:
            original = source.read('classes.jar'); (temp/'original.jar').write_bytes(original)
            # Compile-time type only; never included in the output AAR.
            stub = temp/'android/content/Context.java'; stub.parent.mkdir(parents=True)
            stub.write_text('package android.content; public abstract class Context {}\n')
            subprocess.run([javac, '--release', '8', '-g:none', '-classpath', str(temp/'original.jar'), '-d', str(temp/'classes'),
                str(stub), str(root/'third_party/mediapipe/TasksStatsLoggerFactory.java')], check=True)
            patched = io.BytesIO()
            with zipfile.ZipFile(io.BytesIO(original)) as old, zipfile.ZipFile(patched, 'w') as jar:
                if not REMOVED.issubset(old.namelist()) or FACTORY not in old.namelist():
                    raise ValueError('Unexpected upstream logging layout')
                for info in old.infolist():
                    if info.filename in REMOVED: continue
                    data = (temp/'classes'/FACTORY).read_bytes() if info.filename == FACTORY else old.read(info.filename)
                    jar.writestr(info, data)
            target = root/'core/app/libs/mediapipe-core-local.aar'; target.parent.mkdir(parents=True, exist_ok=True)
            stage = temp/'local.aar'
            with zipfile.ZipFile(stage, 'w') as output:
                for info in source.infolist():
                    output.writestr(info, patched.getvalue() if info.filename == 'classes.jar' else source.read(info.filename))
            verify_local(stage)
            shutil.copyfile(stage, target)
    print('Prepared local MediaPipe AAR: no-op logger; remote stats implementations removed')
