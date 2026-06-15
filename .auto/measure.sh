#!/bin/bash
set -euo pipefail
cd /Users/mitchellbernstein/Documents/GitHub/pi-fusion
npx tsc --noEmit 2>/dev/null || { echo "COMPILE FAILED"; exit 1; }
npx tsx benchmark-fast.ts 2>&1 | grep "METRIC"
