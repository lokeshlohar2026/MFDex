import os
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

def get_available_months() -> Dict[str, Any]:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT DISTINCT month FROM pincode_monthly_summary ORDER BY rowid DESC")
        months = [r["month"] for r in cur.fetchall()]
        return {
            "months": months,
            "default": "Jun-26" if "Jun-26" in months else (months[0] if months else "")
        }

# In-memory Trends and Schemes Cache
_trends_cache: Dict[str, Any] = {}

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
                    nat_aum as aum_cr,
                    nat_gross as gross_cr,
                    nat_outflow as outflow_cr,
                    nat_net as net_cr,
                    nat_sip as sip_cr,
                    nat_stp as stp_cr,
                    nat_sip_cnt as sip_count,
                    avg_sip_ticket as avg_sip_ticket_inr,
                    nat_mfds_footprint as active_mfds,
                    retention_pct
                FROM national_monthly_summary
                WHERE month IN ('Apr-26', 'May-26', 'Jun-26')
                ORDER BY CASE month WHEN 'Apr-26' THEN 1 WHEN 'May-26' THEN 2 WHEN 'Jun-26' THEN 3 END
            """)
        elif level == 'state':
            cur.execute("""
                SELECT 
                    month,
                    ROUND(SUM(total_aum_cr), 2) as aum_cr,
                    ROUND(SUM(total_gross_cr), 2) as gross_cr,
                    ROUND(SUM(total_redemptions_cr), 2) as outflow_cr,
                    ROUND(SUM(total_net_added_cr), 2) as net_cr,
                    ROUND(SUM(total_sip_cr), 2) as sip_cr,
                    ROUND(SUM(total_stp_cr), 2) as stp_cr,
                    SUM(total_sip_count) as sip_count,
                    ROUND(CASE WHEN SUM(total_sip_count) > 0 THEN SUM(total_sip_cr)*10000000.0 / SUM(total_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                    SUM(active_mfds) as active_mfds,
                    ROUND(CASE WHEN SUM(total_gross_cr) > 0 THEN (SUM(total_net_added_cr) / SUM(total_gross_cr))*100.0 ELSE 0 END, 2) as retention_pct
                FROM pincode_monthly_summary
                WHERE month IN ('Apr-26', 'May-26', 'Jun-26') AND state = ?
                GROUP BY month
                ORDER BY CASE month WHEN 'Apr-26' THEN 1 WHEN 'May-26' THEN 2 WHEN 'Jun-26' THEN 3 END
            """, (state,))
        elif level == 'district':
            query = """
                SELECT 
                    month,
                    ROUND(total_aum_cr, 2) as aum_cr,
                    ROUND(total_gross_cr, 2) as gross_cr,
                    ROUND(total_redemptions_cr, 2) as outflow_cr,
                    ROUND(total_net_added_cr, 2) as net_cr,
                    ROUND(total_sip_cr, 2) as sip_cr,
                    ROUND(total_stp_cr, 2) as stp_cr,
                    total_sip_count as sip_count,
                    avg_sip_ticket_inr,
                    total_mfds_footprint as active_mfds,
                    retention_pct
                FROM district_monthly_summary
                WHERE month IN ('Apr-26', 'May-26', 'Jun-26') AND district = ?
            """
            args = [district]
            if state:
                query += " AND state = ?"
                args.append(state)
            query += " ORDER BY CASE month WHEN 'Apr-26' THEN 1 WHEN 'May-26' THEN 2 WHEN 'Jun-26' THEN 3 END"
            cur.execute(query, tuple(args))
        elif level == 'pincode':
            cur.execute("""
                SELECT 
                    month,
                    ROUND(total_aum_cr, 2) as aum_cr,
                    ROUND(total_gross_cr, 2) as gross_cr,
                    ROUND(total_redemptions_cr, 2) as outflow_cr,
                    ROUND(total_net_added_cr, 2) as net_cr,
                    ROUND(total_sip_cr, 2) as sip_cr,
                    ROUND(total_stp_cr, 2) as stp_cr,
                    total_sip_count as sip_count,
                    avg_sip_ticket_inr,
                    active_mfds,
                    retention_pct
                FROM pincode_monthly_summary
                WHERE month IN ('Apr-26', 'May-26', 'Jun-26') AND pincode = ?
                ORDER BY CASE month WHEN 'Apr-26' THEN 1 WHEN 'May-26' THEN 2 WHEN 'Jun-26' THEN 3 END
            """, (pincode,))

        rows = cur.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            gross = d.get('gross_cr') or 0
            sip = d.get('sip_cr') or 0
            stp = d.get('stp_cr') or 0
            d['lumpsum_cr'] = round(max(0.0, gross - sip - stp), 2)
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
                    gross_inflows_cr as gross,
                    redemptions_cr as outflow,
                    net_added_cr as net,
                    active_sip_cr as sip,
                    closing_aum_cr as aum
                FROM national_scheme_monthly
                WHERE month IN ('Apr-26', 'May-26', 'Jun-26')
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
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT 
                nat_aum, nat_gross, nat_outflow, nat_net,
                nat_sip, nat_stp, nat_sip_cnt, avg_sip_ticket,
                nat_mfds_footprint, retention_pct
            FROM national_monthly_summary
            WHERE month = ?
        """, (month,))
        row = cur.fetchone()

        cur.execute("""
            SELECT 
                scheme_type, asset_class,
                closing_aum_cr, gross_inflows_cr, redemptions_cr, net_added_cr,
                active_sip_cr, active_stp_cr, active_sip_count,
                ROUND(CASE WHEN active_sip_count > 0 THEN (active_sip_cr*10000000.0)/active_sip_count ELSE 0 END, 2) as avg_sip_ticket_inr,
                active_mfds
            FROM national_scheme_monthly
            WHERE month = ?
            ORDER BY gross_inflows_cr DESC
            LIMIT 30
        """, (month,))
        schemes = [dict(r) for r in cur.fetchall()]

        return {
            "month": month,
            "summary": dict(row) if row else {},
            "schemes": schemes,
            "monthly_trends": get_trailing_3m_summary('national'),
            "scheme_rotation": get_scheme_rotation_3m('national')
        }

def get_state_summaries(month: str) -> Dict[str, Any]:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT 
                state,
                COUNT(DISTINCT pincode) as pincodes_count,
                ROUND(SUM(total_aum_cr), 2) as aum_cr,
                ROUND(SUM(total_gross_cr), 2) as gross_cr,
                ROUND(SUM(total_redemptions_cr), 2) as outflow_cr,
                ROUND(SUM(total_net_added_cr), 2) as net_cr,
                ROUND(SUM(total_sip_cr), 2) as sip_cr,
                SUM(total_sip_count) as sip_count,
                SUM(active_mfds) as active_mfds,
                ROUND(CASE WHEN SUM(total_gross_cr) > 0 THEN (SUM(total_net_added_cr) / SUM(total_gross_cr))*100.0 ELSE 0 END, 2) as retention_pct
            FROM pincode_monthly_summary
            WHERE month = ? AND state IS NOT NULL AND state != ''
            GROUP BY state
        """, (month,))
        states = {r["state"]: dict(r) for r in cur.fetchall()}
        return {"month": month, "states": states}

def get_state_details(month: str, state: str) -> Dict[str, Any]:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT 
                state,
                COUNT(DISTINCT pincode) as pincodes_count,
                ROUND(SUM(total_aum_cr), 2) as total_aum_cr,
                ROUND(SUM(total_gross_cr), 2) as total_gross_cr,
                ROUND(SUM(total_redemptions_cr), 2) as total_redemptions_cr,
                ROUND(SUM(total_net_added_cr), 2) as total_net_added_cr,
                ROUND(SUM(total_sip_cr), 2) as total_sip_cr,
                ROUND(SUM(total_stp_cr), 2) as total_stp_cr,
                SUM(total_sip_count) as total_sip_count,
                ROUND(CASE WHEN SUM(total_sip_count) > 0 THEN (SUM(total_sip_cr)*10000000.0)/SUM(total_sip_count) ELSE 0 END, 2) as avg_sip_ticket_inr,
                SUM(active_mfds) as active_mfds,
                ROUND(CASE WHEN SUM(total_gross_cr) > 0 THEN (SUM(total_net_added_cr) / SUM(total_gross_cr))*100.0 ELSE 0 END, 2) as retention_pct
            FROM pincode_monthly_summary
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
                SUM(active_mfds) as active_mfds
            FROM pincode_scheme_monthly
            WHERE month = ? AND state = ?
            GROUP BY scheme_type, asset_class
            ORDER BY gross_inflows_cr DESC
            LIMIT 30
        """, (month, state))
        schemes = [dict(r) for r in cur.fetchall()]

        return {
            "month": month,
            "state": state,
            "summary": dict(sum_row) if sum_row else {},
            "schemes": schemes,
            "monthly_trends": get_trailing_3m_summary('state', state=state),
            "scheme_rotation": get_scheme_rotation_3m('state', state=state)
        }

