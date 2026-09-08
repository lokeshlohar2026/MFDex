"""
=============================================================================
 PRODUCTION-GRADE 29-COLUMN UNIFIED PINCODE MARKET CUBE BUILDER (SQLite Engine)
 -----------------------------------------------------------------------------
 Builds the single, unified 29-column master OLAP table on Drive D:
   D:\OneDrive - Neo Group\Documents\mfdex\mfdex_pincode_market_cube.sqlite

 Table: pincode_scheme_monthly (29 Columns)
 Granularity: Pincode x Month x Scheme Type (Rolling 12 Months)
 Zero other tables. Everything aggregated dynamically via high-speed indexes.
=============================================================================
"""

import duckdb
import sqlite3
import json
import time
import os
import sys
from shapely.geometry import shape, Point
from shapely.strtree import STRtree
from indiapins.core import _zips_by_pincode

sys.stdout.reconfigure(encoding="utf-8")

SOURCE_SQLITE = r"C:\sqlite_exports\mfdex_verified_distributors.sqlite"
TARGET_SQLITE = r"D:\OneDrive - Neo Group\Documents\mfdex\Mfdex Insights\mfdex_pincode_market_cube.sqlite"
DISTRICT_GEOJSON = r"D:\OneDrive - Neo Group\Documents\mfdex\Mfdex Insights\india_districts_simplified.geojson"

t_start = time.time()
print("=" * 80, flush=True)
print("  PRODUCTION-GRADE 29-COLUMN UNIFIED OLAP CUBE BUILDER", flush=True)
print(f"  Target: {TARGET_SQLITE}", flush=True)
print("=" * 80, flush=True)

# ---------------------------------------------------------------------------
# Step 1: Build Spatial Pincode Master with STRtree
# ---------------------------------------------------------------------------
print("\n[Step 1/4] Building Spatial Pincode Master with STRtree...", flush=True)
t0 = time.time()

with open(DISTRICT_GEOJSON, "r", encoding="utf-8") as f:
    dist_geojson = json.load(f)

geoms = []
props = []
for feature in dist_geojson["features"]:
    g = shape(feature["geometry"])
    geoms.append(g)
    props.append(feature["properties"])

tree = STRtree(geoms)
print(f"  Indexed {len(geoms)} district polygons in {time.time() - t0:.2f}s", flush=True)

STATE_NAME_NORM = {
    'MAHARASHTRA': 'Maharashtra', 'GUJARAT': 'Gujarat', 'KARNATAKA': 'Karnataka',
    'UTTAR PRADESH': 'Uttar Pradesh', 'WEST BENGAL': 'West Bengal', 'TAMIL NADU': 'Tamil Nadu',
    'DELHI': 'Delhi', 'RAJASTHAN': 'Rajasthan', 'MADHYA PRADESH': 'Madhya Pradesh',
    'PUNJAB': 'Punjab', 'HARYANA': 'Haryana', 'BIHAR': 'Bihar', 'ANDHRA PRADESH': 'Andhra Pradesh',
    'TELANGANA': 'Telangana', 'KERALA': 'Kerala', 'JHARKHAND': 'Jharkhand',
    'CHHATTISGARH': 'Chhattisgarh', 'ODISHA': 'Odisha', 'ORISSA': 'Odisha', 'ASSAM': 'Assam',
    'GOA': 'Goa', 'HIMACHAL PRADESH': 'Himachal Pradesh', 'CHANDIGARH': 'Chandigarh',
    'UTTARAKHAND': 'Uttarakhand', 'UTTARANCHAL': 'Uttarakhand', 'JAMMU AND KASHMIR': 'Jammu and Kashmir',
    'TRIPURA': 'Tripura', 'PUDUCHERRY': 'Puducherry', 'MEGHALAYA': 'Meghalaya', 'MANIPUR': 'Manipur',
    'NAGALAND': 'Nagaland', 'MIZORAM': 'Mizoram', 'SIKKIM': 'Sikkim', 'ARUNACHAL PRADESH': 'Arunachal Pradesh',
    'ANDAMAN AND NICOBAR': 'Andaman and Nicobar', 'DADRA AND NAGAR HAVELI': 'Dadra and Nagar Haveli',
    'DAMAN AND DIU': 'Daman and Diu', 'LAKSHADWEEP': 'Lakshadweep', 'LADAKH': 'Jammu and Kashmir'
}

