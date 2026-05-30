"""
Tests for the AXIOM Coherence Engine — L4 five-plane BC model.
Run with:  pytest axiom-coherence/tests/ -v
"""
import sys
import os
import math

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from axiom_coherence.planes import (
    CoherencePlanes,
    compute_bc,
    compute_phi,
    compute_mu,
    compute_sigma,
    compute_kappa,
    compute_alpha,
    dynamic_threshold,
    ALPHA, BETA, GAMMA, DELTA, EPSILON,
)


# ---------------------------------------------------------------------------
# Weight sanity
# ---------------------------------------------------------------------------

class TestWeights:
    def test_weights_sum_to_one(self):
        total = ALPHA + BETA + GAMMA + DELTA + EPSILON
        assert abs(total - 1.0) < 1e-9, f"weights sum to {total}, not 1.0"

    def test_all_weights_positive(self):
        for name, w in [("ALPHA", ALPHA), ("BETA", BETA), ("GAMMA", GAMMA),
                        ("DELTA", DELTA), ("EPSILON", EPSILON)]:
            assert w > 0, f"{name} should be positive"


# ---------------------------------------------------------------------------
# CoherencePlanes.bc()
# ---------------------------------------------------------------------------

class TestCoherencePlanesBc:
    def test_all_one_gives_one(self):
        cp = CoherencePlanes(phi=1.0, mu=1.0, sigma=1.0, kappa=1.0, alpha=1.0)
        assert abs(cp.bc() - 1.0) < 1e-9

    def test_all_zero_gives_zero(self):
        cp = CoherencePlanes(phi=0.0, mu=0.0, sigma=0.0, kappa=0.0, alpha=0.0)
        assert cp.bc() == 0.0

    def test_formula_matches_manual(self):
        phi, mu, sigma, kappa, alpha = 0.8, 0.6, 0.9, 0.5, 0.7
        cp = CoherencePlanes(phi=phi, mu=mu, sigma=sigma, kappa=kappa, alpha=alpha)
        expected = (ALPHA * phi + BETA * mu + GAMMA * sigma
                    + DELTA * kappa + EPSILON * alpha)
        assert abs(cp.bc() - expected) < 1e-9

    def test_bc_in_range(self):
        import random
        random.seed(0)
        for _ in range(100):
            vals = [random.random() for _ in range(5)]
            cp = CoherencePlanes(*vals)
            assert 0.0 <= cp.bc() <= 1.0

    def test_dominant_plane_returns_string(self):
        cp = CoherencePlanes(phi=0.1, mu=0.9, sigma=0.9, kappa=0.9, alpha=0.9)
        dominant = cp.dominant_plane()
        assert isinstance(dominant, str)
        assert dominant in ("phi", "mu", "sigma", "kappa", "alpha")

    def test_dominant_plane_lowest_weighted(self):
        # phi weighted by ALPHA=0.25 at value 0.0 → phi*ALPHA = 0
        cp = CoherencePlanes(phi=0.0, mu=0.5, sigma=0.5, kappa=0.5, alpha=0.5)
        # phi contribution = 0.0 * ALPHA = 0 — lowest
        assert cp.dominant_plane() == "phi"


# ---------------------------------------------------------------------------
# compute_bc() convenience wrapper
# ---------------------------------------------------------------------------

class TestComputeBc:
    def test_matches_dataclass(self):
        args = (0.7, 0.8, 0.6, 0.9, 0.5)
        cp_bc = CoherencePlanes(*args).bc()
        fn_bc = compute_bc(*args)
        assert abs(cp_bc - fn_bc) < 1e-9

    def test_perfect_score(self):
        assert compute_bc(1.0, 1.0, 1.0, 1.0, 1.0) == 1.0

    def test_zero_score(self):
        assert compute_bc(0.0, 0.0, 0.0, 0.0, 0.0) == 0.0


# ---------------------------------------------------------------------------
# compute_phi (Causal Flux plane) — empty / single-event edge cases
# ---------------------------------------------------------------------------

class TestComputePhi:
    def test_empty_events_returns_float(self):
        result = compute_phi([])
        assert isinstance(result, float)

    def test_single_event_returns_float(self):
        result = compute_phi([{"self_hash": b"\x00" * 32,
                               "prior_hash": b"\x00" * 32}])
        assert isinstance(result, float)

    def test_in_range(self):
        events = [{"self_hash": bytes([i] * 32),
                   "prior_hash": bytes([i - 1] * 32) if i > 0 else bytes(32)}
                  for i in range(10)]
        result = compute_phi(events)
        assert 0.0 <= result <= 1.0


# ---------------------------------------------------------------------------
# compute_mu (Model Confidence plane)
# ---------------------------------------------------------------------------

class TestComputeMu:
    def test_returns_float(self):
        result = compute_mu([])
        assert isinstance(result, float)

    def test_in_range(self):
        result = compute_mu([], trajectory_model=None)
        assert 0.0 <= result <= 1.0


# ---------------------------------------------------------------------------
# compute_sigma (Network Consensus plane)
# ---------------------------------------------------------------------------

class TestComputeSigma:
    def test_returns_float(self):
        result = compute_sigma([])
        assert isinstance(result, float)

    def test_with_no_signatures_gives_low_score(self):
        # Zero validators → sigma should be low
        result = compute_sigma([], validator_signatures={})
        assert 0.0 <= result <= 1.0


# ---------------------------------------------------------------------------
# compute_kappa (Environmental Context plane)
# ---------------------------------------------------------------------------

class TestComputeKappa:
    def test_returns_float(self):
        result = compute_kappa([])
        assert isinstance(result, float)

    def test_in_range(self):
        result = compute_kappa([], current_context=None)
        assert 0.0 <= result <= 1.0


# ---------------------------------------------------------------------------
# compute_alpha (Adaptive Intelligence plane)
# ---------------------------------------------------------------------------

class TestComputeAlpha:
    def test_returns_float(self):
        result = compute_alpha([])
        assert isinstance(result, float)

    def test_in_range(self):
        result = compute_alpha([], learning_trajectory=None)
        assert 0.0 <= result <= 1.0


# ---------------------------------------------------------------------------
# dynamic_threshold
# ---------------------------------------------------------------------------

class TestDynamicThreshold:
    def test_returns_float(self):
        result = dynamic_threshold()
        assert isinstance(result, float)

    def test_result_in_range(self):
        result = dynamic_threshold(psi_base=0.55, threat_level=0.0, volatility=0.0, depth=0.0)
        assert 0.0 <= result <= 1.5, f"threshold {result} unexpectedly large"

    def test_higher_threat_raises_threshold(self):
        low  = dynamic_threshold(threat_level=0.0)
        high = dynamic_threshold(threat_level=1.0)
        assert high >= low, "threat level should raise the coherence threshold"

    def test_higher_volatility_raises_threshold(self):
        low  = dynamic_threshold(volatility=0.0)
        high = dynamic_threshold(volatility=1.0)
        assert high >= low, "volatility should raise the coherence threshold"

    def test_greater_depth_lowers_threshold(self):
        shallow = dynamic_threshold(depth=0.0)
        deep    = dynamic_threshold(depth=100.0)
        assert deep <= shallow, "deeper entities should have a lower threshold (earned trust)"
