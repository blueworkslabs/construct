#!/usr/bin/env python3
"""Real DOM/canvas Follow checks with a fake bridge; not native consent proof."""
from pathlib import Path
import json
import subprocess
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':393,'height':850},has_touch=True,device_scale_factor=2)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    def route(r):
        path=r.request.url.split('http://sky.test/',1)[-1]
        f=ROOT/'examples/sky-watch-module/ui'/path
        if f.is_file():return r.fulfill(path=str(f))
        r.fulfill(status=404,body='')
    page.route('http://sky.test/**',route)
    page.add_init_script('''window.mock={store:{},calls:[]};window.construct={postMessage(raw){const q=JSON.parse(raw);mock.calls.push(q);let result=null;if(q.method==='storage.kv'){if(q.params.op==='set')mock.store[q.params.key]=q.params.value;result=mock.store[q.params.key]??null;}else if(q.method==='location.read')result={latitude:50.0379,longitude:8.5622,accuracyM:12};else if(q.method==='orientation.read')result={watching:q.params.op==='watch'};else if(q.method==='net.http')result=q.params.url.includes('/v2/')?{status:200,text:JSON.stringify({now:Date.now(),ac:[{hex:'abc123',flight:'SYNTHETIC',t:'A320',lat:50.2,lon:8.5622,alt_baro:32808,gs:0,track:90,seen_pos:0}]})}:{status:404,text:''};queueMicrotask(()=>construct.onmessage({data:JSON.stringify({id:q.id,result})}));}};''')
    page.goto('http://sky.test/index.html');page.wait_for_function("document.querySelector('#count').textContent==='1 aircraft'")
    page.locator('#follow').click();page.wait_for_function("document.querySelector('#follow').getAttribute('aria-pressed')==='true'")
    def orient(s):page.evaluate("s=>dispatchEvent(new CustomEvent('constructorientation',{detail:{timestamp:Date.now(),...s}}))",s)
    orient({'pose':'flat','azimuthDeg':87,'pitchDeg':88,'rollDeg':0,'calibrate':False,'accuracyDeg':12})
    assert 'Facing E' in page.locator('#follow-status').inner_text()
    page.locator('#aircraft-list button').first.click()
    assert 'Turn left' in page.locator('.selected-turn').inner_text()
    def point(az,el,roll=0,calibrate=False):
        sample=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./scripts/space-fixture/orientation-sample.cjs')(...JSON.parse(process.argv[1]),{declination:3.3})))",json.dumps([az,el,roll])],cwd=ROOT,text=True))
        sample['calibrate']=calibrate
        for _ in range(25):orient(sample)
    point(20,29)
    page.wait_for_timeout(500)
    assert page.locator('#pointer-wrap').is_visible()
    assert page.locator('#map').get_attribute('aria-hidden')=='true'
    assert page.locator('#pointer').evaluate("c=>c.width>0&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some(v=>v!==0)")
    point(20,29,calibrate=True);assert 'figure 8' in page.locator('#follow-announcement').inner_text()
    point(20,29);assert 'figure 8' not in page.locator('#follow-announcement').inner_text()
    for width,height,scale in [(393,850,1),(850,393,1),(393,850,2)]:
        page.set_viewport_size({'width':width,'height':height})
        page.evaluate('(scale)=>document.documentElement.style.fontSize=(16*scale)+"px"',scale)
        point(20,60,35)
        page.wait_for_timeout(500)
        assert page.evaluate("()=>{const w=document.querySelector('#pointer-wrap');return w.scrollHeight<=w.clientHeight+1;}"),'pointing grid must not overflow or hide guidance'
        assert page.locator('#pointer').evaluate('c=>{const r=c.getBoundingClientRect();return r.width>0&&Math.abs(r.width-r.height)<1;}'),'pointer stays square without distorted aiming geometry'
        page.locator('#point-guide').scroll_into_view_if_needed()
        assert page.locator('#point-guide').is_visible()
        assert page.evaluate("()=>{const w=document.querySelector('#map-wrap').getBoundingClientRect(),g=document.querySelector('#point-guide').getBoundingClientRect();return g.top>=w.top&&g.bottom<=w.bottom+1;}"),'visible guidance must stay inside the unclipped frame'
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'horizontal overflow'
    page.wait_for_timeout(1600);assert page.locator('#pointer-wrap').is_hidden()
    assert not errors,errors
    browser.close()
print('Sky browser checks passed: heads-up map, selected guidance, native-sample-shaped pointing, calibration recovery, high/roll, responsive layouts, expiry.')
