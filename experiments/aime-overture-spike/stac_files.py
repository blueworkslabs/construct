import json, urllib.request, functools
REL = "2026-09-23.1"
def get(url):
    with urllib.request.urlopen(url, timeout=60) as r: return json.load(r)
@functools.lru_cache(None)
def collection(theme, typ):
    return get(f"https://stac.overturemaps.org/{REL}/{theme}/{typ}/collection.json")
def files(theme, typ, box):
    x0, y0, x1, y1 = box
    c = collection(theme, typ)
    exts = c['extent']['spatial']['bbox'][1:]
    items = [l['href'] for l in c['links'] if l['rel'] == 'item']
    assert len(exts) == len(items), (len(exts), len(items))
    out = []
    for e, href in zip(exts, items):
        if e[0] <= x1 and e[2] >= x0 and e[1] <= y1 and e[3] >= y0:
            it = get(href)
            a = it['assets']
            hrefs = [v['href'] for v in a.values() if v['href'].endswith('.parquet')]
            s3 = [h for h in hrefs if h.startswith('s3://')] or hrefs
            # also sanity-check the item's own bbox
            ib = it.get('bbox', e)
            out.append((s3[0], ib))
    return out
if __name__ == "__main__":
    import sys
    from extract import REGIONS
    for theme, typ in [("buildings","building"),("base","land"),("base","infrastructure"),("places","place")]:
        for r in ("rhinemain","innsbruck"):
            f = files(theme, typ, REGIONS[r])
            print(theme, typ, r, len(f), [x[0].rsplit('/',1)[-1][:18] for x in f][:4])
