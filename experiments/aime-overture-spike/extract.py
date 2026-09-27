import sys, time
REGIONS = {
  "rhinemain": (8.0, 49.7, 9.3, 50.45),
  "innsbruck": (10.9, 46.95, 11.9, 47.5),
  "hannover": (9.4, 52.15, 10.1, 52.55),
}
def main():
    from common import con, src, src_box
    region = sys.argv[1]; kinds = sys.argv[2].split(",")
    x0, y0, x1, y1 = REGIONS[region]
    box = f"bbox.xmin <= {x1} AND bbox.xmax >= {x0} AND bbox.ymin <= {y1} AND bbox.ymax >= {y0}"
    pt = "ST_X(ST_Centroid(geometry)) AS lon, ST_Y(ST_Centroid(geometry)) AS lat"
    Q = {
     "places": f"SELECT id, names.primary AS name, basic_category, taxonomy.primary AS tax, taxonomy.hierarchy AS hier, confidence, operating_status, {pt} FROM {src_box('places','place',REGIONS[region])} WHERE {box}",
     "land": f"SELECT id, names.primary AS name, subtype, class, elevation, wikidata, source_tags, {pt} FROM {src_box('base','land',REGIONS[region])} WHERE {box} AND geometry IS NOT NULL AND (names.primary IS NOT NULL OR class IN ('peak','volcano','hill'))",
     "infra": f"SELECT id, names.primary AS name, subtype, class, height, wikidata, source_tags, {pt} FROM {src_box('base','infrastructure',REGIONS[region])} WHERE {box}",
    }
    c = con()
    for k in kinds:
        t = time.time()
        c.execute(f"COPY ({Q[k]}) TO 'data/{region}-{k}.parquet' (FORMAT parquet)")
        n = c.execute(f"SELECT count(*) FROM 'data/{region}-{k}.parquet'").fetchone()[0]
        print(f"{region} {k}: {n} rows in {time.time()-t:.0f}s", flush=True)
if __name__ == "__main__":
    main()
