#!/usr/bin/env python3
"""Aimé late-result and moving-pinch regressions using Playwright Chromium.
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
            """window.mock={store:{},photos:[{id:'photo1',ref:'ref1'}]};window.construct={postMessage(raw){let q=JSON.parse(raw),result=null;if(q.method==='storage.kv'){if(q.params.op==='get')result=mock.store[q.params.key]??null;else mock.store[q.params.key]=q.params.value;}else if(q.method==='photos.library'){if(q.params.op==='list')result={photos:mock.photos,limit:8};else if(q.params.op==='open')result={url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',width:1,height:1};}queueMicrotask(()=>construct.onmessage({data:JSON.stringify({id:q.id,result})}));}};"""
        )
        page.goto("http://aime.test/index.html")
        page.wait_for_function("!state.busy && state.items.length===1")
        page.evaluate(
            """async()=>{state.store={photo1:AimeCore.newSidecar({...SyntheticAime.viewer,accuracyM:10,timestamp:Date.now()})};await openPhoto('photo1');const f=AimeCore.parseOverpass(SyntheticAime.overpass()).features.find(f=>f.name==='Synthetic Tower A');await update(s=>({...s,marks:[AimeCore.markFrom(f,SyntheticAime.taps.markA.x,SyntheticAime.taps.markA.y)]}));}"""
        )
        # A delayed feature response while the visible Photos control leaves the photo.
        page.evaluate(
            """()=>{const old=call;call=(m,p)=>m==='net.http'?new Promise(r=>window.releaseFetch=()=>r({status:200,text:SyntheticAime.overpass()})):old(m,p);state.features.clear();window.pendingWhat=task(()=>whatsThat(.7,.4));}"""
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
        assert not errors, errors
        b.close()


if __name__ == "__main__":
    main()
