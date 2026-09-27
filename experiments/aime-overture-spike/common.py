import duckdb, os
REL = "2026-09-23.1"
BASE = f"s3://overturemaps-us-west-2/release/{REL}"
def con():
    c = duckdb.connect()
    c.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    c.execute("SET memory_limit='1500MB'; SET threads=4; SET preserve_insertion_order=false;")
    os.makedirs('duck-tmp', exist_ok=True)
    c.execute("SET temp_directory='duck-tmp'; SET max_temp_directory_size='1GB';")
    c.execute("CREATE OR REPLACE SECRET ov (TYPE s3, PROVIDER config, REGION 'us-west-2');")
    return c
def src(theme, typ):
    return f"read_parquet('{BASE}/theme={theme}/type={typ}/*', hive_partitioning=0)"
def src_box(theme, typ, box):
    from stac_files import files
    fl = [f for f, _ in files(theme, typ, box)]
    lst = ",".join(f"'{f}'" for f in fl)
    return f"read_parquet([{lst}], hive_partitioning=0)"
