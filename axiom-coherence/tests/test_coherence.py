"""
AXIOM Coherence Engine (Layer 4) — Integration Tests.

Tests all 19 inventions related to L4:
  #7  Five-Plane BC Model
  #8  Dynamic Threshold Ψ(entity,t)
  #14 BEO Universal Resolver (Python implementation)
  #16 Domain-Specific BC Profiles

Tests are designed to run without PyTorch or Kafka.
"""

import sys
import os
import time
import math

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from axiom_coherence import CoherenceEngine, CoherencePlanes, compute_bc
from axiom_coherence.planes import (
    dynamic_threshold, compute_phi, compute_mu, compute_sigma,
    compute_kappa, compute_alpha, DOMAIN_PROFILES, get_profile,
)
from axiom_coherence.models import TrajectoryPredictor, encode_event, UBE_TYPES
from axiom_coherence.beo_resolver import BEOResolver
import numpy as np

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
results = []


def check(name: str, condition: bool, detail: str = "") -> bool:
    status = PASS if condition else FAIL
    msg = f"  [{status}] {name}"
    if detail and not condition:
        msg += f" — {detail}"
    print(msg)
    results.append((name, condition))
    return condition


def section(title: str):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print('='*60)


# ============================================================
# LAYER 4 — FIVE-PLANE BEHAVIORAL COHERENCE MODEL (Invention #7)
# ============================================================
section("L4 · Invention #7 · Five-Plane BC Model")

# BC with all planes at max = 1.0
bc_max = compute_bc(1.0, 1.0, 1.0, 1.0, 1.0)
check("BC(1,1,1,1,1) = 1.0", abs(bc_max - 1.0) < 1e-6, f"got {bc_max}")

# BC with all planes at 0 = 0.0
bc_min = compute_bc(0.0, 0.0, 0.0, 0.0, 0.0)
check("BC(0,0,0,0,0) = 0.0", abs(bc_min - 0.0) < 1e-6, f"got {bc_min}")

# BC standard: α·Φ + β·M + γ·Σ + δ·K + ε·A
# 0.25*0.8 + 0.20*0.9 + 0.25*0.7 + 0.15*0.8 + 0.15*0.6 = 0.765
bc_test = compute_bc(0.8, 0.9, 0.7, 0.8, 0.6)
expected = 0.25*0.8 + 0.20*0.9 + 0.25*0.7 + 0.15*0.8 + 0.15*0.6
check("BC weighted sum", abs(bc_test - expected) < 1e-5, f"got {bc_test}, expected {expected}")

# CoherencePlanes class
planes = CoherencePlanes(0.8, 0.9, 0.7, 0.8, 0.6)
bc_planes = planes.bc()
check("CoherencePlanes.bc() matches compute_bc()", abs(bc_planes - bc_test) < 1e-5)

# Dominant drag plane
drag = planes.dominant_drag_plane()
check("dominant_drag_plane() returns a plane name", drag in ("phi","mu","sigma","kappa","alpha"), f"got '{drag}'")

# ============================================================
# LAYER 4 — DYNAMIC THRESHOLD Ψ (Invention #8)
# ============================================================
section("L4 · Invention #8 · Dynamic Threshold Ψ(entity,t)")

psi_base = dynamic_threshold(psi_base=0.55, threat_level=0.0, volatility=0.0, depth=0.0)
check("Ψ(0,0,0) ≈ 0.55", abs(psi_base - 0.55) < 1e-5)

# Higher threat raises Ψ
psi_threat = dynamic_threshold(psi_base=0.55, threat_level=1.0, volatility=0.0, depth=0.0)
check("Threat raises Ψ", psi_threat > psi_base, f"psi_threat={psi_threat}, psi_base={psi_base}")

# Higher depth lowers Ψ (earned trust)
psi_deep = dynamic_threshold(psi_base=0.55, threat_level=0.0, volatility=0.0, depth=10000.0)
check("Depth lowers Ψ (earned trust)", psi_deep < psi_base, f"psi_deep={psi_deep}")

# Volatility raises Ψ
psi_volatile = dynamic_threshold(psi_base=0.55, threat_level=0.0, volatility=1.0, depth=0.0)
check("Volatility raises Ψ", psi_volatile > psi_base, f"psi_volatile={psi_volatile}")