def get_district_details(month: str, district: str, state: Optional[str] = None) -> Dict[str, Any]:
    with get_db_connection() as conn:
        cur = conn.cursor()
        query = "SELECT * FROM district_monthly_summary WHERE month = ? AND district = ?"
        args = [month, district]
        if state:
            query += " AND state = ?"
            args.append(state)

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
                SUM(active_mfds) as active_mfds
            FROM pincode_scheme_monthly
            WHERE month = ? AND district = ?
            GROUP BY scheme_type, asset_class
            ORDER BY gross_inflows_cr DESC
            LIMIT 30
        """, (month, district))
        schemes = [dict(r) for r in cur.fetchall()]

        return {
            "month": month,
            "district": district,
            "state": state or "",
            "summary": dict(dist_row) if dist_row else {},
            "schemes": schemes,
            "monthly_trends": get_trailing_3m_summary('district', state=state, district=district),
            "scheme_rotation": get_scheme_rotation_3m('district', state=state, district=district)
        }

def get_map_summary(month: str, state: Optional[str] = None, district: Optional[str] = None) -> Dict[str, Any]:
    query = """
        SELECT 
            pincode, lat, lon, city, district, state,
            total_aum_cr, total_gross_cr, total_redemptions_cr,
            total_net_added_cr, total_sip_cr, total_sip_count,
            avg_sip_ticket_inr, active_mfds, retention_pct
        FROM pincode_monthly_summary
        WHERE month = ? AND lat != 0.0 AND lon != 0.0
    """
    args = [month]
    if state:
        query += " AND state = ?"
        args.append(state)
    if district:
        query += " AND district = ?"
        args.append(district)

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
        cur.execute("SELECT * FROM pincode_monthly_summary WHERE month = ? AND pincode = ?", (month, pincode))
        summary_row = cur.fetchone()
        summary = dict(summary_row) if summary_row else None

        cur.execute("""
            SELECT 
                scheme_type, asset_class, closing_aum_cr, gross_inflows_cr,
                redemptions_cr, net_added_cr, active_sip_cr, active_stp_cr, active_sip_count,
                avg_sip_ticket_inr, active_mfds, retention_pct
            FROM pincode_scheme_monthly
            WHERE month = ? AND pincode = ?
            ORDER BY gross_inflows_cr DESC
        """, (month, pincode))
        schemes = [dict(r) for r in cur.fetchall()]

        cur.execute("""
            SELECT 
                month, total_aum_cr, total_gross_cr, total_redemptions_cr,
                total_net_added_cr, total_sip_cr, total_stp_cr, total_sip_count, active_mfds
            FROM pincode_monthly_summary
            WHERE pincode = ?
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

