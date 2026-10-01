import json, math, collections, sys
from aime_select import select, norm
region, opfile, box = sys.argv[1], sys.argv[2], tuple(map(float, sys.argv[3].split(',')))
raw, kept = select(region)
op = json.load(open(opfile))['elements']
def pos(e): return (e['lat'], e['lon']) if 'lat' in e else (e['center']['lat'], e['center']['lon'])
def kind(t):
    for k in ('natural','man_made','building','historic','tourism','aeroway'):
        if k in t: return f"{k}={t[k]}"
def dist(a, b): return math.hypot((a[0]-b[0])*111000, (a[1]-b[1])*111000*math.cos(math.radians(a[0])))
X0,Y0,X1,Y1 = box
idx = {}
for f in kept: idx.setdefault(norm(f['n']), []).append(f)
stats = {}
for e in op:
    t = e.get('tags', {}); p = pos(e)
    if not (X0 <= p[1] <= X1 and Y0 <= p[0] <= Y1): continue
    k = kind(t)
    if k in ('tourism=viewpoint','tourism=attraction'): continue   # excluded by design: places you stand at / not visible targets
    hit = any(dist(p, (f['lat'], f['lon'])) < 600 for f in idx.get(norm(t.get('name')), []))
    s = stats.setdefault(k, [0, 0]); s[0] += 1; s[1] += hit
tot = [0, 0]
for k, (n, h) in sorted(stats.items(), key=lambda x: -x[1][0])[:12]:
    print(f"   {k:24s} {h:5d}/{n:<5d} {100*h/n:5.1f} %"); tot[0] += n; tot[1] += h
print(f"   {'all visible-target kinds':24s} {tot[1]:5d}/{tot[0]:<5d} {100*tot[1]/tot[0]:5.1f} %")