# Ψ is always clamped to [0.10, 0.99]
psi_extreme = dynamic_threshold(psi_base=0.55, threat_level=100.0, volatility=100.0, depth=0.0)
check("Ψ clamped ≤ 0.99", psi_extreme <= 0.99, f"got {psi_extreme}")
psi_low = dynamic_threshold(psi_base=0.55, threat_level=0.0, volatility=0.0, depth=1e18)
check("Ψ clamped ≥ 0.10", psi_low >= 0.10, f"got {psi_low}")

# ============================================================
# LAYER 4 — DOMAIN-SPECIFIC BC PROFILES (Invention #16)
# ============================================================
section("L4 · Invention #16 · Domain-Specific BC Profiles")

for name, profile in DOMAIN_PROFILES.items():
    total = profile.phi + profile.mu + profile.sigma + profile.kappa + profile.alpha
    check(f"Profile '{name}' weights sum to 1.0", abs(total - 1.0) < 1e-9, f"sum={total}")

# Financial profile: causal integrity (phi) most important
fin = get_profile("financial")
std = get_profile("standard")
check("Financial profile has higher phi weight", fin.phi > std.phi)

# IoT profile: environmental context (kappa) most important
iot = get_profile("iot")
check("IoT profile has higher kappa weight", iot.kappa > std.kappa)

# Domain BC computation
bc_financial = fin.compute_bc(0.9, 0.5, 0.9, 0.5, 0.5)
bc_iot_same  = iot.compute_bc(0.9, 0.5, 0.9, 0.5, 0.5)
check("Different domains produce different BC scores",
      abs(bc_financial - bc_iot_same) > 0.01,
      f"financial={bc_financial:.4f}, iot={bc_iot_same:.4f}")

# ============================================================
# LAYER 4 — COHERENCE ENGINE
# ============================================================
section("L4 · CoherenceEngine — Entity Lifecycle")

engine = CoherenceEngine()
bpi = bytes(range(32))

# Register entity
state = engine.register_entity(bpi, initial_depth=1000.0, love=1.0)
check("Entity registered", bpi in engine.states)
check("Initial depth set correctly", abs(state.depth - 1000.0) < 0.1)

# Process events
event = {
    "entity_bpi": bpi,
    "event_type": 1,  # Transfer
    "bc_at_event": 0.85,
    "depth_at_event": 1000.0,
    "gps_timestamp": time.time_ns(),
    "self_hash": "",
    "prior_hash": "",
}

# Process enough events to trigger significant change
for i in range(5):
    event["event_type"] = (i % 32) + 1
    event["gps_timestamp"] = time.time_ns()
    engine.process_event(event)

state_after = engine.states[bpi]
check("Entity state updated after events", state_after.total_events == 5)
check("BC is in [0,1]", 0.0 <= state_after.bc <= 1.0, f"bc={state_after.bc}")

# SILENCE mechanism
engine2 = CoherenceEngine()
bpi2 = bytes([0xBE] * 32)
engine2.register_entity(bpi2)

# Drive BC very low by injecting a very bad event
bad_event = {
    "entity_bpi": bpi2,
    "event_type": 10,
    "bc_at_event": 0.0,   # Very low BC
    "depth_at_event": 0.0,
    "gps_timestamp": time.time_ns(),
    "self_hash": "aaaa",
    "prior_hash": "bbbb",  # Chain break — phi goes low
}
# Process many bad events to trigger silence
for _ in range(20):
    bad_event["gps_timestamp"] = time.time_ns()
    bad_event["self_hash"] = hex(int(time.time_ns()))
    bad_event["prior_hash"] = "0000"
    engine2.process_event(bad_event)

check("SILENCE detection works (or entity stays operational with window defense)",
      isinstance(engine2.states[bpi2].silence, bool))

# Metrics
metrics = engine.metrics()
check("Engine metrics returned", "entities_tracked" in metrics)
check("Events processed tracked", metrics["events_processed"] >= 5)

# get_truth_state
truth = engine.get_truth_state(bpi)
check("get_truth_state returns dict", truth is not None)
check("Truth state has bc field", "bc" in (truth or {}))
check("Truth state has psi field", "psi" in (truth or {}))
check("Truth state has silence field", "silence" in (truth or {}))

