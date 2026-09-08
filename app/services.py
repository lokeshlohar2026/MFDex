import os
import time
from typing import Dict, List, Any, Optional
from app.database import get_db_connection
from app.config import STATE_GEOJSON, DISTRICT_GEOJSON

# In-memory GeoJSON cache
_states_geojson_bytes: bytes = b"{}"
_districts_geojson_bytes: bytes = b"{}"

def load_geojson_cache():
    global _states_geojson_bytes, _districts_geojson_bytes
    if os.path.exists(STATE_GEOJSON):
        with open(STATE_GEOJSON, "rb") as f:
            _states_geojson_bytes = f.read()
    if os.path.exists(DISTRICT_GEOJSON):
        with open(DISTRICT_GEOJSON, "rb") as f:
            _districts_geojson_bytes = f.read()

def get_states_geojson() -> bytes:
    return _states_geojson_bytes

def get_districts_geojson() -> bytes:
    return _districts_geojson_bytes

ALL_12_MONTHS_ORDERED = [
    'Aug-25', 'Sep-25', 'Oct-25', 'Nov-25', 'Dec-25',
    'Jan-26', 'Feb-26', 'Mar-26', 'Apr-26', 'May-26', 'Jun-26', 'Jul-26'
]

# In-memory Global Services Cache
_trends_cache: Dict[str, Any] = {}

def get_available_months() -> Dict[str, Any]:
    if "available_months" in _trends_cache:
        return _trends_cache["available_months"]

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT DISTINCT month FROM pincode_scheme_monthly")
        db_months = set(r["month"] for r in cur.fetchall())
        months = [m for m in ALL_12_MONTHS_ORDERED if m in db_months]
        if not months:
            months = sorted(list(db_months))
        res = {
            "months": months,
            "default": "Jun-26" if "Jun-26" in months else (months[-1] if months else "")
        }
        _trends_cache["available_months"] = res
        return res

def get_trailing_3m_summary(level: str, state: Optional[str] = None, district: Optional[str] = None, pincode: Optional[str] = None) -> List[Dict[str, Any]]:
    cache_key = f"summary_{level}_{state}_{district}_{pincode}"
    if cache_key in _trends_cache:
        return _trends_cache[cache_key]

    with get_db_connection() as conn:
        cur = conn.cursor()
        if level == 'national':
            cur.execute("""
                SELECT 
                    month,
                    ROUND(SUM(closing_aum_cr), 2) as aum_cr,
                    ROUND(SUM(gross_inflows_cr), 2) as gross_cr,
                    ROUND(SUM(redemptions_cr), 2) as outflow_cr,
                    ROUND(SUM(net_added_cr), 2) as net_cr,
                    ROUND(SUM(active_sip_cr), 2) as sip_cr,
                    ROUND(SUM(active_stp_cr), 2) as stp_cr,
                    ROUND(MAX(0.0, SUM(lumpsum_inflows_cr) - SUM(active_sip_cr)), 2) as lumpsum_cr,
                    ROUND(SUM(lumpsum_inflows_cr), 2) as sales_cr,
                    SUM(active_sip_count) as sip_count,
                    ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN SUM(active_sip_cr)*10000000.0 / SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                    SUM(active_mfds_scheme) as active_mfds,
                    ROUND(CASE WHEN SUM(gross_inflows_cr) > 0 THEN (SUM(net_added_cr) / SUM(gross_inflows_cr))*100.0 ELSE 0 END, 2) as retention_pct
                FROM pincode_scheme_monthly
                WHERE month IN ('Apr-26', 'May-26', 'Jun-26')
                GROUP BY month
                ORDER BY CASE month WHEN 'Apr-26' THEN 1 WHEN 'May-26' THEN 2 WHEN 'Jun-26' THEN 3 END
            """)
        elif level == 'state':
            cur.execute("""
                SELECT 
                    month,
                    ROUND(SUM(closing_aum_cr), 2) as aum_cr,
                    ROUND(SUM(gross_inflows_cr), 2) as gross_cr,
                    ROUND(SUM(redemptions_cr), 2) as outflow_cr,
                    ROUND(SUM(net_added_cr), 2) as net_cr,
                    ROUND(SUM(active_sip_cr), 2) as sip_cr,
                    ROUND(SUM(active_stp_cr), 2) as stp_cr,
                    ROUND(MAX(0.0, SUM(lumpsum_inflows_cr) - SUM(active_sip_cr)), 2) as lumpsum_cr,
                    ROUND(SUM(lumpsum_inflows_cr), 2) as sales_cr,
                    SUM(active_sip_count) as sip_count,
                    ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN SUM(active_sip_cr)*10000000.0 / SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                    SUM(active_mfds_scheme) as active_mfds,
                    ROUND(CASE WHEN SUM(gross_inflows_cr) > 0 THEN (SUM(net_added_cr) / SUM(gross_inflows_cr))*100.0 ELSE 0 END, 2) as retention_pct
                FROM pincode_scheme_monthly
                WHERE month IN ('Apr-26', 'May-26', 'Jun-26') AND state = ?
                GROUP BY month
                ORDER BY CASE month WHEN 'Apr-26' THEN 1 WHEN 'May-26' THEN 2 WHEN 'Jun-26' THEN 3 END
            """, (state,))
        elif level == 'district':
            query = """
                SELECT 
                    month,
                    ROUND(SUM(closing_aum_cr), 2) as aum_cr,
                    ROUND(SUM(gross_inflows_cr), 2) as gross_cr,
                    ROUND(SUM(redemptions_cr), 2) as outflow_cr,
                    ROUND(SUM(net_added_cr), 2) as net_cr,
                    ROUND(SUM(active_sip_cr), 2) as sip_cr,
                    ROUND(SUM(active_stp_cr), 2) as stp_cr,
                    ROUND(MAX(0.0, SUM(lumpsum_inflows_cr) - SUM(active_sip_cr)), 2) as lumpsum_cr,
                    ROUND(SUM(lumpsum_inflows_cr), 2) as sales_cr,
                    SUM(active_sip_count) as sip_count,
                    ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN SUM(active_sip_cr)*10000000.0 / SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                    SUM(active_mfds_scheme) as active_mfds,
                    ROUND(CASE WHEN SUM(gross_inflows_cr) > 0 THEN (SUM(net_added_cr) / SUM(gross_inflows_cr))*100.0 ELSE 0 END, 2) as retention_pct
                FROM pincode_scheme_monthly
                WHERE month IN ('Apr-26', 'May-26', 'Jun-26') AND district = ?
            """
            args = [district]
            if state:
                query += " AND state = ?"
                args.append(state)
            query += " GROUP BY month ORDER BY CASE month WHEN 'Apr-26' THEN 1 WHEN 'May-26' THEN 2 WHEN 'Jun-26' THEN 3 END"
            cur.execute(query, tuple(args))
        elif level == 'pincode':
            cur.execute("""
                SELECT 
                    month,
                    ROUND(SUM(closing_aum_cr), 2) as aum_cr,
                    ROUND(SUM(gross_inflows_cr), 2) as gross_cr,
                    ROUND(SUM(redemptions_cr), 2) as outflow_cr,
                    ROUND(SUM(net_added_cr), 2) as net_cr,
                    ROUND(SUM(active_sip_cr), 2) as sip_cr,
                    ROUND(SUM(active_stp_cr), 2) as stp_cr,
                    ROUND(MAX(0.0, SUM(lumpsum_inflows_cr) - SUM(active_sip_cr)), 2) as lumpsum_cr,
                    ROUND(SUM(lumpsum_inflows_cr), 2) as sales_cr,
                    SUM(active_sip_count) as sip_count,
                    ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN SUM(active_sip_cr)*10000000.0 / SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                    MAX(pincode_total_mfds) as active_mfds,
                    ROUND(CASE WHEN SUM(gross_inflows_cr) > 0 THEN (SUM(net_added_cr) / SUM(gross_inflows_cr))*100.0 ELSE 0 END, 2) as retention_pct
                FROM pincode_scheme_monthly
                WHERE month IN ('Apr-26', 'May-26', 'Jun-26') AND pincode = ?
                GROUP BY month
                ORDER BY CASE month WHEN 'Apr-26' THEN 1 WHEN 'May-26' THEN 2 WHEN 'Jun-26' THEN 3 END
            """, (pincode,))

        rows = cur.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if 'lumpsum_cr' not in d or d['lumpsum_cr'] is None:
                sales = d.get('sales_cr') or d.get('lumpsum_inflows_cr') or 0
                sip = d.get('sip_cr') or 0
                d['lumpsum_cr'] = round(max(0.0, sales - sip), 2)
            result.append(d)

        _trends_cache[cache_key] = result
        return result

