#!/usr/bin/env python3
"""Optional real-DOM Space Watch checks with a fake bridge, not Android consent proof."""
from pathlib import Path
import json, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0,str(Path(__file__).resolve().parent))
ROOT=Path(__file__).resolve().parents[1]
def stub():
 text=(ROOT/'scripts/space-fixture/synthetic-space.js').read_text()
 for marker,name in [('ELEMENTS','elements'),('SATCAT','satcat'),('RECENT','recent'),('RECENT_SATCAT','recent-satcat')]:
  text=text.replace('/*'+marker+'*/ null',(ROOT/'scripts/space-fixture'/(name+'.json')).read_text())
 return text
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':393,'height':850},has_touch=True)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def route(r):
  path=r.request.url.split('http://space.test/',1)[-1]
  f=ROOT/'examples/space-watch-module/ui'/path
  if path=='synthetic-space.js':return r.fulfill(body=stub(),content_type='application/javascript')
  if path=='index.html':return r.fulfill(body=f.read_text().replace('<script src="app.js"></script>','<script src="synthetic-space.js"></script><script src="app.js"></script>'),content_type='text/html')
  if f.is_file():return r.fulfill(path=str(f))
  r.fulfill(status=404,body='')
 page.route('http://space.test/**',route)
 page.add_init_script('''window.mock={store:{},calls:[]};window.construct={postMessage(raw){const q=JSON.parse(raw);mock.calls.push(q);let result=null;if(q.method==='storage.kv'){if(q.params.op==='set')mock.store[q.params.key]=q.params.value;result=mock.store[q.params.key]??null;}else if(q.method==='net.http')result={status:200,text:JSON.stringify(q.params.url.includes('wikipedia')?{query:{pages:[{title:'Long March 4B',extract:'A Chinese launch vehicle.',fullurl:'https://en.wikipedia.org/wiki/Long_March_4B'}]}}:[])};queueMicrotask(()=>construct.onmessage({data:JSON.stringify({id:q.id,result})}));}};''')
 page.goto('http://space.test/index.html');page.wait_for_function("document.querySelector('#counts').textContent.includes('above you')")
 page.locator('#list button[data-id="29507"]').click()
 assert page.locator('#spot-head').inner_text()=='EAST · 1½ fists up'
 assert 'above Saturn' in page.locator('#spot-anchor').inner_text()
 page.locator('#details').click();page.locator('#wiki').click()
 page.wait_for_function("document.querySelector('#wiki').textContent==='Wikipedia loaded'")
 assert 'CC BY-SA 4.0' in page.locator('#info-body').inner_text()
 page.locator('#close-info').click();page.locator('#red').click()
 page.locator('#rewind').fill('-120');assert page.locator('#spot-when').inner_text()=='2 min ago:'
 page.locator('#now').click()
 page.wait_for_function("document.querySelector('#plan-status').textContent==='Tap one to preview it on the dome.'")
 assert page.locator('#plan-list button').count() <= 10
 train=page.locator('#plan-list button[data-id="train:2026-221"]')
 assert train.count()==1
 train.click()
 assert page.locator('#spot-title').inner_text()=='Guowang train'
 assert page.locator('#rewind-label').inner_text().startswith('Preview ')
 assert page.locator('#spot-when').inner_text().startswith('At ')
 page.locator('#details').click()
 assert '9 of 11 from this launch' in page.locator('#info-body').inner_text()
 page.locator('#wiki').click()
 page.wait_for_function("document.querySelector('#wiki').textContent==='Wikipedia loaded'")
 assert page.evaluate("mock.calls.some(c=>c.method==='net.http'&&c.params.url.endsWith('&titles=Guowang'))")
 page.locator('#close-info').click()
 page.locator('#now').click()
 assert page.locator('#rewind-label').inner_text()=='Now'
 assert train.get_attribute('aria-pressed')=='false'
 train.click();assert train.get_attribute('aria-pressed')=='true'
 page.locator('#rewind').fill('-120');assert train.get_attribute('aria-pressed')=='false'
 page.locator('#now').click()
 # Follow rendering and relative guidance in the actual DOM/canvas.
 page.locator('#list button[data-id="29507"]').click()
 page.locator('#follow').click()
 page.wait_for_function("document.querySelector('#follow').getAttribute('aria-pressed')==='true'")
 def orient(sample):page.evaluate("s=>dispatchEvent(new CustomEvent('constructorientation',{detail:s}))",sample)
 orient({'pose':'flat','azimuthDeg':85,'accuracyDeg':12,'calibrate':False})
 assert 'Facing east' in page.locator('#follow-status').inner_text()
 assert page.locator('#follow-status').get_attribute('aria-live')=='off'
 assert page.locator('#spot-turn').get_attribute('aria-live')=='off'
 spoken=page.locator('#follow-announcement').inner_text()
 orient({'pose':'flat','azimuthDeg':95,'accuracyDeg':14,'calibrate':False})
 assert page.locator('#follow-announcement').inner_text()==spoken
 assert page.locator('#spot-turn').is_visible()
 orient({'pose':'flat','calibrate':True})
 assert 'figure 8' in page.locator('#follow-status').inner_text()
 assert page.locator('#spot-turn').is_hidden()
 orient({'watching':False,'reason':'paused'})
 assert page.locator('#follow').get_attribute('aria-pressed')=='false'
 assert 'lost the foreground' in page.locator('#follow-status').inner_text()
 # Re-enter the future train for responsive preview/details checks.
 train.click()
 for width,height,scale in [(393,850,1),(850,393,1),(393,850,2)]:
  page.set_viewport_size({'width':width,'height':height})
  page.evaluate('(scale)=>document.documentElement.style.fontSize=(16*scale)+"px"',scale)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Page horizontal overflow'
  page.locator('#details').click();page.locator('#wiki').click();page.locator('#close-info').click()
 # Actual canvas render and hit testing: a remote bead maps to its train.
 assert page.evaluate("""() => {
   const canvas=document.createElement('canvas');canvas.style.width='320px';document.body.append(canvas);
   let selected=null;const dome=new SpaceDome(canvas,id=>selected=id);
   dome.set({red:false,dark:true,stars:[],lines:[],bodies:[],objects:[{id:'train:test',az:0,el:40,state:'visible',members:[{az:180,el:40}]}]});
   const g=dome.geometry(),p=SpaceDome.project(180,40,g.cx,g.cy,g.r),r=canvas.getBoundingClientRect();
   dome.tap({clientX:r.left+p[0],clientY:r.top+p[1]});canvas.remove();return selected==='train:test';
 }"""),'Rendered train beads must be selectable'
 assert not errors,errors
 print('PASS real DOM: spot selection, explicit Wikipedia, rewind, red mode, planned train preview/back-to-now, portrait/landscape/2x train layout and dialogs')
 browser.close()
