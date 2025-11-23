#!/bin/bash

# Exit on error
set -e

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/.."

cd "$PROJECT_ROOT"

echo "=== Preparing Test Environment ==="

# Check for mise
if command -v mise &> /dev/null; then
    echo "Using mise to set up Python version..."
    mise install
else
    echo "Warning: mise not found. Using system python."
fi

# Create venv if missing (specifically for testing to avoid messing with main project deps if they differ)
if [ ! -d "tests/.venv" ]; then
    echo "Creating virtual environment in tests/.venv..."
    python3 -m venv tests/.venv
fi

echo "Activating virtual environment..."
source tests/.venv/bin/activate

echo "Installing test dependencies..."
pip install websockets requests

echo ""
echo "=== Running Test ==="
python tests/test_sherpa.py

echo ""
echo "=== Test Complete ==="