def get_scheme_rotation_3m(level: str, state: Optional[str] = None, district: Optional[str] = None, pincode: Optional[str] = None) -> List[Dict[str, Any]]:
    cache_key = f"schemes_{level}_{state}_{district}_{pincode}"
    if cache_key in _trends_cache:
        return _trends_cache[cache_key]

    with get_db_connection() as conn:
        cur = conn.cursor()
        if level == 'national':
            cur.execute("""
                SELECT 
                    scheme_type, asset_class, month,
                    ROUND(SUM(gross_inflows_cr), 2) as gross,
                    ROUND(SUM(redemptions_cr), 2) as outflow,
                    ROUND(SUM(net_added_cr), 2) as net,
                    ROUND(SUM(active_sip_cr), 2) as sip,
                    ROUND(SUM(closing_aum_cr), 2) as aum
                FROM pincode_scheme_monthly
                WHERE month IN ('Apr-26', 'May-26', 'Jun-26')
                GROUP BY scheme_type, asset_class, month
            """)
        elif level == 'state':
            cur.execute("""
                SELECT 
                    scheme_type, asset_class, month,
                    ROUND(SUM(gross_inflows_cr), 2) as gross,
                    ROUND(SUM(redemptions_cr), 2) as outflow,
                    ROUND(SUM(net_added_cr), 2) as net,
                    ROUND(SUM(active_sip_cr), 2) as sip,
                    ROUND(SUM(closing_aum_cr), 2) as aum
                FROM pincode_scheme_monthly
                WHERE month IN ('Apr-26', 'May-26', 'Jun-26') AND state = ?
                GROUP BY scheme_type, asset_class, month
            """, (state,))
        elif level == 'district':
            query = """
                SELECT 
                    scheme_type, asset_class, month,
                    ROUND(SUM(gross_inflows_cr), 2) as gross,
                    ROUND(SUM(redemptions_cr), 2) as outflow,
                    ROUND(SUM(net_added_cr), 2) as net,
                    ROUND(SUM(active_sip_cr), 2) as sip,
                    ROUND(SUM(closing_aum_cr), 2) as aum
                FROM pincode_scheme_monthly
                WHERE month IN ('Apr-26', 'May-26', 'Jun-26') AND district = ?
            """
            args = [district]
            if state:
                query += " AND state = ?"
                args.append(state)
            query += " GROUP BY scheme_type, asset_class, month"
            cur.execute(query, tuple(args))
        elif level == 'pincode':
            cur.execute("""
                SELECT 
                    scheme_type, asset_class, month,
                    ROUND(gross_inflows_cr, 2) as gross,
                    ROUND(redemptions_cr, 2) as outflow,
                    ROUND(net_added_cr, 2) as net,
                    ROUND(active_sip_cr, 2) as sip,
                    ROUND(closing_aum_cr, 2) as aum
                FROM pincode_scheme_monthly
                WHERE month IN ('Apr-26', 'May-26', 'Jun-26') AND pincode = ?
            """, (pincode,))

        rows = cur.fetchall()
        by_scheme: Dict[str, Dict[str, Any]] = {}
        for r in rows:
            st = r['scheme_type']
            if st not in by_scheme:
                by_scheme[st] = {
                    'scheme_type': st,
                    'asset_class': r['asset_class'] or 'Other',
                    'apr': {'gross': 0, 'net': 0, 'sip': 0, 'aum': 0},
                    'may': {'gross': 0, 'net': 0, 'sip': 0, 'aum': 0},
                    'jun': {'gross': 0, 'net': 0, 'sip': 0, 'aum': 0},
                    'total_gross': 0,
                    'total_net': 0,
                    'total_sip': 0
                }
            m_key = 'apr' if r['month'] == 'Apr-26' else ('may' if r['month'] == 'May-26' else 'jun')
            by_scheme[st][m_key] = {
                'gross': r['gross'] or 0,
                'net': r['net'] or 0,
                'sip': r['sip'] or 0,
                'aum': r['aum'] or 0
            }
            by_scheme[st]['total_gross'] += (r['gross'] or 0)
            by_scheme[st]['total_net'] += (r['net'] or 0)
            by_scheme[st]['total_sip'] += (r['sip'] or 0)

        sorted_schemes = sorted(by_scheme.values(), key=lambda s: s['jun']['gross'], reverse=True)

        for s in sorted_schemes:
            apr_n = s['apr']['net']
            jun_n = s['jun']['net']
            apr_g = s['apr']['gross']
            jun_g = s['jun']['gross']
            sip_g = s['jun']['sip'] - s['apr']['sip']
            ac = (s['asset_class'] or '').upper()

            if jun_n < 0 and apr_n > 50:
                s['momentum'] = 'Tax Drain'
                s['momentum_class'] = 'drain'
            elif (sip_g > 1.0 or (s['jun']['sip'] > 10 and jun_n > 0)) and 'EQUITY' in ac:
                s['momentum'] = 'Sticky SIP'
                s['momentum_class'] = 'sticky'
            elif 'HYBRID' in ac and jun_n > 0:
                s['momentum'] = 'Defensive'
                s['momentum_class'] = 'defensive'
            elif jun_g > apr_g * 1.1:
                s['momentum'] = 'Surging'
                s['momentum_class'] = 'surging'
            else:
                s['momentum'] = 'Steady Flow'
                s['momentum_class'] = 'neutral'

        top_schemes = sorted_schemes[:25]
        _trends_cache[cache_key] = top_schemes
        return top_schemes

