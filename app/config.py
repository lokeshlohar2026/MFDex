import os
from pathlib import Path

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = Path(__file__).resolve().parent / "static"

# Server configuration
PORT = int(os.environ.get("PORT", 8080))
HOST = os.environ.get("HOST", "")

# Data paths
SQLITE_DB = str(BASE_DIR / "mfdex_pincode_market_cube.sqlite")
STATE_GEOJSON = str(BASE_DIR / "india_states_simplified.geojson")
DISTRICT_GEOJSON = str(BASE_DIR / "india_districts_simplified.geojson")

# Google Maps API Key
ENV_FILE = BASE_DIR / ".env"
GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")
if not GOOGLE_MAPS_API_KEY and ENV_FILE.exists():
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("GOOGLE_MAPS_API_KEY="):
            GOOGLE_MAPS_API_KEY = line.split("=", 1)[1].strip().strip('"').strip("'")

