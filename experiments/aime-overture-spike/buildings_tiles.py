import sys, time, os
from common import con, src
from extract import REGIONS
region, start, count = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
x0, y0, x1, y1 = REGIONS[region]
step = float(sys.argv[4]) if len(sys.argv) > 4 else 0.25
tiles = [(x, y) for y in [y0 + i*step for i in range(int(round((y1-y0)/step)))] for x in [x0 + j*step for j in range(int(round((x1-x0)/step + 0.4999)))]]
c = con()
from common import src_box
SRC = src_box('buildings','building',REGIONS[region])
for i in range(start, min(start+count, len(tiles))):
    out = f"data/{region}-buildings-{i:03d}.parquet"
    if os.path.exists(out): continue
    tx, ty = tiles[i]; bx1, by1 = min(tx+step, x1), min(ty+step, y1)
    t = time.time()
    c.execute(f"""COPY (SELECT id, names.primary AS name, subtype, class, height, num_floors,
      ST_X(ST_Centroid(geometry)) AS lon, ST_Y(ST_Centroid(geometry)) AS lat
      FROM {SRC}
      WHERE bbox.xmin <= {bx1} AND bbox.xmax >= {tx} AND bbox.ymin <= {by1} AND bbox.ymax >= {ty}
        AND (class IN ('church','cathedral','chapel','mosque','synagogue','temple','religious','castle','tower','monastery','shrine')
             OR height >= 40 OR num_floors >= 14)) TO '{out}' (FORMAT parquet)""")
    n = c.execute(f"SELECT count(*) FROM '{out}'").fetchone()[0]
    print(f"tile {i}/{len(tiles)} ({tx:.2f},{ty:.2f}): {n} rows in {time.time()-t:.0f}s", flush=True)
print("tiles total", len(tiles))