def get_national_summary(month: str) -> Dict[str, Any]:
    cache_key = f"national_summary_{month}"
    if cache_key in _trends_cache:
        return _trends_cache[cache_key]

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT 
                ROUND(SUM(closing_aum_cr), 2) as nat_aum,
                ROUND(SUM(gross_inflows_cr), 2) as nat_gross,
                ROUND(SUM(redemptions_cr), 2) as nat_outflow,
                ROUND(SUM(net_added_cr), 2) as nat_net,
                ROUND(SUM(active_sip_cr), 2) as nat_sip,
                ROUND(SUM(active_stp_cr), 2) as nat_stp,
                ROUND(SUM(lumpsum_inflows_cr), 2) as nat_sales,
                ROUND(MAX(0.0, SUM(lumpsum_inflows_cr) - SUM(active_sip_cr)), 2) as nat_lump,
                SUM(active_sip_count) as nat_sip_cnt,
                ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN (SUM(active_sip_cr)*10000000.0)/SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket,
                SUM(active_mfds_scheme) as nat_mfds_footprint,
                ROUND(CASE WHEN SUM(gross_inflows_cr) > 0 THEN (SUM(net_added_cr)/SUM(gross_inflows_cr))*100.0 ELSE 0 END, 2) as retention_pct
            FROM pincode_scheme_monthly
            WHERE month = ?
        """, (month,))
        row = cur.fetchone()

        cur.execute("""
            SELECT 
                scheme_type, asset_class,
                ROUND(SUM(closing_aum_cr), 2) as closing_aum_cr,
                ROUND(SUM(gross_inflows_cr), 2) as gross_inflows_cr,
                ROUND(SUM(redemptions_cr), 2) as redemptions_cr,
                ROUND(SUM(net_added_cr), 2) as net_added_cr,
                ROUND(SUM(active_sip_cr), 2) as active_sip_cr,
                ROUND(SUM(active_stp_cr), 2) as active_stp_cr,
                SUM(active_sip_count) as active_sip_count,
                ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN (SUM(active_sip_cr)*10000000.0)/SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                SUM(active_mfds_scheme) as active_mfds
            FROM pincode_scheme_monthly
            WHERE month = ?
            GROUP BY scheme_type, asset_class
            ORDER BY gross_inflows_cr DESC
            LIMIT 30
        """, (month,))
        schemes = [dict(r) for r in cur.fetchall()]

        res = {
            "month": month,
            "summary": dict(row) if row else {},
            "schemes": schemes,
            "monthly_trends": get_trailing_3m_summary('national'),
            "scheme_rotation": get_scheme_rotation_3m('national')
        }
        _trends_cache[cache_key] = res
        return res

def get_state_summaries(month: str) -> Dict[str, Any]:
    cache_key = f"state_summaries_{month}"
    if cache_key in _trends_cache:
        return _trends_cache[cache_key]

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT 
                state,
                COUNT(DISTINCT pincode) as pincodes_count,
                ROUND(SUM(closing_aum_cr), 2) as aum_cr,
                ROUND(SUM(gross_inflows_cr), 2) as gross_cr,
                ROUND(SUM(redemptions_cr), 2) as outflow_cr,
                ROUND(SUM(net_added_cr), 2) as net_cr,
                ROUND(SUM(active_sip_cr), 2) as sip_cr,
                SUM(active_sip_count) as sip_count,
                SUM(active_mfds_scheme) as active_mfds,
                ROUND(CASE WHEN SUM(gross_inflows_cr) > 0 THEN (SUM(net_added_cr) / SUM(gross_inflows_cr))*100.0 ELSE 0 END, 2) as retention_pct
            FROM pincode_scheme_monthly
            WHERE month = ? AND state IS NOT NULL AND state != ''
            GROUP BY state
        """, (month,))
        states = {r["state"]: dict(r) for r in cur.fetchall()}
        res = {"month": month, "states": states}
        _trends_cache[cache_key] = res
        return res

