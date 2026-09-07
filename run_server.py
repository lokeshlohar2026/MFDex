"""
=============================================================================
 PRODUCTION INDIA MFD MICRO-MARKET RADAR RUNNER
=============================================================================
"""
import sys
import socketserver
from app.config import PORT, HOST, SQLITE_DB
from app.api import MarketRadarHandler
from app.services import load_geojson_cache

sys.stdout.reconfigure(encoding="utf-8")

def main():
    print("Pre-loading GeoJSON boundary files into memory...", flush=True)
    load_geojson_cache()
    print("GeoJSON cache loaded successfully.", flush=True)

    with socketserver.ThreadingTCPServer((HOST, PORT), MarketRadarHandler) as httpd:
        print("\n=================================================================", flush=True)
        print(f"  PRODUCTION PINCODE RADAR SERVER LIVE AT: http://localhost:{PORT}", flush=True)
        print(f"  Target SQLite: {SQLITE_DB}", flush=True)
        print("=================================================================\n", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped cleanly.", flush=True)

if __name__ == "__main__":
    main()