ALL_12_MONTHS_ORDERED = [
    'Jul-25', 'Aug-25', 'Sep-25', 'Oct-25', 'Nov-25', 'Dec-25',
    'Jan-26', 'Feb-26', 'Mar-26', 'Apr-26', 'May-26', 'Jun-26'
]

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
                    nat_aum as aum_cr,
                    nat_gross as gross_cr,
                    nat_outflow as outflow_cr,
                    nat_net as net_cr,
                    nat_sip as sip_cr,
                    nat_stp as stp_cr,
                    nat_sip_cnt as sip_count,
                    avg_sip_ticket as avg_sip_ticket_inr,
                    nat_mfds_footprint as active_mfds,
                    retention_pct
                FROM national_monthly_summary
                WHERE month IN ({placeholders})
            """, tuple(months))
            ent_title = "All India Universe"
            ent_subtitle = "Verified Independent MFD & RIA Telemetry"
        elif level == 'state':
            cur.execute(f"""
                SELECT 
                    month,
                    total_aum_cr as aum_cr,
                    total_gross_cr as gross_cr,
                    total_redemptions_cr as outflow_cr,
                    total_net_added_cr as net_cr,
                    total_sip_cr as sip_cr,
                    total_stp_cr as stp_cr,
                    total_sip_count as sip_count,
                    avg_sip_ticket_inr,
                    active_mfds,
                    retention_pct
                FROM state_monthly_summary
                WHERE state = ? AND month IN ({placeholders})
            """, (state, *months))
            ent_title = state or "State Tier"
            ent_subtitle = "State-Level Macro Capital Telemetry"
        elif level == 'district':
            query = f"""
                SELECT 
                    month,
                    ROUND(total_aum_cr, 2) as aum_cr,
                    ROUND(total_gross_cr, 2) as gross_cr,
                    ROUND(total_redemptions_cr, 2) as outflow_cr,
                    ROUND(total_net_added_cr, 2) as net_cr,
                    ROUND(total_sip_cr, 2) as sip_cr,
                    ROUND(total_stp_cr, 2) as stp_cr,
                    total_sip_count as sip_count,
                    avg_sip_ticket_inr,
                    total_mfds_footprint as active_mfds,
                    retention_pct
                FROM district_monthly_summary
                WHERE district = ? AND month IN ({placeholders})
            """
            args = [district] + months
            if state:
                query += " AND state = ?"
                args.append(state)
            cur.execute(query, tuple(args))
            ent_title = f"{district} District"
            ent_subtitle = f"District in {state or ''}"
        elif level == 'pincode':
            cur.execute(f"""
                SELECT 
                    month,
                    ROUND(total_aum_cr, 2) as aum_cr,
                    ROUND(total_gross_cr, 2) as gross_cr,
                    ROUND(total_redemptions_cr, 2) as outflow_cr,
                    ROUND(total_net_added_cr, 2) as net_cr,
                    ROUND(total_sip_cr, 2) as sip_cr,
                    ROUND(total_stp_cr, 2) as stp_cr,
                    total_sip_count as sip_count,
                    avg_sip_ticket_inr,
                    active_mfds,
                    retention_pct
                FROM pincode_monthly_summary
                WHERE pincode = ? AND month IN ({placeholders})
            """, (pincode, *months))
            ent_title = f"PIN {pincode}"
            ent_subtitle = "Micro-Market Postal Territory"

        raw_rows = {r['month']: dict(r) for r in cur.fetchall()}

        # Order chronologically according to `months`
        ordered_waterfall = []
        for m in months:
            if m in raw_rows:
                row = raw_rows[m]
            else:
                row = {
                    'month': m, 'aum_cr': 0, 'gross_cr': 0, 'outflow_cr': 0,
                    'net_cr': 0, 'sip_cr': 0, 'stp_cr': 0, 'sip_count': 0,
                    'avg_sip_ticket_inr': 0, 'active_mfds': 0, 'retention_pct': 0
                }
            gross = row.get('gross_cr') or 0
            sip = row.get('sip_cr') or 0
            stp = row.get('stp_cr') or 0
            lump = round(max(0.0, gross - sip - stp), 2)
            row['lumpsum_cr'] = lump
            
            tot_flow = max(0.001, gross)
            row['lump_pct'] = round((lump / tot_flow) * 100, 1)
            row['sip_pct'] = round((sip / tot_flow) * 100, 1)
            row['stp_pct'] = round((stp / tot_flow) * 100, 1)
            ordered_waterfall.append(row)

        # 2. Scheme breakdown for product rotation
        if level == 'national':
            cur.execute(f"""
                SELECT 
                    scheme_type, asset_class, month,
                    gross_inflows_cr as gross,
                    redemptions_cr as outflow,
                    net_added_cr as net,
                    active_sip_cr as sip,
                    closing_aum_cr as aum
                FROM national_scheme_monthly
                WHERE month IN ({placeholders})
            """, tuple(months))
        elif level == 'state':
            cur.execute(f"""
                SELECT 
                    scheme_type, asset_class, month,
                    gross_inflows_cr as gross,
                    redemptions_cr as outflow,
                    net_added_cr as net,
                    active_sip_cr as sip,
                    closing_aum_cr as aum
                FROM state_scheme_monthly
                WHERE state = ? AND month IN ({placeholders})
            """, (state, *months))
        elif level == 'district':
            query = f"""
                SELECT 
                    scheme_type, asset_class, month,
                    ROUND(SUM(gross_inflows_cr), 2) as gross,
                    ROUND(SUM(redemptions_cr), 2) as outflow,
                    ROUND(SUM(net_added_cr), 2) as net,
                    ROUND(SUM(active_sip_cr), 2) as sip,
                    ROUND(SUM(closing_aum_cr), 2) as aum
                FROM pincode_scheme_monthly
                WHERE district = ? AND month IN ({placeholders})
            """
            args = [district] + months
            if state:
                query += " AND state = ?"
                args.append(state)
            query += " GROUP BY scheme_type, asset_class, month"
            cur.execute(query, tuple(args))
        elif level == 'pincode':
            cur.execute(f"""
                SELECT 
                    scheme_type, asset_class, month,
                    ROUND(gross_inflows_cr, 2) as gross,
                    ROUND(redemptions_cr, 2) as outflow,
                    ROUND(net_added_cr, 2) as net,
                    ROUND(active_sip_cr, 2) as sip,
                    ROUND(closing_aum_cr, 2) as aum
                FROM pincode_scheme_monthly
                WHERE pincode = ? AND month IN ({placeholders})
            """, (pincode, *months))

        scheme_rows = cur.fetchall()
        by_scheme: Dict[str, Dict[str, Any]] = {}
        for r in scheme_rows:
            st = r['scheme_type']
            if st not in by_scheme:
                by_scheme[st] = {
                    'scheme_type': st,
                    'asset_class': r['asset_class'] or 'Other',
                    'monthly_net': {m: 0.0 for m in months},
                    'monthly_gross': {m: 0.0 for m in months},
                    'monthly_sip': {m: 0.0 for m in months},
                    'monthly_aum': {m: 0.0 for m in months},
                    'total_gross': 0.0,
                    'total_net': 0.0,
                    'total_sip': 0.0
                }
            m = r['month']
            if m in by_scheme[st]['monthly_net']:
                by_scheme[st]['monthly_net'][m] = r['net'] or 0.0
                by_scheme[st]['monthly_gross'][m] = r['gross'] or 0.0
                by_scheme[st]['monthly_sip'][m] = r['sip'] or 0.0
                by_scheme[st]['monthly_aum'][m] = r['aum'] or 0.0
                by_scheme[st]['total_gross'] += (r['gross'] or 0.0)
                by_scheme[st]['total_net'] += (r['net'] or 0.0)
                by_scheme[st]['total_sip'] += (r['sip'] or 0.0)

        # Sort schemes by total gross or latest month gross
        latest_m = months[-1]
        first_m = months[0]
        sorted_schemes = sorted(
            by_scheme.values(),
            key=lambda s: s['total_gross'],
            reverse=True
        )

        for s in sorted_schemes:
            end_n = s['monthly_net'].get(latest_m, 0.0)
            start_n = s['monthly_net'].get(first_m, 0.0)
            end_g = s['monthly_gross'].get(latest_m, 0.0)
            start_g = s['monthly_gross'].get(first_m, 0.0)
            ac = (s['asset_class'] or '').upper()

            if end_n < 0 and (start_n > 50 or s['total_gross'] > 1000):
                s['momentum'] = 'Tax Drain'
                s['momentum_class'] = 'drain'
            elif (s['total_net'] > 0 and 'EQUITY' in ac) or (s['monthly_sip'].get(latest_m, 0) > s['monthly_sip'].get(first_m, 0)):
                s['momentum'] = 'Sticky SIP'
                s['momentum_class'] = 'sticky'
            elif 'HYBRID' in ac and s['total_net'] > 0:
                s['momentum'] = 'Defensive'
                s['momentum_class'] = 'defensive'
            elif end_g > start_g * 1.15:
                s['momentum'] = 'Surging'
                s['momentum_class'] = 'surging'
            else:
                s['momentum'] = 'Steady Flow'
                s['momentum_class'] = 'neutral'

            s['total_gross'] = round(s['total_gross'], 2)
            s['total_net'] = round(s['total_net'], 2)
            s['total_sip'] = round(s['total_sip'], 2)
            s['latest_aum'] = round(s['monthly_aum'].get(latest_m, 0.0), 2)
            s['latest_sip'] = round(s['monthly_sip'].get(latest_m, 0.0), 2)
            s['retention_pct'] = round((s['total_net'] / s['total_gross'] * 100.0), 1) if s['total_gross'] > 0 else 0.0

        # Period Totals
        tot_gross = round(sum(r['gross_cr'] for r in ordered_waterfall), 2)
        tot_outflow = round(sum(r['outflow_cr'] for r in ordered_waterfall), 2)
        tot_net = round(sum(r['net_cr'] for r in ordered_waterfall), 2)
        ret_pct = round((tot_net / tot_gross * 100.0), 1) if tot_gross > 0 else 0.0

        latest_rec = ordered_waterfall[-1] if ordered_waterfall else {}

        res = {
            "horizon": horizon,
            "months": months,
            "entity": {
                "level": level,
                "title": ent_title,
                "subtitle": ent_subtitle
            },
            "summary": {
                "total_gross_cr": tot_gross,
                "total_outflow_cr": tot_outflow,
                "total_net_cr": tot_net,
                "overall_retention_pct": ret_pct,
                "latest_aum_cr": latest_rec.get('aum_cr', 0),
                "latest_sip_cr": latest_rec.get('sip_cr', 0),
                "latest_mfds": latest_rec.get('active_mfds', 0)
            },
            "waterfall": ordered_waterfall,
            "product_rotation": sorted_schemes[:30]
        }

        _trends_cache[cache_key] = res
        return res
