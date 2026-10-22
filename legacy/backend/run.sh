#!/bin/bash

# Navigate to the script's directory
cd "$(dirname "$0")"

# Activate virtual environment
if [ -d ".venv" ]; then
    source .venv/bin/activate
elif [ -d "venv" ]; then
    source venv/bin/activate
else
    echo "Virtual environment not found! Please run: python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

# Start the server
# --host 0.0.0.0 makes it accessible from outside (e.g. Nginx)
# --port 8000 is the internal port
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