def get_state_details(month: str, state: str) -> Dict[str, Any]:
    cache_key = f"state_details_{month}_{state}"
    if cache_key in _trends_cache:
        return _trends_cache[cache_key]

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT 
                state,
                COUNT(DISTINCT pincode) as pincodes_count,
                ROUND(SUM(closing_aum_cr), 2) as total_aum_cr,
                ROUND(SUM(gross_inflows_cr), 2) as total_gross_cr,
                ROUND(SUM(redemptions_cr), 2) as total_redemptions_cr,
                ROUND(SUM(net_added_cr), 2) as total_net_added_cr,
                ROUND(SUM(active_sip_cr), 2) as total_sip_cr,
                ROUND(SUM(active_stp_cr), 2) as total_stp_cr,
                ROUND(SUM(lumpsum_inflows_cr), 2) as total_sales_cr,
                ROUND(MAX(0.0, SUM(lumpsum_inflows_cr) - SUM(active_sip_cr)), 2) as total_lumpsum_cr,
                SUM(active_sip_count) as total_sip_count,
                ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN (SUM(active_sip_cr)*10000000.0)/SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                SUM(active_mfds_scheme) as active_mfds,
                ROUND(CASE WHEN SUM(gross_inflows_cr) > 0 THEN (SUM(net_added_cr) / SUM(gross_inflows_cr))*100.0 ELSE 0 END, 2) as retention_pct
            FROM pincode_scheme_monthly
            WHERE month = ? AND state = ?
            GROUP BY state
        """, (month, state))
        sum_row = cur.fetchone()

        cur.execute("""
            SELECT 
                scheme_type, asset_class,
                ROUND(SUM(closing_aum_cr), 2) as closing_aum_cr,
                ROUND(SUM(gross_inflows_cr), 2) as gross_inflows_cr,
                ROUND(SUM(redemptions_cr), 2) as redemptions_cr,
                ROUND(SUM(net_added_cr), 2) as net_added_cr,
                ROUND(SUM(active_sip_cr), 2) as active_sip_cr,
                ROUND(SUM(active_stp_cr), 2) as active_stp_cr,
                SUM(active_sip_count) as active_sip_count,
                ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN (SUM(active_sip_cr)*10000000.0)/SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                SUM(active_mfds_scheme) as active_mfds
            FROM pincode_scheme_monthly
            WHERE month = ? AND state = ?
            GROUP BY scheme_type, asset_class
            ORDER BY gross_inflows_cr DESC
            LIMIT 30
        """, (month, state))
        schemes = [dict(r) for r in cur.fetchall()]

        res = {
            "month": month,
            "state": state,
            "summary": dict(sum_row) if sum_row else {},
            "schemes": schemes,
            "monthly_trends": get_trailing_3m_summary('state', state=state),
            "scheme_rotation": get_scheme_rotation_3m('state', state=state)
        }
        _trends_cache[cache_key] = res
        return res

def normalize_district(district: Optional[str]) -> Optional[str]:
    if not district:
        return None
    d = district.strip()
    if d.lower() in ("mumbai", "mumbai suburban", "mumbai city", "greater bombay"):
        return "Greater Bombay"
    return d

def get_district_details(month: str, district: str, state: Optional[str] = None) -> Dict[str, Any]:
    requested_district = district
    db_district = normalize_district(district) or district
    with get_db_connection() as conn:
        cur = conn.cursor()
        query = """
            SELECT 
                district, MAX(state) as state,
                COUNT(DISTINCT pincode) as pincodes_count,
                ROUND(SUM(closing_aum_cr), 2) as total_aum_cr,
                ROUND(SUM(gross_inflows_cr), 2) as total_gross_cr,
                ROUND(SUM(redemptions_cr), 2) as total_redemptions_cr,
                ROUND(SUM(net_added_cr), 2) as total_net_added_cr,
                ROUND(SUM(active_sip_cr), 2) as total_sip_cr,
                ROUND(SUM(active_stp_cr), 2) as total_stp_cr,
                ROUND(SUM(lumpsum_inflows_cr), 2) as total_sales_cr,
                ROUND(MAX(0.0, SUM(lumpsum_inflows_cr) - SUM(active_sip_cr)), 2) as total_lumpsum_cr,
                SUM(active_sip_count) as total_sip_count,
                ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN (SUM(active_sip_cr)*10000000.0)/SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                SUM(active_mfds_scheme) as total_mfds_footprint,
                ROUND(CASE WHEN SUM(gross_inflows_cr) > 0 THEN (SUM(net_added_cr) / SUM(gross_inflows_cr))*100.0 ELSE 0 END, 2) as retention_pct
            FROM pincode_scheme_monthly
            WHERE month = ? AND district = ?
        """
        args = [month, db_district]
        if state:
            query += " AND state = ?"
            args.append(state)
        query += " GROUP BY district"

        cur.execute(query, tuple(args))
        dist_row = cur.fetchone()

        cur.execute("""
            SELECT 
                scheme_type, asset_class,
                ROUND(SUM(closing_aum_cr), 2) as closing_aum_cr,
                ROUND(SUM(gross_inflows_cr), 2) as gross_inflows_cr,
                ROUND(SUM(redemptions_cr), 2) as redemptions_cr,
                ROUND(SUM(net_added_cr), 2) as net_added_cr,
                ROUND(SUM(active_sip_cr), 2) as active_sip_cr,
                ROUND(SUM(active_stp_cr), 2) as active_stp_cr,
                SUM(active_sip_count) as active_sip_count,
                ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN (SUM(active_sip_cr)*10000000.0)/SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                SUM(active_mfds_scheme) as active_mfds
            FROM pincode_scheme_monthly
            WHERE month = ? AND district = ?
            GROUP BY scheme_type, asset_class
            ORDER BY gross_inflows_cr DESC
            LIMIT 30
        """, (month, db_district))
        schemes = [dict(r) for r in cur.fetchall()]

        summary = dict(dist_row) if dist_row else {}
        display_district = requested_district
        if not display_district or display_district.lower() in ("greater bombay", "mumbai", "mumbai suburban", "mumbai city"):
            display_district = "Mumbai"
        if summary:
            summary["district"] = display_district

        return {
            "month": month,
            "district": display_district,
            "state": state or (summary.get("state", "") if summary else ""),
            "summary": summary,
            "schemes": schemes,
            "monthly_trends": get_trailing_3m_summary('district', state=state, district=db_district),
            "scheme_rotation": get_scheme_rotation_3m('district', state=state, district=db_district)
        }

def get_map_summary(month: str, state: Optional[str] = None, district: Optional[str] = None) -> Dict[str, Any]:
    query = """
        SELECT 
            pincode, lat, lon, city, district, state,
            ROUND(SUM(closing_aum_cr), 2) as total_aum_cr,
            ROUND(SUM(gross_inflows_cr), 2) as total_gross_cr,
            ROUND(SUM(redemptions_cr), 2) as total_redemptions_cr,
            ROUND(SUM(net_added_cr), 2) as total_net_added_cr,
            ROUND(SUM(active_sip_cr), 2) as total_sip_cr,
            SUM(active_sip_count) as total_sip_count,
            ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN (SUM(active_sip_cr)*10000000.0)/SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
            MAX(pincode_total_mfds) as active_mfds,
            ROUND(CASE WHEN SUM(gross_inflows_cr) > 0 THEN (SUM(net_added_cr)/SUM(gross_inflows_cr))*100.0 ELSE 0 END, 2) as retention_pct
        FROM pincode_scheme_monthly
        WHERE month = ? AND lat != 0.0 AND lon != 0.0
    """
    args = [month]
    if state:
        query += " AND state = ?"
        args.append(state)
    if district:
        district_norm = normalize_district(district) or district
        query += " AND district = ?"
        args.append(district_norm)
    query += " GROUP BY pincode"

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(query, tuple(args))
        rows = cur.fetchall()
        data = [
            [
                r["pincode"], r["lat"], r["lon"], r["city"], r["district"], r["state"],
                r["total_aum_cr"], r["total_gross_cr"], r["total_redemptions_cr"],
                r["total_net_added_cr"], r["total_sip_cr"], r["total_sip_count"],
                r["avg_sip_ticket_inr"], r["active_mfds"], r["retention_pct"]
            ]
            for r in rows
        ]
        return {"month": month, "count": len(data), "pincodes": data}

def get_pincode_details(month: str, pincode: str) -> Dict[str, Any]:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT 
                month, pincode, MAX(city) as city, MAX(district) as district, MAX(state) as state,
                MAX(city_tier) as city_tier, MAX(lat) as lat, MAX(lon) as lon,
                ROUND(SUM(closing_aum_cr), 2) as total_aum_cr,
                ROUND(SUM(avg_aum_cr), 2) as total_avg_aum_cr,
                ROUND(SUM(gross_inflows_cr), 2) as total_gross_cr,
                ROUND(SUM(lumpsum_inflows_cr), 2) as total_sales_cr,
                ROUND(MAX(0.0, SUM(lumpsum_inflows_cr) - SUM(active_sip_cr)), 2) as total_lumpsum_cr,
                ROUND(SUM(switch_in_cr), 2) as total_switch_in_cr,
                ROUND(SUM(redemptions_cr), 2) as total_redemptions_cr,
                ROUND(SUM(pure_redemptions_cr), 2) as total_pure_redemptions_cr,
                ROUND(SUM(switch_out_cr), 2) as total_switch_out_cr,
                ROUND(SUM(net_added_cr), 2) as total_net_added_cr,
                ROUND(SUM(active_sip_cr), 2) as total_sip_cr,
                SUM(active_sip_count) as total_sip_count,
                ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN (SUM(active_sip_cr)*10000000.0)/SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                ROUND(SUM(new_sip_cr), 2) as new_sip_cr,
                SUM(new_sip_count) as new_sip_count,
                ROUND(SUM(active_stp_cr), 2) as total_stp_cr,
                SUM(new_stp_count) as new_stp_count,
                SUM(folio_count) as folio_count,
                MAX(pincode_total_mfds) as active_mfds,
                ROUND(CASE WHEN SUM(gross_inflows_cr) > 0 THEN (SUM(net_added_cr)/SUM(gross_inflows_cr))*100.0 ELSE 0 END, 2) as retention_pct
            FROM pincode_scheme_monthly
            WHERE month = ? AND pincode = ?
            GROUP BY month, pincode
        """, (month, pincode))
        summary_row = cur.fetchone()
        summary = dict(summary_row) if summary_row else None
        if summary and summary.get("district") in ("Greater Bombay", "Mumbai Suburban", "Mumbai City"):
            summary["district"] = "Mumbai"

        cur.execute("""
            SELECT 
                scheme_type, asset_class, closing_aum_cr, avg_aum_cr,
                gross_inflows_cr, lumpsum_inflows_cr, switch_in_cr,
                redemptions_cr, pure_redemptions_cr, switch_out_cr,
                net_added_cr, active_sip_cr, active_sip_count, avg_sip_ticket_inr,
                new_sip_cr, new_sip_count, active_stp_cr, new_stp_count,
                folio_count, active_mfds_scheme as active_mfds,
                ROUND(CASE WHEN gross_inflows_cr > 0 THEN (net_added_cr/gross_inflows_cr)*100.0 ELSE 0 END, 2) as retention_pct
            FROM pincode_scheme_monthly
            WHERE month = ? AND pincode = ?
            ORDER BY gross_inflows_cr DESC
        """, (month, pincode))
        schemes = [dict(r) for r in cur.fetchall()]

        cur.execute("""
            SELECT 
                month,
                ROUND(SUM(closing_aum_cr), 2) as total_aum_cr,
                ROUND(SUM(gross_inflows_cr), 2) as total_gross_cr,
                ROUND(SUM(redemptions_cr), 2) as total_redemptions_cr,
                ROUND(SUM(net_added_cr), 2) as total_net_added_cr,
                ROUND(SUM(active_sip_cr), 2) as total_sip_cr,
                ROUND(SUM(active_stp_cr), 2) as total_stp_cr,
                SUM(active_sip_count) as total_sip_count,
                MAX(pincode_total_mfds) as active_mfds
            FROM pincode_scheme_monthly
            WHERE pincode = ?
            GROUP BY month
            ORDER BY rowid ASC
        """, (pincode,))
        trend = [dict(r) for r in cur.fetchall()]

        return {
            "month": month,
            "pincode": pincode,
            "summary": summary,
            "schemes": schemes,
            "trend": trend,
            "monthly_trends": get_trailing_3m_summary('pincode', pincode=pincode),
            "scheme_rotation": get_scheme_rotation_3m('pincode', pincode=pincode)
        }