PIN_PREFIX_STATE = {
    '11': 'Delhi', '12': 'Haryana', '13': 'Haryana', '14': 'Punjab', '15': 'Punjab', '16': 'Punjab',
    '17': 'Himachal Pradesh', '18': 'Jammu and Kashmir', '19': 'Jammu and Kashmir',
    '20': 'Uttar Pradesh', '21': 'Uttar Pradesh', '22': 'Uttar Pradesh', '23': 'Uttar Pradesh',
    '24': 'Uttarakhand', '25': 'Uttar Pradesh', '26': 'Uttar Pradesh', '27': 'Uttar Pradesh', '28': 'Uttar Pradesh',
    '30': 'Rajasthan', '31': 'Rajasthan', '32': 'Rajasthan', '33': 'Rajasthan', '34': 'Rajasthan',
    '36': 'Gujarat', '37': 'Gujarat', '38': 'Gujarat', '39': 'Gujarat',
    '40': 'Maharashtra', '41': 'Maharashtra', '42': 'Maharashtra', '43': 'Maharashtra', '44': 'Maharashtra',
    '45': 'Madhya Pradesh', '46': 'Madhya Pradesh', '47': 'Madhya Pradesh', '48': 'Madhya Pradesh', '49': 'Chhattisgarh',
    '50': 'Telangana', '51': 'Andhra Pradesh', '52': 'Andhra Pradesh', '53': 'Andhra Pradesh',
    '56': 'Karnataka', '57': 'Karnataka', '58': 'Karnataka', '59': 'Karnataka',
    '60': 'Tamil Nadu', '61': 'Tamil Nadu', '62': 'Tamil Nadu', '63': 'Tamil Nadu', '64': 'Tamil Nadu',
    '67': 'Kerala', '68': 'Kerala', '69': 'Kerala',
    '70': 'West Bengal', '71': 'West Bengal', '72': 'West Bengal', '73': 'West Bengal', '74': 'West Bengal',
    '75': 'Odisha', '76': 'Odisha', '77': 'Odisha', '78': 'Assam', '79': 'North East',
    '80': 'Bihar', '81': 'Jharkhand', '82': 'Jharkhand', '83': 'Jharkhand', '84': 'Bihar', '85': 'Bihar'
}

conn_src = sqlite3.connect(SOURCE_SQLITE)
cur_src = conn_src.cursor()
cur_src.execute("SELECT registered_pincode, registered_city FROM distributor_directory GROUP BY registered_pincode, registered_city")
dir_rows = cur_src.fetchall()
conn_src.close()

pin_meta = {}
for p_raw, c_raw in dir_rows:
    p = str(p_raw or "").strip().split('.')[0]
    if len(p) == 6 and p.isdigit() and p not in pin_meta:
        matches = _zips_by_pincode.get(p)
        city = (c_raw or "").strip()
        state = PIN_PREFIX_STATE.get(p[:2], "Other")
        lat, lon = 0.0, 0.0
        
        if matches:
            m = matches[0]
            st_raw = (m.get("State") or "").strip().upper()
            state = STATE_NAME_NORM.get(st_raw, state)
            if not city:
                city = (m.get("District") or m.get("Name") or "").strip()
            try:
                lat = round(float(m.get("Latitude", 0)), 5)
                lon = round(float(m.get("Longitude", 0)), 5)
            except (ValueError, TypeError):
                pass
        
        district = city
        if lat != 0 and lon != 0:
            pt = Point(lon, lat)
            matched = tree.query(pt)
            dname = None
            for idx in matched:
                if geoms[idx].contains(pt):
                    dname = props[idx].get("district") or props[idx].get("NAME_2") or props[idx].get("dtname")
                    break
            if not dname:
                nearest_idx = tree.nearest(pt)
                dname = props[nearest_idx].get("district") or props[nearest_idx].get("NAME_2") or props[nearest_idx].get("dtname")
            if dname:
                district = dname
                
        pin_meta[p] = (city or "Unknown", district or "Unknown", state or "Other", lat, lon)

