"""
Backward-compatibility wrapper for serve_dashboard.py.
Delegates to the modular run_server.py.
"""
from run_server import main

if __name__ == "__main__":
    main()