HORIZON_MONTHS = {
    '3M': ['Apr-26', 'May-26', 'Jun-26'],
    '6M': ['Jan-26', 'Feb-26', 'Mar-26', 'Apr-26', 'May-26', 'Jun-26'],
    '1Y': ALL_12_MONTHS_ORDERED
}

def get_multi_period_analytics(
    horizon: str = '3M',
    level: str = 'national',
    state: Optional[str] = None,
    district: Optional[str] = None,
    pincode: Optional[str] = None
) -> Dict[str, Any]:
    horizon = horizon.upper() if horizon else '3M'
    if horizon not in HORIZON_MONTHS:
        horizon = '3M'
    months = HORIZON_MONTHS[horizon]
    placeholders = ','.join('?' for _ in months)

    cache_key = f"multi_{horizon}_{level}_{state}_{district}_{pincode}"
    if cache_key in _trends_cache:
        return _trends_cache[cache_key]

    with get_db_connection() as conn:
        cur = conn.cursor()
        
        # 1. Monthly Waterfall rows
        if level == 'national':
            cur.execute(f"""
                SELECT 
                    month,
                    ROUND(SUM(closing_aum_cr), 2) as aum_cr,
                    ROUND(SUM(gross_inflows_cr), 2) as gross_cr,
                    ROUND(SUM(redemptions_cr), 2) as outflow_cr,
                    ROUND(SUM(net_added_cr), 2) as net_cr,
                    ROUND(SUM(active_sip_cr), 2) as sip_cr,
                    ROUND(SUM(active_stp_cr), 2) as stp_cr,
                    ROUND(SUM(lumpsum_inflows_cr), 2) as sales_cr,
                    ROUND(MAX(0.0, SUM(lumpsum_inflows_cr) - SUM(active_sip_cr)), 2) as lumpsum_cr,
                    SUM(active_sip_count) as sip_count,
                    ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN (SUM(active_sip_cr)*10000000.0)/SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                    SUM(active_mfds_scheme) as active_mfds,
                    ROUND(CASE WHEN SUM(gross_inflows_cr) > 0 THEN (SUM(net_added_cr)/SUM(gross_inflows_cr))*100.0 ELSE 0 END, 2) as retention_pct
                FROM pincode_scheme_monthly
                WHERE month IN ({placeholders})
                GROUP BY month
            """, tuple(months))
            ent_title = "All India Universe"
            ent_subtitle = "Verified Independent MFD & RIA Telemetry"
        elif level == 'state':
            cur.execute(f"""
                SELECT 
                    month,
                    ROUND(SUM(closing_aum_cr), 2) as aum_cr,
                    ROUND(SUM(gross_inflows_cr), 2) as gross_cr,
                    ROUND(SUM(redemptions_cr), 2) as outflow_cr,
                    ROUND(SUM(net_added_cr), 2) as net_cr,
                    ROUND(SUM(active_sip_cr), 2) as sip_cr,
                    ROUND(SUM(active_stp_cr), 2) as stp_cr,
                    ROUND(SUM(lumpsum_inflows_cr), 2) as sales_cr,
                    ROUND(MAX(0.0, SUM(lumpsum_inflows_cr) - SUM(active_sip_cr)), 2) as lumpsum_cr,
                    SUM(active_sip_count) as sip_count,
                    ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN (SUM(active_sip_cr)*10000000.0)/SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                    SUM(active_mfds_scheme) as active_mfds,
                    ROUND(CASE WHEN SUM(gross_inflows_cr) > 0 THEN (SUM(net_added_cr)/SUM(gross_inflows_cr))*100.0 ELSE 0 END, 2) as retention_pct
                FROM pincode_scheme_monthly
                WHERE state = ? AND month IN ({placeholders})
                GROUP BY month
            """, (state, *months))
            ent_title = state or "State Tier"
            ent_subtitle = "State-Level Macro Capital Telemetry"
        elif level == 'district':
            query = f"""
                SELECT 
                    month,
                    ROUND(SUM(closing_aum_cr), 2) as aum_cr,
                    ROUND(SUM(gross_inflows_cr), 2) as gross_cr,
                    ROUND(SUM(redemptions_cr), 2) as outflow_cr,
                    ROUND(SUM(net_added_cr), 2) as net_cr,
                    ROUND(SUM(active_sip_cr), 2) as sip_cr,
                    ROUND(SUM(active_stp_cr), 2) as stp_cr,
                    ROUND(SUM(lumpsum_inflows_cr), 2) as sales_cr,
                    ROUND(MAX(0.0, SUM(lumpsum_inflows_cr) - SUM(active_sip_cr)), 2) as lumpsum_cr,
                    SUM(active_sip_count) as sip_count,
                    ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN (SUM(active_sip_cr)*10000000.0)/SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                    SUM(active_mfds_scheme) as active_mfds,
                    ROUND(CASE WHEN SUM(gross_inflows_cr) > 0 THEN (SUM(net_added_cr)/SUM(gross_inflows_cr))*100.0 ELSE 0 END, 2) as retention_pct
                """
            args = [district, *months]
            if state:
                query += " AND state = ?"
                args.append(state)
            query += f" FROM pincode_scheme_monthly WHERE district = ? AND month IN ({placeholders})"
            if state:
                query = f"""
                SELECT 
                    month,
                    ROUND(SUM(closing_aum_cr), 2) as aum_cr,
                    ROUND(SUM(gross_inflows_cr), 2) as gross_cr,
                    ROUND(SUM(redemptions_cr), 2) as outflow_cr,
                    ROUND(SUM(net_added_cr), 2) as net_cr,
                    ROUND(SUM(active_sip_cr), 2) as sip_cr,
                    ROUND(SUM(active_stp_cr), 2) as stp_cr,
                    ROUND(SUM(lumpsum_inflows_cr), 2) as sales_cr,
                    ROUND(MAX(0.0, SUM(lumpsum_inflows_cr) - SUM(active_sip_cr)), 2) as lumpsum_cr,
                    SUM(active_sip_count) as sip_count,
                    ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN (SUM(active_sip_cr)*10000000.0)/SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                    SUM(active_mfds_scheme) as active_mfds,
                    ROUND(CASE WHEN SUM(gross_inflows_cr) > 0 THEN (SUM(net_added_cr)/SUM(gross_inflows_cr))*100.0 ELSE 0 END, 2) as retention_pct
                FROM pincode_scheme_monthly
                WHERE district = ? AND month IN ({placeholders}) AND state = ?
                GROUP BY month
                """
                args = [district, *months, state]
            else:
                query = f"""
                SELECT 
                    month,
                    ROUND(SUM(closing_aum_cr), 2) as aum_cr,
                    ROUND(SUM(gross_inflows_cr), 2) as gross_cr,
                    ROUND(SUM(redemptions_cr), 2) as outflow_cr,
                    ROUND(SUM(net_added_cr), 2) as net_cr,
                    ROUND(SUM(active_sip_cr), 2) as sip_cr,
                    ROUND(SUM(active_stp_cr), 2) as stp_cr,
                    ROUND(SUM(lumpsum_inflows_cr), 2) as sales_cr,
                    ROUND(MAX(0.0, SUM(lumpsum_inflows_cr) - SUM(active_sip_cr)), 2) as lumpsum_cr,
                    SUM(active_sip_count) as sip_count,
                    ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN (SUM(active_sip_cr)*10000000.0)/SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                    SUM(active_mfds_scheme) as active_mfds,
                    ROUND(CASE WHEN SUM(gross_inflows_cr) > 0 THEN (SUM(net_added_cr)/SUM(gross_inflows_cr))*100.0 ELSE 0 END, 2) as retention_pct
                FROM pincode_scheme_monthly
                WHERE district = ? AND month IN ({placeholders})
                GROUP BY month
                """
                args = [district, *months]
            cur.execute(query, tuple(args))
            ent_title = f"{district} District"
            ent_subtitle = f"District Telemetry ({state})" if state else "District Telemetry"
        elif level == 'pincode':
            cur.execute(f"""
                SELECT 
                    month,
                    ROUND(SUM(closing_aum_cr), 2) as aum_cr,
                    ROUND(SUM(gross_inflows_cr), 2) as gross_cr,
                    ROUND(SUM(redemptions_cr), 2) as outflow_cr,
                    ROUND(SUM(net_added_cr), 2) as net_cr,
                    ROUND(SUM(active_sip_cr), 2) as sip_cr,
                    ROUND(SUM(active_stp_cr), 2) as stp_cr,
                    ROUND(SUM(lumpsum_inflows_cr), 2) as sales_cr,
                    ROUND(MAX(0.0, SUM(lumpsum_inflows_cr) - SUM(active_sip_cr)), 2) as lumpsum_cr,
                    SUM(active_sip_count) as sip_count,
                    ROUND(CASE WHEN SUM(active_sip_count) > 0 THEN (SUM(active_sip_cr)*10000000.0)/SUM(active_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                    MAX(pincode_total_mfds) as active_mfds,
                    ROUND(CASE WHEN SUM(gross_inflows_cr) > 0 THEN (SUM(net_added_cr)/SUM(gross_inflows_cr))*100.0 ELSE 0 END, 2) as retention_pct
                FROM pincode_scheme_monthly
                WHERE pincode = ? AND month IN ({placeholders})
                GROUP BY month
            """, (pincode, *months))
            ent_title = f"PIN {pincode}"
            ent_subtitle = "Hyper-Local Micro Market Telemetry"
        else:
            rows = []
            ent_title = "Unknown"
            ent_subtitle = ""

        raw_wf = {r['month']: dict(r) for r in cur.fetchall()}
        
        # Order months chronologically
        waterfall = []
        tot_net = 0.0
        tot_gross = 0.0
        tot_outflow = 0.0
        tot_sip = 0.0
        tot_stp = 0.0
        tot_lumpsum = 0.0
        latest_aum = 0.0
        latest_sip_book = 0.0
        latest_active_mfds = 0

        for m in months:
            row = raw_wf.get(m, {
                'month': m,
                'aum_cr': 0.0,
                'gross_cr': 0.0,
                'outflow_cr': 0.0,
                'net_cr': 0.0,
                'sip_cr': 0.0,
                'stp_cr': 0.0,
                'lumpsum_cr': 0.0,
                'sip_count': 0,
                'avg_sip_ticket_inr': 0.0,
                'active_mfds': 0,
                'retention_pct': 0.0
            })
            g = float(row.get('gross_cr') or 0)
            o = float(row.get('outflow_cr') or 0)
            n = float(row.get('net_cr') or 0)
            s = float(row.get('sip_cr') or 0)
            stp = float(row.get('stp_cr') or 0)
            lump = float(row.get('lumpsum_cr') or 0)
            if lump == 0 and g > 0:
                sales = float(row.get('sales_cr') or 0)
                if sales > 0:
                    lump = max(0.0, sales - s)
                else:
                    lump = max(0.0, g - s - stp)
            row['lumpsum_cr'] = round(lump, 2)

            tot_src = lump + s + stp
            if tot_src > 0:
                row['lump_pct'] = round((lump / tot_src) * 100.0, 1)
                row['sip_pct'] = round((s / tot_src) * 100.0, 1)
                row['stp_pct'] = round((stp / tot_src) * 100.0, 1)
            else:
                row['lump_pct'] = 0.0
                row['sip_pct'] = 0.0
                row['stp_pct'] = 0.0

            waterfall.append(row)
            tot_net += n
            tot_gross += g
            tot_outflow += o
            tot_sip += s
            tot_stp += stp
            tot_lumpsum += lump
            latest_aum = float(row.get('aum_cr') or 0)
            latest_sip_book = s
            latest_active_mfds = int(row.get('active_mfds') or 0)

        overall_retention = round((tot_net / tot_gross) * 100.0, 1) if tot_gross > 0 else 0.0

        # Sourcing Trajectory
        sourcing = []
        for row in waterfall:
            g = float(row.get('gross_cr') or 0)
            s = float(row.get('sip_cr') or 0)
            stp = float(row.get('stp_cr') or 0)
            lump = float(row.get('lumpsum_cr') or 0)
            
            total_source = lump + s + stp
            if total_source > 0:
                lump_pct = round((lump / total_source) * 100.0, 1)
                sip_pct = round((s / total_source) * 100.0, 1)
                stp_pct = round((stp / total_source) * 100.0, 1)
            else:
                lump_pct, sip_pct, stp_pct = 0.0, 0.0, 0.0

            sourcing.append({
                'month': row['month'],
                'gross_cr': round(g, 2),
                'lumpsum_cr': round(lump, 2),
                'lump_pct': lump_pct,
                'lumpsum_pct': lump_pct,
                'sip_cr': round(s, 2),
                'sip_pct': sip_pct,
                'stp_cr': round(stp, 2),
                'stp_pct': stp_pct
            })

        # 2. Scheme Rotation Matrix (What Was Selling When)
        if level == 'national':
            cur.execute(f"""
                SELECT scheme_type, asset_class, month,
                       ROUND(SUM(gross_inflows_cr), 2) as gross_inflows_cr,
                       ROUND(SUM(net_added_cr), 2) as net_added_cr,
                       ROUND(SUM(active_sip_cr), 2) as active_sip_cr,
                       ROUND(SUM(closing_aum_cr), 2) as closing_aum_cr
                FROM pincode_scheme_monthly
                WHERE month IN ({placeholders})
                GROUP BY scheme_type, asset_class, month
                ORDER BY gross_inflows_cr DESC
            """, tuple(months))
        elif level == 'state':
            cur.execute(f"""
                SELECT scheme_type, asset_class, month,
                       ROUND(SUM(gross_inflows_cr), 2) as gross_inflows_cr,
                       ROUND(SUM(net_added_cr), 2) as net_added_cr,
                       ROUND(SUM(active_sip_cr), 2) as active_sip_cr,
                       ROUND(SUM(closing_aum_cr), 2) as closing_aum_cr
                FROM pincode_scheme_monthly
                WHERE state = ? AND month IN ({placeholders})
                GROUP BY scheme_type, asset_class, month
                ORDER BY gross_inflows_cr DESC
            """, (state, *months))
        elif level == 'district':
            cur.execute(f"""
                SELECT scheme_type, asset_class, month, 
                       ROUND(SUM(gross_inflows_cr), 2) as gross_inflows_cr,
                       ROUND(SUM(net_added_cr), 2) as net_added_cr,
                       ROUND(SUM(active_sip_cr), 2) as active_sip_cr,
                       ROUND(SUM(closing_aum_cr), 2) as closing_aum_cr
                FROM pincode_scheme_monthly
                WHERE district = ? AND month IN ({placeholders})
                GROUP BY scheme_type, asset_class, month
                ORDER BY gross_inflows_cr DESC
            """, (district, *months))
        elif level == 'pincode':
            cur.execute(f"""
                SELECT scheme_type, asset_class, month,
                       ROUND(gross_inflows_cr, 2) as gross_inflows_cr,
                       ROUND(net_added_cr, 2) as net_added_cr,
                       ROUND(active_sip_cr, 2) as active_sip_cr,
                       ROUND(closing_aum_cr, 2) as closing_aum_cr
                FROM pincode_scheme_monthly
                WHERE pincode = ? AND month IN ({placeholders})
                ORDER BY gross_inflows_cr DESC
            """, (pincode, *months))

        scheme_rows = cur.fetchall()
        by_scheme: Dict[str, Dict[str, Any]] = {}
        for r in scheme_rows:
            st = r['scheme_type']
            if st not in by_scheme:
                by_scheme[st] = {
                    'scheme_type': st,
                    'asset_class': r['asset_class'] or 'Other',
                    'monthly_gross': {m: 0.0 for m in months},
                    'monthly_net': {m: 0.0 for m in months},
                    'monthly_sip': {m: 0.0 for m in months},
                    'monthly_aum': {m: 0.0 for m in months},
                    'total_gross': 0.0,
                    'total_net': 0.0,
                    'latest_sip': 0.0,
                    'latest_aum': 0.0
                }
            m = r['month']
            g_val = float(r['gross_inflows_cr'] or 0)
            n_val = float(r['net_added_cr'] or 0)
            s_val = float(r['active_sip_cr'] or 0)
            a_val = float(r['closing_aum_cr'] or 0)
            by_scheme[st]['monthly_gross'][m] = g_val
            by_scheme[st]['monthly_net'][m] = n_val
            by_scheme[st]['monthly_sip'][m] = s_val
            by_scheme[st]['monthly_aum'][m] = a_val
            by_scheme[st]['total_gross'] += g_val
            by_scheme[st]['total_net'] += n_val

        # Populate latest_sip and latest_aum for sorting
        last_m = months[-1]
        for s in by_scheme.values():
            s['latest_sip'] = s['monthly_sip'].get(last_m, 0.0)
            s['latest_aum'] = s['monthly_aum'].get(last_m, 0.0)
            s['retention_pct'] = round((s['total_net'] / s['total_gross']) * 100.0, 1) if s['total_gross'] > 0 else 0.0

        # Sort schemes by total gross across the period
        sorted_rotation = sorted(by_scheme.values(), key=lambda x: x['total_gross'], reverse=True)

        # Classify momentum
        for s in sorted_rotation:
            first_m = months[0]
            first_g = s['monthly_gross'].get(first_m, 0.0)
            last_g = s['monthly_gross'].get(last_m, 0.0)
            last_n = s['monthly_net'].get(last_m, 0.0)
            tot_g = s['total_gross']
            tot_n = s['total_net']
            ac = (s['asset_class'] or '').upper()

            if tot_n < 0 and tot_g > 20:
                s['badge'] = 'Tax Drain'
                s['badge_class'] = 'drain'
            elif 'EQUITY' in ac and tot_n > 0.5 * tot_g and tot_n > 5:
                s['badge'] = 'Sticky Compounding'
                s['badge_class'] = 'sticky'
            elif 'HYBRID' in ac and tot_n > 0:
                s['badge'] = 'Defensive'
                s['badge_class'] = 'defensive'
            elif last_g > first_g * 1.2 and last_g > 2.0:
                s['badge'] = 'Surging'
                s['badge_class'] = 'surging'
            else:
                s['badge'] = 'Steady Flow'
                s['badge_class'] = 'neutral'

        analytics_payload = {
            'horizon': horizon,
            'level': level,
            'entity': {'title': ent_title, 'subtitle': ent_subtitle},
            'entity_title': ent_title,
            'entity_subtitle': ent_subtitle,
            'months': months,
            'summary': {
                'total_net_cr': round(tot_net, 2),
                'total_gross_cr': round(tot_gross, 2),
                'total_outflow_cr': round(tot_outflow, 2),
                'overall_retention_pct': overall_retention,
                'latest_aum_cr': round(latest_aum, 2),
                'latest_sip_cr': round(latest_sip_book, 2),
                'latest_mfds': latest_active_mfds,
                'ending_aum_cr': round(latest_aum, 2),
                'ending_sip_book_cr': round(latest_sip_book, 2),
                'active_mfds': latest_active_mfds
            },
            'waterfall': waterfall,
            'sourcing': sourcing,
            'product_rotation': sorted_rotation[:25],
            'rotation': sorted_rotation[:25]
        }

        _trends_cache[cache_key] = analytics_payload
        return analytics_payload

def warmup_caches():
    """
    Production Pre-Warmup:
    Pre-warms available months, default national summary, state summaries,
    and trajectory data so initial and repeat user loads take < 5ms.
    """
    t0 = time.time()
    months_info = get_available_months()
    def_month = months_info.get("default", "Jun-26")
    print(f"  [Cache Warmup] Pre-warming cache for default month '{def_month}'...", flush=True)
    get_national_summary(def_month)
    get_state_summaries(def_month)
    get_multi_period_analytics("3M", "national")
    print(f"  [Cache Warmup] Completed in {(time.time() - t0):.2f}s. All core endpoints primed for < 5ms response.", flush=True)
