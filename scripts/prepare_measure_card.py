#!/usr/bin/env python3
"""Generate vector A4 reference card; requires OpenCV 4.12 and ReportLab."""
from pathlib import Path
import cv2
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.pagesizes import A4
out=Path(__file__).resolve().parents[1]/'docs/assets'
out.mkdir(parents=True,exist_ok=True)
dictionary=cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
marker=cv2.aruco.generateImageMarker(dictionary,0,600)
p=out/'pocket-measure-reference-A4.pdf'
c=canvas.Canvas(str(p),pagesize=A4,invariant=True)
c.setTitle('Pocket Measure - 100 mm ArUco reference')
c.setAuthor('Construct')
c.setFont('Helvetica-Bold',20);c.drawString(20*mm,277*mm,'Pocket Measure: reference card')
c.setFont('Helvetica',11)
for y,line in [(267,'ArUco dictionary: DICT_4X4_50   |   Marker ID: 0'),(259,'Outer black square: 100 x 100 mm   |   A4 paper'),(246,'PRINT AT 100% / ACTUAL SIZE. Turn off Fit / Shrink to page.'),(239,'Use matte white paper. Keep the entire black square and white margin.')]:
 c.drawString(20*mm,y*mm,line)
x,y=50*mm,125*mm
c.setFillColorRGB(0,0,0)
for row in range(6):
 for col in range(6):
  if marker[row*100+50,col*100+50]==0:
   c.rect(x+col*100*mm/6,y+(5-row)*100*mm/6,100*mm/6,100*mm/6,fill=1,stroke=0)
c.setFont('Helvetica',10);c.drawCentredString(100*mm,117*mm,'Measure the OUTSIDE edges of the black square.')
# Independent print-scale bars, exactly 100 mm end to end.
c.setLineWidth(0.6)
c.line(50*mm,104*mm,150*mm,104*mm)
for i in range(11):
 xx=(50+10*i)*mm;c.line(xx,102*mm,xx,(107 if i%5==0 else 105.5)*mm)
for v in (0,50,100):c.drawCentredString((50+v)*mm,98*mm,str(v))
c.drawCentredString(100*mm,91*mm,'Horizontal print check: 100 mm')
c.line(165*mm,125*mm,165*mm,225*mm)
for i in range(11):
 yy=(125+10*i)*mm;c.line(163*mm,yy,(168 if i%5==0 else 166.5)*mm,yy)
c.saveState();c.translate(178*mm,175*mm);c.rotate(90);c.drawCentredString(0,0,'Vertical print check: 100 mm');c.restoreState()
c.setFont('Helvetica-Bold',11);c.drawString(20*mm,76*mm,'Before measuring')
c.setFont('Helvetica',10)
lines=[
 '1. Measure the black-square width AND height with a physical ruler.',
 '   They must match. Enter the measured side, not the nominal print size.',
 '2. Lay the sheet flat. Put thin, flat items beside it, not on top of the marker.',
 '3. Keep all four marker corners visible; avoid glare, blur and extreme angles.',
 '4. Prefer the normal 1x camera. Keep the card close to the measured item.',
 '5. In Pocket Measure, choose the saved photo, confirm size and tap two ends.',
 'Measurements apply to the marker plane; raised points can introduce error.'
]
for i,line in enumerate(lines):c.drawString(20*mm,(68-i*5)*mm,line)
c.showPage();c.save()
print(p)