print(f"  Mapped {len(pin_meta):,} unique pincodes.", flush=True)

# ---------------------------------------------------------------------------
# Step 2: Initialize DuckDB Engine and Attach Databases
# ---------------------------------------------------------------------------
print("\n[Step 2/4] Initializing DuckDB and target database...", flush=True)
if os.path.exists(TARGET_SQLITE):
    try:
        os.remove(TARGET_SQLITE)
        print("  Removed previous database file.", flush=True)
    except Exception as e:
        print(f"  Warning: Could not remove {TARGET_SQLITE}: {e}", flush=True)

con = duckdb.connect()
con.execute("INSTALL sqlite; LOAD sqlite; SET threads = 8; SET max_memory = '16GB';")
con.execute(f"ATTACH '{SOURCE_SQLITE}' AS src_db (TYPE SQLITE, READ_ONLY);")
con.execute(f"ATTACH '{TARGET_SQLITE}' AS tgt_db (TYPE SQLITE);")

con.execute("""
    CREATE TABLE geo_master (
        pincode VARCHAR,
        city VARCHAR,
        district VARCHAR,
        state VARCHAR,
        lat DOUBLE,
        lon DOUBLE
    );
""")

geo_data = [(p, v[0], v[1], v[2], v[3], v[4]) for p, v in pin_meta.items()]
con.executemany("INSERT INTO geo_master VALUES (?, ?, ?, ?, ?, ?);", geo_data)
print("  Loaded geo_master into DuckDB.", flush=True)

# ---------------------------------------------------------------------------
# Step 3: Build Single 29-Column OLAP Fact Table (pincode_scheme_monthly)
# ---------------------------------------------------------------------------
print("\n[Step 3/4] Building 29-Column Master Fact Table (pincode_scheme_monthly)...", flush=True)
t_agg = time.time()

