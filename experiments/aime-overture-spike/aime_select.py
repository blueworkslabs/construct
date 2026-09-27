import duckdb, json, gzip, re, math, sys, unicodedata
c = duckdb.connect()
def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii','ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()
def rows(sql): return c.execute(sql).fetchall()
def select(r):
    out = []
    for n, cls, e, wd, lon, lat in rows(f"SELECT name, class, elevation, wikidata, lon, lat FROM 'data/{r}-land.parquet' WHERE class IN ('peak','volcano','hill') AND name IS NOT NULL"):
        out.append(dict(n=n, k=cls, e=e, wd=wd, lat=lat, lon=lon, src='land', w=1.5 if e else 1.2))
    for n, cls, h, wd, mm, hi, lon, lat in rows(f"""SELECT name, class, height, wikidata, source_tags['man_made'], source_tags['historic'], lon, lat FROM 'data/{r}-infra.parquet'
        WHERE (class IN ('communication_tower','bell_tower','water_tower','observation','watchtower','minaret','lighthouse','radar','cooling','gasometer','dam') AND name IS NOT NULL)
           OR (name IS NOT NULL AND source_tags['man_made'] IN ('tower','mast','communications_tower','lighthouse','windmill','chimney','water_tower'))
           OR (name IS NOT NULL AND source_tags['historic'] IN ('castle','ruins','fort','tower'))
           OR (class IN ('communication_tower','mobile_phone_tower') AND height >= 50)
           OR (class = 'bridge' AND name IS NOT NULL AND wikidata IS NOT NULL)"""):
        k = cls if cls in ('communication_tower','bell_tower','water_tower','observation','watchtower','minaret','lighthouse','radar','cooling','gasometer','dam','bridge') else \
            {'tower':'tower','mast':'mast','communications_tower':'communication_tower','windmill':'windmill','chimney':'chimney','water_tower':'water_tower','lighthouse':'lighthouse'}.get(mm) or \
            {'castle':'castle','ruins':'ruins','fort':'fort','tower':'tower'}.get(hi) or cls
        out.append(dict(n=n or 'Communication tower', k=k, e=h, wd=wd, lat=lat, lon=lon, src='infra', w=1.3 if k in ('communication_tower','observation','lighthouse','tower') else 1.0))
    for n, cls, h, lon, lat in rows(f"""SELECT name, class, height, lon, lat FROM 'data/{r}-buildings-*.parquet'
        WHERE (class IN ('church','cathedral','chapel','mosque','synagogue','temple','monastery','castle','tower') AND name IS NOT NULL) OR height >= 80"""):
        k = cls or 'building'
        out.append(dict(n=n or 'Tall building', k=k if cls in ('church','cathedral','chapel','mosque','synagogue','temple','monastery','castle','tower') else 'tall_building', e=h, wd=None, lat=lat, lon=lon, src='buildings',
                        w={'cathedral':1.3,'church':1.1,'chapel':0.6,'tall_building':1.3}.get(k if cls else 'tall_building', 1.0) if (h or 0) < 80 else 1.3))
    for n, cat, conf, lon, lat in rows(f"""SELECT name, basic_category, confidence, lon, lat FROM 'data/{r}-places.parquet'
        WHERE name IS NOT NULL AND ((basic_category IN ('castle','monument','fort','lighthouse','memorial_site') AND confidence >= 0.6)
           OR (basic_category = 'historic_site' AND confidence >= 0.6 AND regexp_matches(name, 'burg|schloss|castle|turm|tower|warte|kastell|ruine|ruin|fort|kloster|abbey|abtei', 'i')))"""):
        out.append(dict(n=n, k=cat, e=None, wd=None, lat=lat, lon=lon, src='places', w=1.0))
    # dedupe: same normalized name within 400 m; provenance order land > infra > buildings > places
    order = {'land':0,'infra':1,'buildings':2,'places':3}
    out.sort(key=lambda f: order[f['src']])
    grid = {}; kept = []
    for f in out:
        key = norm(f['n']); cell = (round(f['lat']*100), round(f['lon']*100))
        dup = None
        for dy in (-1,0,1):
            for dx in (-1,0,1):
                for g in grid.get((key, cell[0]+dy, cell[1]+dx), []):
                    if math.hypot((g['lat']-f['lat'])*111000, (g['lon']-f['lon'])*111000*math.cos(math.radians(f['lat']))) < 400: dup = g
        if dup:
            dup['e'] = dup['e'] or f['e']; dup['wd'] = dup['wd'] or f['wd']; dup.setdefault('also', set()).add(f['src']); continue
        grid.setdefault((key, *cell), []).append(f); kept.append(f)
    return out, kept
def compact(f):
    rec = [f['n'][:80], f['k'], round(f['lat'],5), round(f['lon'],5)]
    rec.append(int(round(f['e'])) if f['e'] else 0)
    rec.append(round(f['w'] * (1.2 if f['wd'] else 1.0), 1))
    return rec
if __name__ == "__main__":
    for r in sys.argv[1:]:
        raw, kept = select(r)
        by = {}
        for f in kept: by[f['k']] = by.get(f['k'], 0) + 1
        print(f"== {r}: {len(raw)} candidates → {len(kept)} after dedupe")
        print("   kinds:", dict(sorted(by.items(), key=lambda x: -x[1])))
        srcs = {}
        for f in kept: srcs[f['src']] = srcs.get(f['src'],0)+1
        print("   primary source:", srcs, "| merged from 2+ themes:", sum(1 for f in kept if f.get('also')))
        for step in (0.25, 0.5, 1.0):
            cells = {}
            for f in kept: cells.setdefault((math.floor(f['lat']/step), math.floor(f['lon']/step)), []).append(compact(f))
            sizes = [len(json.dumps(v, ensure_ascii=False, separators=(',',':')).encode()) for v in cells.values()]
            gz = [len(gzip.compress(json.dumps(v, ensure_ascii=False, separators=(',',':')).encode())) for v in cells.values()]
            print(f"   cells {step}°: {len(cells)} files, features max {max(len(v) for v in cells.values())}, bytes max {max(sizes)/1024:.0f} KiB, mean {sum(sizes)/len(sizes)/1024:.0f} KiB, gzip max {max(gz)/1024:.0f} KiB")
        json.dump([compact(f) for f in kept], open(f"out-{r}.json","w"), ensure_ascii=False, separators=(',',':'))
