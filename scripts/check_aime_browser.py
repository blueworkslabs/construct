#!/usr/bin/env python3
"""Aimé late-result, moving-pinch, magnifier, point-drag/undo, map-ruler,
map-pin-in-photo and API 0.13 capture-metadata regressions using Playwright
Chromium.
Install playwright and its Chromium browser in an isolated Python environment.
This uses synthetic pixels and a fake bridge; it does not test host permissions.
"""

from pathlib import Path
import json
import argparse


# Optional browser regression: fake bridge, not Android/authority acceptance.
def main():
    from playwright.sync_api import sync_playwright

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-root", type=Path, default=Path(__file__).resolve().parents[1]
    )
    args = parser.parse_args()
    root = args.source_root.resolve()
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = b.new_page(viewport={"width": 420, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        def route(r):
            path = r.request.url.split("http://aime.test/", 1)[-1]
            if path == "synthetic-aime.js":
                f = root / "scripts/aime-fixture/synthetic-aime.js"
            else:
                f = root / "examples/aime-module/ui" / path
            if path == "index.html":
                html = f.read_text().replace(
                    '<script src="app.js"></script>',
                    '<script src="synthetic-aime.js"></script><script src="app.js"></script>',
                )
                r.fulfill(body=html, content_type="text/html")
                return
            if f.is_file():
                r.fulfill(path=str(f))
            else:
                r.fulfill(status=404, body="")

        page.route("http://aime.test/**", route)
        page.add_init_script(
            """window.mock={store:{},sets:[],captures:[],photos:[{id:'photo1',ref:'ref1'}]};window.construct={postMessage(raw){let q=JSON.parse(raw),result=null;if(q.method==='storage.kv'){if(q.params.op==='get')result=mock.store[q.params.key]??null;else{mock.store[q.params.key]=q.params.value;mock.sets.push(q.params.key);}}else if(q.method==='camera.photo'){mock.captures.push(q.params);const n=mock.photos.length+1;mock.photos=[...mock.photos,{id:'photo'+n,ref:'ref'+n}];result={saved:true,id:'photo'+n,capture:{zoomRatio:1}};}else if(q.method==='photos.library'){if(q.params.op==='list')result={photos:mock.photos,limit:8};else if(q.params.op==='open')result={url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',width:1,height:1};}queueMicrotask(()=>construct.onmessage({data:JSON.stringify({id:q.id,result})}));}};"""
        )
        page.goto("http://aime.test/index.html")
        page.wait_for_function("!state.busy && state.items.length===1")
        page.evaluate(
            """async()=>{state.store={photo1:AimeCore.newSidecar({...SyntheticAime.viewer,accuracyM:10,timestamp:Date.now()})};await openPhoto('photo1');const f=AimeCore.parseCell(AimeCore.parseIndex(SyntheticAime.index()),'46_9',SyntheticAime.cell('46_9')).find(f=>f.name==='Synthetic Tower A');await update(s=>({...s,marks:[AimeCore.markFrom(f,SyntheticAime.taps.markA.x,SyntheticAime.taps.markA.y)]}));}"""
        )
        # A WebView may omit the compatibility click after a long press.
        # Hiding the module during the fallback delay must cancel placement.
        page.evaluate("setMode('horizon');state.horizonExplained=true;$('stage').addEventListener('click',e=>e.stopImmediatePropagation(),{capture:true,once:true})")
        page.locator('#stage').scroll_into_view_if_needed()
        r = page.locator('#stage').bounding_box()
        cdp0 = page.context.new_cdp_session(page)
        cdp0.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':r['x']+r['width']*.7,'y':r['y']+r['height']*.6,'id':1}]})
        page.wait_for_timeout(450)
        cdp0.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        page.evaluate("window.dispatchEvent(new CustomEvent('constructvisibilitychange',{detail:{visible:false}}))")
        page.wait_for_timeout(400)
        assert page.evaluate('current().horizon.length === 0'), 'Deferred hold saved a horizon point after module was hidden'
        page.evaluate("window.dispatchEvent(new CustomEvent('constructvisibilitychange',{detail:{visible:true}}));setMode('what')")
        print('PASS hiding module cancels deferred hold placement')
        # A cached lookup opens synchronously enough for pointerup -> click
        # retargeting on touch WebViews. At 2x text a candidate lies under the tap.
        page.set_viewport_size({"width": 360, "height": 604})
        page.evaluate("document.documentElement.style.fontSize='32px';setMode('what')")
        page.locator("#stage").scroll_into_view_if_needed()
        page.evaluate("features()")
        r = page.locator("#stage").bounding_box()
        x, y = r["x"] + r["width"] * 0.66, r["y"] + r["height"] * 0.42
        cdp = page.context.new_cdp_session(page)
        cdp.send(
            "Input.dispatchTouchEvent",
            {"type": "touchStart", "touchPoints": [{"x": x, "y": y, "id": 1}]},
        )
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        page.wait_for_timeout(500)
        assert page.locator(
            "#candidates-dialog"
        ).is_visible(), "Photo tap clicked through candidate dialog"
        assert page.evaluate(
            "state.pane === 'photo'"
        ), "Same touch selected a candidate"
        page.locator("#close-candidates").click()
        page.set_viewport_size({"width": 420, "height": 900})
        page.evaluate("document.documentElement.style.fontSize=''")
        print("PASS touch tap opens candidates without selecting one at 2x text")
        # A delayed feature response while the visible Photos control leaves the photo.
        page.evaluate(
            """()=>{const old=call;window.originalCall=call;const gate=new Promise(r=>window.releaseFetch=r);call=(m,p)=>m==='net.http'?gate.then(()=>SyntheticAime.answer(p.url)):old(m,p);state.features.clear();state.data=AimeCore.landmarkData(dataGet);window.pendingWhat=task(()=>whatsThat(.7,.4));}"""
        )
        page.click("#back")
        page.evaluate("releaseFetch()")
        page.wait_for_timeout(100)
        print(
            json.dumps(
                {
                    "navigation": page.evaluate(
                        '({selectedId:state.selectedId,busy:state.busy,status:document.getElementById("status").textContent,libraryVisible:!document.getElementById("library").hidden,dialog:document.getElementById("candidates-dialog").open})'
                    ),
                    "pageErrors": errors,
                }
            )
        )
        assert page.evaluate(
            '!document.getElementById("candidates-dialog").open'
        ), "Late result opened over library"
        page.wait_for_function("!state.busy")
        page.evaluate("openPhoto('photo1')")
        page.locator("#stage").scroll_into_view_if_needed()
        page.evaluate(
            "()=>{const r=$('stage').getBoundingClientRect();zoomAt(2,r.width/2,r.height/2);}"
        )
        r = page.locator("#stage").bounding_box()
        x = r["x"] + r["width"] / 2
        y = r["y"] + r["height"] / 2
        old = page.evaluate("normalised(" + str(x) + "," + str(y) + ")")
        cdp = page.context.new_cdp_session(page)
        cdp.send(
            "Input.dispatchTouchEvent",
            {
                "type": "touchStart",
                "touchPoints": [
                    {"x": x - 30, "y": y, "id": 1},
                    {"x": x + 30, "y": y, "id": 2},
                ],
            },
        )
        cdp.send(
            "Input.dispatchTouchEvent",
            {
                "type": "touchMove",
                "touchPoints": [
                    {"x": x - 15, "y": y + 15, "id": 1},
                    {"x": x + 75, "y": y + 15, "id": 2},
                ],
            },
        )
        new = page.evaluate("normalised(" + str(x + 30) + "," + str(y + 15) + ")")
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        assert abs(old["x"] - new["x"]) < 0.001 and abs(old["y"] - new["y"]) < 0.001, (
            "Moving pinch lost anchor",
            old,
            new,
        )
        print("PASS navigation cancellation and moving-pinch anchor")
        # Slice 2a: magnifier on hold, point drag with live fit and one write, undo.
        page.evaluate(
            "state.view={scale:1,x:0,y:0};applyView();state.horizonExplained=true"
        )
        page.locator("#stage").scroll_into_view_if_needed()

        def at(p):
            r = page.locator("#stage").bounding_box()
            return (
                r["x"] + 1 + p["x"] * (r["width"] - 2),
                r["y"] + 1 + p["y"] * (r["height"] - 2),
            )

        def touch(kind, *points):
            cdp.send(
                "Input.dispatchTouchEvent",
                {
                    "type": kind,
                    "touchPoints": [
                        {"x": x, "y": y, "id": i + 1} for i, (x, y) in enumerate(points)
                    ],
                },
            )

        def idle():
            page.wait_for_function("!state.busy")

        def sets():
            return page.evaluate("mock.sets.length")

        # A long press in What's that? shows the loupe; release places the tap
        # under the finger and the same touch selects no candidate.
        page.evaluate("setMode('what')")
        target = page.evaluate("SyntheticAime.taps.whatD")
        touch("touchStart", at(target))
        page.wait_for_timeout(500)
        assert page.evaluate("!$('loupe').hidden"), "No loupe on hold"
        assert not page.locator("#candidates-dialog").is_visible(), "Placed while holding"
        touch("touchEnd")
        page.wait_for_timeout(500)
        assert page.evaluate("$('loupe').hidden"), "Loupe left after release"
        assert page.locator("#candidates-dialog").is_visible(), "Hold release placed nothing"
        assert page.evaluate("state.pane === 'photo'"), "Hold release selected a candidate"
        placed = page.evaluate("state.lastTap")
        assert abs(placed["x"] - target["x"]) < 0.005 and abs(placed["y"] - target["y"]) < 0.005, (placed, target)
        page.locator("#close-candidates").click()
        # Horizon: hold and slide places at the final finger; a short tap adds the second.
        page.evaluate("setMode('horizon')")
        h0, h1 = page.evaluate("SyntheticAime.taps.horizon")
        (x0, y0), (x1, y1) = at({"x": h0["x"] - 0.05, "y": h0["y"]}), at(h0)
        before = sets()
        touch("touchStart", (x0, y0))
        page.wait_for_timeout(450)
        for i in range(1, 6):
            touch("touchMove", (x0 + (x1 - x0) * i / 5, y0 + (y1 - y0) * i / 5))
        assert sets() == before, "Storage written while holding"
        touch("touchEnd")
        page.wait_for_timeout(400)
        idle()
        touch("touchStart", at(h1))
        touch("touchEnd")
        page.wait_for_timeout(300)
        idle()
        horizon = page.evaluate("current().horizon")
        assert len(horizon) == 2 and abs(horizon[0]["x"] - h0["x"]) < 0.004 and abs(horizon[0]["y"] - h0["y"]) < 0.004, horizon
        assert page.locator("#undo").inner_text() == "Undo adding horizon point 2"
        print("PASS hold shows the loupe and release places; short taps still act at once")
        # Dragging a horizon point refits live, writes once on release; undo restores it.
        row = page.evaluate("S.horizonRow(state.cal,.5)")
        before = sets()
        x, y = at(horizon[0])
        touch("touchStart", (x, y))
        rows = []
        for i in range(1, 9):
            touch("touchMove", (x, y + i * 5))
            page.wait_for_timeout(40)
            rows.append(page.evaluate("S.horizonRow(state.cal,.5)"))
        assert page.evaluate("state.preview !== null && !$('loupe').hidden"), "No live preview"
        assert abs(rows[-1] - row) > 0.005 and len({round(r, 5) for r in rows}) > 3, ("Fit not live", rows)
        assert sets() == before, "Storage written on pointermove"
        touch("touchEnd")
        page.wait_for_timeout(100)
        idle()
        assert page.evaluate("mock.sets.slice(" + str(before) + ")") == ["photo.0"], "Not one write on release"
        assert page.evaluate("current().horizon[0].y") > horizon[0]["y"] + 0.03
        assert page.locator("#undo").inner_text() == "Undo moving horizon point 1"
        page.locator("#undo").click()
        idle()
        assert page.evaluate("current().horizon") == horizon, "Undo did not restore the point"
        assert page.evaluate("$('undo').disabled"), "Undo is one step"
        # A mark drag refits the direction; a second finger cancels a drag without a write.
        mark = page.evaluate("current().marks[0]")
        bearing = page.evaluate("S.bearingAt(state.cal,.5,.5)")
        x, y = at(mark)
        touch("touchStart", (x, y))
        for i in range(1, 7):
            touch("touchMove", (x + i * 6, y))
            page.wait_for_timeout(30)
        assert abs(page.evaluate("S.diff(S.bearingAt(state.cal,.5,.5)," + str(bearing) + ")")) > 0.5, "Direction fit not live"
        touch("touchEnd")
        page.wait_for_timeout(100)
        idle()
        assert page.evaluate("current().marks[0].x") > mark["x"] + 0.02
        page.locator("#undo").click()
        idle()
        assert page.evaluate("current().marks[0]") == mark
        before = sets()
        touch("touchStart", (x, y))
        touch("touchMove", (x + 30, y))
        touch("touchMove", (x + 30, y), (x + 100, y + 60))
        touch("touchEnd")
        page.wait_for_timeout(100)
        idle()
        assert sets() == before and page.evaluate("current().marks[0]") == mark, "Cancelled drag changed the mark"
        assert page.evaluate("state.preview === null")
        page.evaluate("update(s=>({...s,horizon:[]}))")
        idle()
        page.evaluate("setMode('what')")
        print("PASS point drags refit live, write once on release, undo; pinch cancels a drag")
        if page.evaluate("typeof AimeMap !== 'undefined'"):
            page.evaluate("call=window.originalCall")
            # Partial coverage must remain visible in each result surface.
            page.evaluate("async()=>{const data=await features();data.partialCoverage=true;await openMarkDialog()}")
            assert "Partial coverage" in page.locator("#fetch-status").inner_text()
            page.evaluate("$('mark-dialog').close()")
            page.evaluate("whatsThat(SyntheticAime.taps.whatB.x,SyntheticAime.taps.whatB.y)")
            assert "Partial coverage" in page.locator("#candidates-note").inner_text()
            page.locator("#candidates button").first.click()
            assert "Partial landmark coverage" in page.locator("#map-legend").inner_text()
            # A real UI selection replaces a legacy observation of that point.
            page.evaluate("""async()=>{showPane('photo');const m=current().marks[0];const {kind,dataset,...old}=m;await update(s=>({...s,marks:[{...old,osmType:'node',osmId:123}]}));state.pendingTap={x:.4,y:.5};pick({...m,p:m.positionM});}""")
            page.wait_for_function("!state.busy")
            assert page.evaluate("current().marks.length===1 && current().marks[0].x===.4 && !!current().marks[0].kind"), "Legacy selection duplicated a calibration mark"
            print("PASS partial coverage in mark search, candidates and map; legacy mark replacement")
            # Map ruler: two taps, the first snapped to the viewpoint; clearable.
            page.evaluate("showPane('map',true)")
            page.locator("#map-ruler").click()
            page.locator("#map-wrap").scroll_into_view_if_needed()
            box = page.locator("#map").bounding_box()
            v = page.evaluate("map.xy(map.scene.viewer)")
            for point in ((box["x"] + v["x"] + 6, box["y"] + v["y"] + 4), (box["x"] + 60, box["y"] + 50)):
                touch("touchStart", point)
                touch("touchEnd")
            page.wait_for_timeout(100)
            ruler = page.evaluate(
                "({pts:map.ruler.points,m:AimeMap.measure(map.ruler.points[0],map.ruler.points[1]),text:$('map-ruler-status').textContent,v:current().viewer})"
            )
            assert ruler["pts"][0] == {"lat": ruler["v"]["lat"], "lon": ruler["v"]["lon"]}, "Ruler did not snap to the viewpoint"
            assert ruler["text"].startswith("Ruler: ") and "initial bearing" in ruler["text"], ruler["text"]
            assert 270 < ruler["m"]["bearing"] < 360, ruler
            page.locator("#map-ruler-clear").click()
            assert page.evaluate("map.ruler.points.length === 0 && $('map-ruler-clear').disabled")
            page.locator("#map-ruler").click()
            assert page.evaluate("map.ruler === null && $('map-ruler-status').textContent === ''")
            page.evaluate("showPane('photo')")
            print("PASS map ruler measures, snaps to the viewpoint and clears")
            # Candidate "Show in photo": locate's line and ±2σ band in the photo.
            page.evaluate("whatsThat(SyntheticAime.taps.whatB.x,SyntheticAime.taps.whatB.y)")
            page.wait_for_function("$('candidates-dialog').open")
            first = page.evaluate("state.lastList.rows[0].candidate.feature.name")
            page.locator("#candidates li button.show").first.click()
            shown = page.evaluate(
                "({pane:state.pane,dialog:$('candidates-dialog').open,pin:state.pin,inFrame:state.pinLoc&&state.pinLoc.inFrame,status:$('pin-status').textContent,band:$('overlay').querySelectorAll('polygon').length})"
            )
            assert shown["pane"] == "photo" and not shown["dialog"] and shown["pin"]["name"] == first, shown
            assert shown["inFrame"] and shown["band"] == 1 and shown["status"].startswith(first + ": in the photo · "), shown
            # Behind the camera: edge arrow and "behind you" wording.
            page.evaluate("setPin({point:SyntheticAime.features.find(f=>f.letter==='F'),name:'Synthetic Monument F',positionM:60})")
            behind = page.evaluate("({side:state.pinLoc.side,status:$('pin-status').textContent,texts:[...$('overlay').querySelectorAll('text')].map(t=>t.textContent)})")
            assert behind["side"] == "behind-right" and behind["status"].startswith("Synthetic Monument F: behind you, to the right"), behind
            assert "Behind you, to the right" in behind["texts"], behind
            # Map long-press drops a pin, adds no ruler point, keeps the viewpoint; clearable.
            page.evaluate("setPin(null);showPane('map',true)")
            viewer = page.evaluate("JSON.stringify(current().viewer)")
            page.locator("#map-ruler").click()
            page.locator("#map-wrap").scroll_into_view_if_needed()
            box = page.locator("#map").bounding_box()
            touch("touchStart", (box["x"] + 80, box["y"] + 90))
            page.wait_for_timeout(700)
            touch("touchEnd")
            page.wait_for_timeout(100)
            dropped = page.evaluate("({pin:state.pin,scene:!!map.scene.pin,ruler:map.ruler.points.length,tools:!$('pin-tools').hidden})")
            assert dropped["pin"] and dropped["scene"] and dropped["tools"] and dropped["ruler"] == 0, dropped
            assert page.evaluate("JSON.stringify(current().viewer)") == viewer, "Long-press moved the viewpoint"
            assert page.evaluate("$('map-legend').textContent.includes(pinStatus())"), "Map legend retained the previous pin details"
            page.locator("#map-ruler").click()
            page.locator("#pin-show").click()
            assert page.evaluate("state.pane === 'photo' && !!state.pinLoc")
            page.locator("#pin-clear").click()
            assert page.evaluate("$('pin-tools').hidden && state.pin === null && map.scene.pin === null")
            print("PASS map pin and candidate shown in the photo; behind-you arrow; clear")
            # API 0.13 capture: level and 1×/2× requested, the id used directly,
            # the metadata stored and fed to the solver; heading only with the
            # viewpoint cell's declination; the landmark list sorted by direction.
            page.evaluate("AimeCore.LOCATION_SPACING_MS=0;showLibrary()")
            idle()
            page.locator("#take").click()
            page.wait_for_function("state.selectedId === 'photo2' && !state.busy")
            assert page.evaluate("JSON.stringify(mock.captures)") == '[{"op":"capture","level":true,"zoom":[1,2]}]'
            assert page.evaluate("JSON.stringify(current().capture) === JSON.stringify(AimeCore.cleanCapture(SyntheticAime.capture('full')))"), "Capture metadata not stored"
            chips = page.locator("#chips").inner_text()
            # The viewpoint's cell was downloaded earlier this session, so its
            # declination already turns the magnetic reading into a hint.
            assert "Level measured" in chips and "Lens from camera" in chips and "Compass hint" in chips, chips
            page.evaluate("setMode('mark')")
            touch("touchStart", at({"x": 0.64, "y": 0.42}))
            touch("touchEnd")
            page.wait_for_function("$('mark-dialog').open && $('search-order').textContent !== ''")
            order = page.locator("#search-order").inner_text()
            assert order.startswith("Sorted by direction: closest to where you tapped (about ") and "from the compass hint" in order, order
            assert page.locator("#results button").first.inner_text().startswith("Synthetic"), "No results"
            precision = page.evaluate("[...document.querySelectorAll('#results small')].map(e=>e.textContent)")
            assert any("±8 m, precise" in t for t in precision) and any("±60 m" in t and "precise" not in t for t in precision), precision
            page.locator("#cancel-mark").click()
            # Without a declination (older cells) the heading is skipped, never used as true.
            skipped = page.evaluate("(()=>{const d=state.data.declinationAt;state.data.declinationAt=()=>null;recalibrate();render();const r=[state.measured.used.compass,state.measured.skipped.compass,$('chips').textContent];state.data.declinationAt=d;recalibrate();render();return r})()")
            assert skipped[0] is False and skipped[1] == "declination" and "Compass hint" not in skipped[2], skipped
            # A fresh session: no cell yet, so no hint; downloading it enables the hint.
            page.evaluate("state.data=AimeCore.landmarkData(dataGet);state.features.clear();recalibrate();render()")
            assert "Compass hint" not in page.locator("#chips").inner_text()
            page.evaluate("features()")
            page.wait_for_function("$('chips').textContent.includes('Compass hint')")
            # First-mark search must use the same tilted ray as calibration,
            # without promoting a compass-only hint to a marked calibration.
            tilted = page.evaluate("""(()=>{const s=current(), before=s.capture;
              s.capture={...before,tilt:{pitchDeg:60,rollDeg:0,sigmaDeg:1,ageMs:1}};
              recalibrate();const d=tapDirection({x:.9,y:.9});const marked=state.cal;
              s.capture=before;recalibrate();return {d,marked};})()""")
            assert abs(tilted["d"]["bearing"] - 102.625) < 2, tilted
            assert tilted["d"]["sigmaDeg"] > 12 and tilted["marked"] is None, tilted
            print("PASS 0.13 capture: level and zoom requested, id used, metadata stored, measured inputs shown, direction-sorted search")
            # Calibration details: the measured lens is shown as used; a 2× photo
            # without a reported lens shows why and starts from the 2× default.
            page.evaluate("(async()=>{const f=AimeCore.parseCell(AimeCore.parseIndex(SyntheticAime.index()),'46_9',SyntheticAime.cell('46_9')).find(f=>f.name==='Synthetic Tower A');await update(s=>({...s,marks:[AimeCore.markFrom(f,SyntheticAime.taps.markA.x,SyntheticAime.taps.markA.y)]}))})()")
            idle()
            assert page.evaluate("$('lens-note').hidden"), "Lens note shown for a measured lens"
            page.locator("#details-open").click()
            details = page.locator("#details").inner_text()
            for text in ("Lens\nh 66.0° v 51.9° ±1.0° — used", "Lens used\n66.0° ±1.0° · from the camera", "Tilt\npitch +4.0° roll +1.5° ±1.0° · 18 ms — used", "Declination\n+3.0° E (viewpoint cell) → true 30.0°", "1 Synthetic Tower A\ntower · ±8 m · residual "):
                assert text in details, (text, details)
            box = page.evaluate("(()=>{const r=$('details-dialog').getBoundingClientRect();return [r.height,innerHeight]})()")
            assert box[0] <= box[1], ("Details do not fit one screen", box)
            page.locator("#close-details").click()
            page.evaluate("update(s=>({...s,capture:{...SyntheticAime.capture('no lens'),zoomRatio:2}}))")
            idle()
            chips = page.locator("#chips").inner_text()
            assert "Lens from camera" not in chips and "2× zoom" in chips, chips
            assert page.evaluate("!$('lens-note').hidden"), "No lens-not-measured note"
            page.locator("#lens-note").click()
            details = page.locator("#details").inner_text()
            assert "Lens\nnot reported by the camera" in details and ("(prior 38.6° ±5.3°)" in details or "(prior: default for 2×, 38.6° ±5.3°)" in details), details
            assert abs(page.evaluate("state.cal.fov") - 70) > 20, "2× photo still fitted near the 1× default"
            # Valid long landmark labels must not squeeze residuals off-screen.
            original_name = page.evaluate("current().marks[0].name")
            for name in ("Evangelisch-lutherische Marktkirche St. Georgii et Jacobi", "W" * 80):
                page.evaluate("name=>{current().marks[0].name=name;openDetails()}", name)
                layout = page.evaluate("""(()=>{const el=$('details');return {
                  width:el.clientWidth,scroll:el.scrollWidth,
                  values:[...el.querySelectorAll('dd')].map(d=>({width:d.getBoundingClientRect().width,right:d.getBoundingClientRect().right})),
                  right:el.getBoundingClientRect().right};})()""")
                assert layout["scroll"] <= layout["width"] + 1, layout
                assert all(v["width"] >= 150 and v["right"] <= layout["right"] + 1 for v in layout["values"]), layout
            page.evaluate("name=>{current().marks[0].name=name;openDetails()}", original_name)
            page.locator("#close-details").click()
            print("PASS calibration details panel, lens-not-measured note, zoom-aware lens prior, ±m in search")
            # Regression (0.2.1 on hardware): a saved, already calibrated photo
            # opened in a fresh session never looked landmarks up, so the
            # viewpoint cell's declination never arrived and the compass hint
            # stayed "no declination for this area yet".
            page.evaluate("state.data=AimeCore.landmarkData(dataGet);state.features.clear();showLibrary()")
            idle()
            page.evaluate("openPhoto('photo2')")
            page.wait_for_function("state.selectedId==='photo2' && !state.busy")
            page.wait_for_function("state.measured && state.measured.used.compass", timeout=5000)
            page.locator("#details-open").click()
            details = page.locator("#details").inner_text()
            assert "Declination\n+3.0° E (viewpoint cell) → true 30.0°" in details and "Compass\n27.0° magnetic ±10.0° · 40 ms — used" in details, details
            page.locator("#close-details").click()
            print("PASS a saved photo gets its viewpoint cell's declination without a landmark lookup")
            # Precision hint: one mark, a tap well away from it; two marks, a tap beyond them.
            page.evaluate("whatsThat(SyntheticAime.taps.whatB.x,SyntheticAime.taps.whatB.y)")
            page.wait_for_function("$('candidates-dialog').open")
            assert "Add a second mark on the other side of your target for better precision." in page.locator("#candidates-extra").inner_text()
            page.locator("#close-candidates").click()
            assert "Add a second mark" in page.locator("#photo-status").inner_text()
            page.evaluate("(async()=>{const fs=AimeCore.parseCell(AimeCore.parseIndex(SyntheticAime.index()),'46_9',SyntheticAime.cell('46_9'));const g=fs.find(f=>f.name==='Synthetic Chapel G');await update(s=>({...s,marks:[...s.marks,AimeCore.markFrom(g,SyntheticAime.at.G.x,SyntheticAime.at.G.y)]}))})()")
            idle()
            page.evaluate("whatsThat(SyntheticAime.taps.whatD.x,SyntheticAime.taps.whatD.y)")
            page.wait_for_function("$('candidates-dialog').open")
            assert "Outside your marks: add one on the right for better precision." in page.locator("#candidates-extra").inner_text()
            page.locator("#close-candidates").click()
            page.evaluate("setPin({point:SyntheticAime.features.find(f=>f.letter==='F'),name:'Synthetic Monument F',positionM:60})")
            assert page.locator("#pin-status").inner_text().endswith("Outside your marks: add one on the right for better precision."), page.locator("#pin-status").inner_text()
            page.evaluate("setPin(null)")
            # A saved mark from older data: the panel offers the newer position; Update is one write and undoable.
            page.evaluate("(async()=>{await update(s=>({...s,marks:s.marks.map((m,i)=>i?m:{...m,lat:m.lat+0.0003,positionM:60,dataset:'synthetic-1-r0'})}))})()")
            idle()
            before = page.evaluate("JSON.stringify(current().marks[0])")
            writes = page.evaluate("mock.sets.length")
            page.locator("#details-open").click()
            page.wait_for_function("document.querySelector('#details .update')")
            details = page.locator("#details").inner_text()
            assert "newer data: ±60 m → ±8 m, moved 33 m" in details, details
            page.locator("#details .update").click()
            page.wait_for_function("!state.busy && !document.querySelector('#details .update')")
            mark = page.evaluate("current().marks[0]")
            assert mark["positionM"] == 8 and mark["dataset"] == "synthetic-1-r1" and mark["x"] == page.evaluate("SyntheticAime.taps.markA.x"), mark
            assert page.evaluate("mock.sets.slice(" + str(writes) + ")") == ["photo.1"], page.evaluate("mock.sets.slice(" + str(writes) + ")")
            page.locator("#close-details").click()
            assert page.locator("#undo").inner_text() == "Undo updating Synthetic Tower A"
            page.locator("#undo").click()
            idle()
            assert page.evaluate("JSON.stringify(current().marks[0])") == before, "Undo did not restore the saved mark"
            print("PASS outside-your-marks hint in the sheet, status and pin; newer mark data offered, updated in one write, undoable")
            page.evaluate("openPhoto('photo1')")
            idle()
            page.evaluate(
                "whatsThat(SyntheticAime.taps.whatB.x,SyntheticAime.taps.whatB.y)"
            )
            page.locator("#close-candidates").click()
            assert page.evaluate("state.lastList.rows.length > 0")
            page.evaluate("update(s=>({...s, marks: []}))")
            page.evaluate("showPane('map',true)")
            assert page.evaluate(
                "state.lastList === null && map.scene.wedge === null && map.scene.candidates.length === 0"
            ), "Old ranking survived calibration change"
            page.evaluate(
                "window.dispatchEvent(new CustomEvent('constructvisibilitychange',{detail:{visible:false}}))"
            )
            assert page.evaluate("!map.visible"), "Host menu did not pause map tiles"
            page.evaluate(
                "window.dispatchEvent(new CustomEvent('constructvisibilitychange',{detail:{visible:true}}))"
            )
            assert page.evaluate("map.visible"), "Map failed to resume after host menu"
            page.evaluate(
                "db.put=async()=>{throw new Error('Synthetic storage failure')};map.scene.viewer={lat:0,lon:0};map.cb.onViewer({lat:0,lon:0,mPerPx:1})"
            )
            page.wait_for_function("!state.busy")
            assert page.evaluate(
                "map.scene.viewer.lat === current().viewer.lat && map.scene.viewer.lon === current().viewer.lon"
            ), "Failed write left an unsaved viewer ring"
            print("PASS map invalidation, menu pause/resume and failed correction")
        assert not errors, errors
        b.close()


if __name__ == "__main__":
    main()
