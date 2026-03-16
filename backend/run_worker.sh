#!/bin/bash

cd "$(dirname "$0")"

if [ -d "venv" ]; then
    source venv/bin/activate
else
    echo "Virtual environment not found! Please run: python3 -m venv venv && pip install -r requirements.txt"
    exit 1
fi

exec python run_worker.py
