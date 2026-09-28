#!/usr/bin/env python3
"""Optional real-DOM Space Watch checks with a fake bridge, not Android consent proof."""
from pathlib import Path
import json, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0,str(Path(__file__).resolve().parent))
ROOT=Path(__file__).resolve().parents[1]
def stub():
 text=(ROOT/'scripts/space-fixture/synthetic-space.js').read_text()
 for marker,name in [('/*ELEMENTS*/ null','elements.json'),('/*SATCAT*/ null','satcat.json')]:
  text=text.replace(marker,(ROOT/'scripts/space-fixture'/name).read_text())
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
 for width,height,scale in [(393,850,1),(850,393,1),(393,850,2)]:
  page.set_viewport_size({'width':width,'height':height})
  page.evaluate('(scale)=>document.documentElement.style.fontSize=(16*scale)+"px"',scale)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Page horizontal overflow'
  page.locator('#details').click();page.locator('#wiki').click();page.locator('#close-info').click()
 assert not errors,errors
 print('PASS real DOM: spot selection, explicit Wikipedia, rewind, red mode, portrait/landscape/2x layout and dialogs')
 browser.close()
