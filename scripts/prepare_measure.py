#!/usr/bin/env python3
"""Generate non-personal, known-geometry measurement fixtures (OpenCV 4.12 + Pillow).
Only needed to regenerate committed fixtures; Android/JVM builds do not need OpenCV Python.
"""
from pathlib import Path
import hashlib,json
import cv2
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]/'examples/measure-fixtures'
ROOT.mkdir(parents=True,exist_ok=True)
image=np.full((900,1200,3),255,np.uint8)
marker=cv2.aruco.generateImageMarker(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50),0,300)
image[100:400,100:400]=cv2.cvtColor(marker,cv2.COLOR_GRAY2BGR)
cv2.line(image,(150,700),(870,700),(30,120,30),8)
for x in [150,870]:cv2.circle(image,(x,700),12,(30,120,30),-1)
cv2.putText(image,'A',(140,745),cv2.FONT_HERSHEY_SIMPLEX,1,(0,0,0),2)
cv2.putText(image,'B',(860,745),cv2.FONT_HERSHEY_SIMPLEX,1,(0,0,0),2)
cv2.putText(image,'Synthetic tabletop - 100 mm marker / A-B 240 mm',(450,150),cv2.FONT_HERSHEY_SIMPLEX,.65,(0,0,0),1)
entries=[]
def save(name,img,endpoints=None,expected=None):
    path=ROOT/name
    Image.fromarray(cv2.cvtColor(img,cv2.COLOR_BGR2RGB)).save(path,'PNG')
    entry=dict(name=name,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),bytes=path.stat().st_size,width=1200,height=900)
    if endpoints:entry.update(endpoints=endpoints,expectedMm=expected,markerMm=100)
    entries.append(entry)
save('measure-flat.png',image,[[150,700],[870,700]],240)
source=np.float32([[0,0],[1199,0],[1199,899],[0,899]])
target=np.float32([[160,40],[1130,150],[1190,850],[20,790]])
h=cv2.getPerspectiveTransform(source,target)
angled=cv2.warpPerspective(image,h,(1200,900),borderValue=(230,230,230))
points=cv2.perspectiveTransform(np.float32([[[150,700],[870,700]]]),h)[0].tolist()
save('measure-angled.png',angled,points,240)
save('measure-blank.png',np.full_like(image,255))
multiple=image.copy();multiple[100:400,700:1000]=cv2.cvtColor(marker,cv2.COLOR_GRAY2BGR)
save('measure-multiple.png',multiple)
exif=Image.Exif();exif[274]=6
rotated=ROOT/'measure-oriented.jpg'
Image.fromarray(cv2.cvtColor(image,cv2.COLOR_BGR2RGB)).transpose(Image.Transpose.ROTATE_90).save(rotated,'JPEG',quality=95,exif=exif)
entries.append(dict(name=rotated.name,sha256=hashlib.sha256(rotated.read_bytes()).hexdigest(),bytes=rotated.stat().st_size,width=1200,height=900,endpoints=[[150,700],[870,700]],expectedMm=240,markerMm=100))
(ROOT/'manifest.json').write_text(json.dumps(entries,indent=2)+'\n')