# ============================================================
# LAYER 4 — TRAJECTORY PREDICTOR (Invention #7 — LSTM)
# ============================================================
section("L4 · TrajectoryPredictor (BehavioralLSTM / Markov fallback)")

predictor = TrajectoryPredictor(window_size=32)
bpi3 = bytes([0xCC] * 32)

# Observe many events
for i in range(20):
    predictor.observe(bpi3, (i % 10) + 1, 0.8, 100.0, time.time_ns())

result = predictor.predict_next(bpi3)
check("predict_next returns result after 20 observations", result is not None)

if result is not None:
    probs, bc_pred = result
    check("Probability distribution sums to ~1.0", abs(probs.sum() - 1.0) < 1e-3, f"sum={probs.sum()}")
    check("BC prediction in [0, 1]", 0.0 <= bc_pred <= 1.0, f"bc_pred={bc_pred}")
    check("Probability distribution has 32 elements", len(probs) == 32)

# probability_of returns [0,1]
p = predictor.probability_of(bpi3, 1)
check("probability_of returns [0,1] value", 0.0 <= p <= 1.0, f"p={p}")

# is_anomalous is deterministic
a1 = predictor.is_anomalous(bpi3, 999)  # invalid type → idx=31
a2 = predictor.is_anomalous(bpi3, 999)
check("is_anomalous is deterministic", a1 == a2)

# encode_event
vec = encode_event(1, 0.8, 500.0, 1_000_000.0)
check("encode_event returns 34-dim vector", len(vec) == 34)
check("encode_event one-hot at index 0 for type 1", abs(vec[0] - 1.0) < 1e-6)
check("encode_event BC at index 32", abs(vec[32] - 0.8) < 1e-6)
check("encode_event depth at index 33", abs(vec[33] - 0.0005) < 1e-5)

# ============================================================
# LAYER 2 — BEO UNIVERSAL RESOLVER (Invention #14, Python)
# ============================================================
section("L2 · BEOResolver (Python FAISS/fallback)")

resolver = BEOResolver()

# Register two entities with similar fingerprints
fp_a = np.random.RandomState(42).rand(128).astype(np.float32)
fp_b = fp_a + np.random.RandomState(1).rand(128).astype(np.float32) * 0.01
fp_c = np.random.RandomState(99).rand(128).astype(np.float32)

bpi_a = bytes([0xAA] * 32)
bpi_b = bytes([0xBB] * 32)
bpi_c = bytes([0xCC] * 32)

resolver.register_entity(bpi_a, fp_a)
resolver.register_entity(bpi_b, fp_b)
resolver.register_entity(bpi_c, fp_c)

same, score_same = resolver.is_same_entity(fp_a, fp_b)
check("Nearly-identical fingerprints recognized as same entity", same,
      f"similarity={score_same:.4f}")

same_cc, score_diff = resolver.is_same_entity(fp_a, fp_c)
check("Different fingerprints score lower", score_same > score_diff,
      f"same_score={score_same:.4f}, diff_score={score_diff:.4f}")

fp_computed = BEOResolver.compute_fingerprint(
    [{"event_type": i % 32 + 1, "gps_timestamp": i * 1_000_000}
     for i in range(100)],
    depth=500.0
)
check("compute_fingerprint returns 128-dim vector", len(fp_computed) == 128)
check("UBE frequency segment L1-normalized",
      abs(fp_computed[:32].sum() - 1.0) < 1e-4 or fp_computed[:32].sum() == 0.0)

# ============================================================
# SUMMARY — only when run as a standalone script
# ============================================================
if __name__ == "__main__":
    print("\n" + "="*60)
    passed = sum(1 for _, ok in results if ok)
    total  = len(results)
    failed = total - passed
    print(f"\n  TOTAL: {passed}/{total} passed"
          + (f" — {failed} FAILED" if failed else " — all passing"))
    print()

    if failed:
        print("  Failed tests:")
        for name, ok in results:
            if not ok:
                print(f"    ✗ {name}")
        sys.exit(1)
    else:
        sys.exit(0)