# Two-stage fast pipeline:
# 1. Scheme-level facts (73M rows -> 2.8M rows)
# 2. Pincode-level MFD counts (73M rows -> 120k rows)
# 3. Final join between 2.8M rows and 120k rows (instant)
con.execute("""
    CREATE TABLE temp_scheme_facts AS
    WITH raw_12m AS (
        SELECT 
            month,
            distributor_code,
            registered_pincode,
            city_tier,
            asset_class,
            scheme_type,
            closing_aum,
            avg_aum,
            gross_purchases,
            redemptions,
            switch_in,
            switch_out,
            total_gross_sales,
            total_net_sales,
            active_sip_value,
            active_sip_count,
            new_sip_value,
            new_sip_count,
            stp_value,
            new_stp_count,
            folio_count
        FROM src_db.mfdex_2026
        WHERE registered_pincode IS NOT NULL AND registered_pincode != ''
        
        UNION ALL
        
        SELECT 
            month,
            distributor_code,
            registered_pincode,
            city_tier,
            asset_class,
            scheme_type,
            closing_aum,
            avg_aum,
            gross_purchases,
            redemptions,
            switch_in,
            switch_out,
            total_gross_sales,
            total_net_sales,
            active_sip_value,
            active_sip_count,
            new_sip_value,
            new_sip_count,
            stp_value,
            new_stp_count,
            folio_count
        FROM src_db.mfdex_2025
        WHERE month IN ('Aug-25', 'Sep-25', 'Oct-25', 'Nov-25', 'Dec-25')
          AND registered_pincode IS NOT NULL AND registered_pincode != ''
    )
    SELECT 
        r.month,
        r.registered_pincode AS pincode,
        MAX(COALESCE(g.city, '')) AS city,
        MAX(COALESCE(g.district, '')) AS district,
        MAX(COALESCE(g.state, 'Other')) AS state,
        MAX(COALESCE(r.city_tier, '')) AS city_tier,
        MAX(COALESCE(g.lat, 0.0)) AS lat,
        MAX(COALESCE(g.lon, 0.0)) AS lon,
        MAX(r.asset_class) AS asset_class,
        r.scheme_type,
        ROUND(SUM(r.closing_aum) / 100.0, 4) AS closing_aum_cr,
        ROUND(SUM(r.avg_aum) / 100.0, 4) AS avg_aum_cr,
        ROUND(SUM(r.total_gross_sales) / 100.0, 4) AS gross_inflows_cr,
        ROUND(SUM(r.gross_purchases) / 100.0, 4) AS lumpsum_inflows_cr,
        ROUND(SUM(r.switch_in) / 100.0, 4) AS switch_in_cr,
        ROUND((SUM(COALESCE(r.redemptions, 0.0)) + SUM(COALESCE(r.switch_out, 0.0))) / 100.0, 4) AS redemptions_cr,
        ROUND(SUM(COALESCE(r.redemptions, 0.0)) / 100.0, 4) AS pure_redemptions_cr,
        ROUND(SUM(COALESCE(r.switch_out, 0.0)) / 100.0, 4) AS switch_out_cr,
        ROUND(SUM(r.total_net_sales) / 100.0, 4) AS net_added_cr,
        ROUND(SUM(r.active_sip_value) / 100.0, 4) AS active_sip_cr,
        SUM(TRY_CAST(r.active_sip_count AS BIGINT)) AS active_sip_count,
        ROUND(CASE WHEN SUM(TRY_CAST(r.active_sip_count AS BIGINT)) > 0 
              THEN (SUM(r.active_sip_value) * 100000.0) / SUM(TRY_CAST(r.active_sip_count AS BIGINT)) 
              ELSE 0.0 END, 2) AS avg_sip_ticket_inr,
        ROUND(SUM(r.new_sip_value) / 100.0, 4) AS new_sip_cr,
        SUM(TRY_CAST(r.new_sip_count AS BIGINT)) AS new_sip_count,
        ROUND(SUM(r.stp_value) / 100.0, 4) AS active_stp_cr,
        SUM(TRY_CAST(r.new_stp_count AS BIGINT)) AS new_stp_count,
        SUM(TRY_CAST(r.folio_count AS BIGINT)) AS folio_count,
        COUNT(DISTINCT r.distributor_code) AS active_mfds_scheme
    FROM raw_12m r
    LEFT JOIN geo_master g ON r.registered_pincode = g.pincode
    GROUP BY r.month, r.registered_pincode, r.scheme_type;
""")
print(f"  Aggregated scheme facts in {time.time() - t_agg:.2f}s", flush=True)

t_mfd = time.time()
con.execute("""
    CREATE TABLE temp_pin_mfd AS
    WITH raw_12m_mfd AS (
        SELECT month, registered_pincode, distributor_code
        FROM src_db.mfdex_2026
        WHERE registered_pincode IS NOT NULL AND registered_pincode != ''
        UNION ALL
        SELECT month, registered_pincode, distributor_code
        FROM src_db.mfdex_2025
        WHERE month IN ('Aug-25', 'Sep-25', 'Oct-25', 'Nov-25', 'Dec-25')
          AND registered_pincode IS NOT NULL AND registered_pincode != ''
    )
    SELECT month, registered_pincode AS pincode, COUNT(DISTINCT distributor_code) AS pincode_total_mfds
    FROM raw_12m_mfd
    GROUP BY month, registered_pincode;
""")
print(f"  Aggregated pincode MFD counts in {time.time() - t_mfd:.2f}s", flush=True)

