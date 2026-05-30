#!/usr/bin/env bash
# AXIOM End-to-End Integration Test Runner
# Tests all 7 layers across Rust, Python, and Go components.
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
declare -a FAILURES=()

pass() { echo -e "  [${GREEN}PASS${NC}] $1"; ((PASS_COUNT++)); }
fail() { echo -e "  [${RED}FAIL${NC}] $1"; ((FAIL_COUNT++)); FAILURES+=("$1"); }
section() { echo -e "\n${BOLD}═══ $1 ═══${NC}"; }

# ──────────────────────────────────────────────────────────────────────────────
section "AXIOM E2E Test Suite — 7 Layers, 19 Inventions"
echo "  Date: $(date)"
echo "  Rust: $(rustc --version 2>/dev/null || echo 'not found')"
echo "  Python: $(python3 --version 2>/dev/null || echo 'not found')"
echo "  Go: $(go version 2>/dev/null || echo 'not found')"

# ──────────────────────────────────────────────────────────────────────────────
section "L0-L5 · Rust Integration Test (axiom-core + axiom-integration)"

echo "  Building axiom-integration binary..."
if cargo build --bin axiom-integration 2>&1; then
    pass "axiom-integration binary builds successfully"
else
    fail "axiom-integration binary failed to build"
fi

if cargo build --bin axiom-integration 2>/dev/null; then
    echo "  Running Rust integration tests..."
    if cargo run --bin axiom-integration 2>&1; then
        pass "Rust integration test: all layers passed"
    else
        fail "Rust integration test: one or more layers failed"
    fi
fi

# ──────────────────────────────────────────────────────────────────────────────
section "axiom-core · Rust Unit Tests"

echo "  Running axiom-core unit tests..."
if cargo test --package axiom-core 2>&1 | tail -5; then
    pass "axiom-core unit tests pass"
else
    fail "axiom-core unit tests failed"
fi

# ──────────────────────────────────────────────────────────────────────────────
section "L4 · Python Coherence Engine Tests"

echo "  Installing Python dependencies..."
pip install numpy structlog flask -q 2>&1 | tail -2

echo "  Running Python coherence tests..."
if python3 axiom-coherence/tests/test_coherence.py 2>&1; then
    pass "Python coherence engine tests pass"
else
    fail "Python coherence engine tests failed"
fi

# ──────────────────────────────────────────────────────────────────────────────
section "L4 · Python Coherence HTTP API"

echo "  Starting coherence HTTP server on port 5001..."
COHERENCE_PORT=5001 python3 axiom-coherence/server.py &
SERVER_PID=$!
sleep 2

if kill -0 $SERVER_PID 2>/dev/null; then
    # Test health endpoint
    HEALTH=$(curl -sf http://localhost:5001/health 2>/dev/null || echo "")
    if echo "$HEALTH" | grep -q "healthy"; then
        pass "Coherence HTTP server health check"
    else
        fail "Coherence HTTP server health check — server didn't respond"
    fi

    # Test event submission
    EVENT_RESP=$(curl -sf -X POST http://localhost:5001/events \
        -H "Content-Type: application/json" \
        -d '{
            "entity_bpi": "aabbccdd00112233445566778899aabbccddeeff00112233445566778899aabb",
            "event_type": 1,
            "bc_at_event": 0.85,
            "depth_at_event": 100.0,
            "gps_timestamp": 1735689600000000000
        }' 2>/dev/null || echo "")
    if echo "$EVENT_RESP" | grep -q '"status"'; then
        pass "Coherence HTTP POST /events processes event"
    else
        fail "Coherence HTTP POST /events failed"
    fi

    # Test BC computation
    BC_RESP=$(curl -sf "http://localhost:5001/bc?phi=0.8&mu=0.9&sigma=0.7&kappa=0.8&alpha=0.6" 2>/dev/null || echo "")
    if echo "$BC_RESP" | grep -q '"bc"'; then
        pass "Coherence HTTP GET /bc computes BC score"
    else
        fail "Coherence HTTP GET /bc failed"
    fi

    kill $SERVER_PID 2>/dev/null || true
else
    fail "Coherence HTTP server failed to start"
fi

# ──────────────────────────────────────────────────────────────────────────────
section "L6 · Go RCP Daemon Tests"

echo "  Running Go RCP tests..."
if (cd axiom-rcp && go test ./rcp/... -timeout 30s -v 2>&1 | tail -15); then
    pass "Go RCP daemon unit tests pass"
else
    fail "Go RCP daemon unit tests failed"
fi

# ──────────────────────────────────────────────────────────────────────────────
section "Summary"

echo ""
echo -e "  ${BOLD}Total:${NC}  $((PASS_COUNT + FAIL_COUNT)) checks"
echo -e "  ${GREEN}Passed:${NC} $PASS_COUNT"
if [ $FAIL_COUNT -gt 0 ]; then
    echo -e "  ${RED}Failed:${NC} $FAIL_COUNT"
    echo ""
    echo "  Failed tests:"
    for f in "${FAILURES[@]}"; do
        echo -e "    ${RED}✗${NC} $f"
    done
    exit 1
else
    echo -e "  ${GREEN}Failed: 0${NC}"
    echo ""
    echo -e "  ${BOLD}✓ All AXIOM layers operational${NC}"
    exit 0
fi
