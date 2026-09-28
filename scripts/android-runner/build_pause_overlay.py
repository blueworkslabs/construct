#!/usr/bin/env python3
"""Build a disposable translucent test activity; never bundled with the host.
Uses the Android SDK/JDK and an ephemeral, local-only signing identity.
"""
import argparse,os,subprocess,zipfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);a=p.parse_args()
sdk=Path(os.environ['ANDROID_HOME']);jdk=Path(os.environ['JAVA_HOME']);bt=sdk/'build-tools/35.0.0';jar=sdk/'platforms/android-35/android.jar'
src=Path(__file__).parent/'pause-overlay';out=a.out.resolve();out.mkdir(parents=True,exist_ok=False)
classes=out/'classes';classes.mkdir();dex=out/'dex';dex.mkdir()
def run(*args):subprocess.run([str(x) for x in args],check=True,stdout=subprocess.DEVNULL)
run(bt/'aapt','package','-f','-M',src/'AndroidManifest.xml','-S',src/'res','-I',jar,'-F',out/'unsigned.apk')
run(jdk/'bin/javac','-source','8','-target','8','-classpath',jar,'-d',classes,src/'PauseActivity.java')
run(bt/'d8','--lib',jar,'--min-api','26','--output',dex,*classes.rglob('*.class'))
with zipfile.ZipFile(out/'unsigned.apk','a') as z:z.write(dex/'classes.dex','classes.dex')
run(bt/'zipalign','-p','4',out/'unsigned.apk',out/'aligned.apk')
subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=Construct disposable lifecycle fixture','-keyout',str(out/'key.pem'),'-out',str(out/'cert.pem')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
run('openssl','pkcs8','-topk8','-nocrypt','-in',out/'key.pem','-outform','DER','-out',out/'key.der')
run(bt/'apksigner','sign','--key',out/'key.der','--cert',out/'cert.pem','--out',out/'pause-overlay.apk',out/'aligned.apk')
run(bt/'apksigner','verify',out/'pause-overlay.apk')
print(out/'pause-overlay.apk')
