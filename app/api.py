import http.server
import json
import os
import urllib.parse
from app.config import STATIC_DIR
from app.services import (
    get_available_months,
    get_national_summary,
    get_state_summaries,
    get_state_details,
    get_district_details,
    get_map_summary,
    get_pincode_details,
    get_multi_period_analytics,
    get_states_geojson,
    get_districts_geojson,
)

class MarketRadarHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)

        # 1. API: List available months
        if path == "/api/months":
            self.send_json_response(get_available_months())
            return

        # 2. API: National aggregated summary
        if path == "/api/national_summary":
            month = params.get("month", ["Jun-26"])[0]
            self.send_json_response(get_national_summary(month))
            return

        # 3. API: State summaries
        if path == "/api/state_summary":
            month = params.get("month", ["Jun-26"])[0]
            self.send_json_response(get_state_summaries(month))
            return

        # 4. API: State detailed breakdown
        if path == "/api/state_details":
            month = params.get("month", ["Jun-26"])[0]
            state = params.get("state", [""])[0]
            self.send_json_response(get_state_details(month, state))
            return

        # 5. API: District detailed breakdown
        if path == "/api/district_details":
            month = params.get("month", ["Jun-26"])[0]
            district = params.get("district", [""])[0]
            state = params.get("state", [""])[0]
            self.send_json_response(get_district_details(month, district, state))
            return

        # 6. API: Map summary blips
        if path == "/api/map_summary":
            month = params.get("month", ["Jun-26"])[0]
            state = params.get("state", [""])[0]
            district = params.get("district", [""])[0]
            self.send_json_response(get_map_summary(month, state, district))
            return

        # 7. API: Granular pincode scheme breakdown
        if path == "/api/pincode_details":
            month = params.get("month", ["Jun-26"])[0]
            pincode = params.get("pincode", [""])[0]
            if not pincode:
                self.send_json_response({"error": "Missing pincode parameter"}, status=400)
                return
            self.send_json_response(get_pincode_details(month, pincode))
            return

        # 8. API: Multi-Period Trajectory Cockpit (3M, 6M, 1Y)
        if path == "/api/multi_period_analytics":
            horizon = params.get("horizon", ["3M"])[0]
            level = params.get("level", ["national"])[0]
            state = params.get("state", [""])[0]
            district = params.get("district", [""])[0]
            pincode = params.get("pincode", [""])[0]
            self.send_json_response(get_multi_period_analytics(horizon, level, state, district, pincode))
            return

        # 9. API: Static GeoJSON
        if path == "/api/geojson/states":
            self.send_bytes_response(get_states_geojson(), "application/json")
            return

        if path == "/api/geojson/districts":
            self.send_bytes_response(get_districts_geojson(), "application/json")
            return

        # 9. Frontend Root: Serve index.html
        if path in ("/", "/index.html"):
            index_file = STATIC_DIR / "index.html"
            if index_file.exists():
                with open(index_file, "rb") as f:
                    self.send_bytes_response(f.read(), "text/html; charset=utf-8")
                return

        # Fallback to serving static files from STATIC_DIR
        super().do_GET()

    def send_json_response(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def send_bytes_response(self, body, content_type, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)