t_write = time.time()
con.execute("""
    CREATE TABLE tgt_db.pincode_scheme_monthly AS
    SELECT 
        s.month,
        s.pincode,
        s.city,
        s.district,
        s.state,
        s.city_tier,
        s.lat,
        s.lon,
        s.asset_class,
        s.scheme_type,
        s.closing_aum_cr,
        s.avg_aum_cr,
        s.gross_inflows_cr,
        s.lumpsum_inflows_cr,
        s.switch_in_cr,
        s.redemptions_cr,
        s.pure_redemptions_cr,
        s.switch_out_cr,
        s.net_added_cr,
        s.active_sip_cr,
        s.active_sip_count,
        s.avg_sip_ticket_inr,
        s.new_sip_cr,
        s.new_sip_count,
        s.active_stp_cr,
        s.new_stp_count,
        s.folio_count,
        s.active_mfds_scheme,
        COALESCE(p.pincode_total_mfds, s.active_mfds_scheme) AS pincode_total_mfds
    FROM temp_scheme_facts s
    LEFT JOIN temp_pin_mfd p ON s.month = p.month AND s.pincode = p.pincode;
""")
print(f"  Target SQLite table written in {time.time() - t_write:.2f}s", flush=True)

con.close()

# ---------------------------------------------------------------------------
# Step 4: Create Production Multi-Column Indexes & Optimize
# ---------------------------------------------------------------------------
print("\n[Step 4/4] Creating High-Performance SQLite Indexes & Optimizing...", flush=True)
t_idx = time.time()

tgt_conn = sqlite3.connect(TARGET_SQLITE)
tgt_cur = tgt_conn.cursor()

tgt_cur.execute("PRAGMA journal_mode = WAL;")
tgt_cur.execute("PRAGMA synchronous = NORMAL;")

print("  Indexing (month, pincode)...", flush=True)
tgt_cur.execute("CREATE INDEX IF NOT EXISTS idx_psm_month_pin ON pincode_scheme_monthly(month, pincode);")

print("  Indexing (pincode, month)...", flush=True)
tgt_cur.execute("CREATE INDEX IF NOT EXISTS idx_psm_pin_month ON pincode_scheme_monthly(pincode, month);")

print("  Indexing (month, state)...", flush=True)
tgt_cur.execute("CREATE INDEX IF NOT EXISTS idx_psm_month_state ON pincode_scheme_monthly(month, state);")

print("  Indexing (state, month)...", flush=True)
tgt_cur.execute("CREATE INDEX IF NOT EXISTS idx_psm_state_month ON pincode_scheme_monthly(state, month);")

print("  Indexing (month, district)...", flush=True)
tgt_cur.execute("CREATE INDEX IF NOT EXISTS idx_psm_month_district ON pincode_scheme_monthly(month, district);")

print("  Indexing (district, month)...", flush=True)
tgt_cur.execute("CREATE INDEX IF NOT EXISTS idx_psm_district_month ON pincode_scheme_monthly(district, month);")

print("  Indexing (month, scheme_type)...", flush=True)
tgt_cur.execute("CREATE INDEX IF NOT EXISTS idx_psm_month_scheme ON pincode_scheme_monthly(month, scheme_type);")

print("  Indexing (month)...", flush=True)
tgt_cur.execute("CREATE INDEX IF NOT EXISTS idx_psm_month ON pincode_scheme_monthly(month);")

print("  Analyzing SQLite database for query optimizer...", flush=True)
tgt_cur.execute("PRAGMA optimize;")

tgt_conn.commit()
tgt_conn.close()

print(f"  Indexes created and optimized in {time.time() - t_idx:.2f}s", flush=True)
print("=" * 80, flush=True)
print(f"  BUILD COMPLETED SUCCESSFULLY IN {time.time() - t_start:.2f}s!", flush=True)
print("=" * 80, flush=True)
