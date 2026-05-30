// AXIOM Coherence Check Circuit — Secondary BZKP Circuit
//
// Proves that an entity's behavioral coherence has remained above
// threshold for a sustained window of N events without revealing
// the individual event types or BC values at each step.
//
// Use case: Proving continuous coherence for governance participation
// or resource allocation without exposing private behavioral data.
// Also used to prove the 300-event sustained window for SILENCE recovery.
//
// Author: Hudu Yusuf (Analys), @The_analys
// License: CC0 1.0 Universal

// ============================================================================
// CONSTANTS
// ============================================================================

global SCALE: Field = 1000000;         // 1e6 — fixed-point scaling factor
global PSI_BASE: Field = 550000;       // 0.55 × 1e6 — base threshold Ψ
global SUSTAINED_WINDOW: Field = 300;  // Events required for SILENCE recovery
global MIN_COHERENCE_FLOOR: Field = 100000;  // 0.10 × 1e6 — absolute minimum

// BC plane weights × 1e6 (must sum to SCALE)
global ALPHA: Field = 250000;  // 0.25 — Φ causal flux
global BETA:  Field = 200000;  // 0.20 — M model confidence
global GAMMA: Field = 250000;  // 0.25 — Σ network consensus
global DELTA: Field = 150000;  // 0.15 — K environmental context
global EPS:   Field = 150000;  // 0.15 — A adaptive intelligence

// ============================================================================
// COHERENCE SUSTAINED WINDOW CIRCUIT
//
// Proves BC(entity, t_i) >= psi for all i in window of 300 events.
// Used for SILENCE recovery attestation.
//
// Public inputs:
//   entity_bpi_hash    — Identity commitment
//   window_start       — GPS timestamp of window start (nanoseconds)
//   window_end         — GPS timestamp of window end (nanoseconds)
//   psi_threshold      — Ψ threshold all BCs must exceed × 1e6
//   min_bc_in_window   — Minimum BC observed in window (public claim) × 1e6
//
// Private inputs:
//   bc_values          — [300] individual BC values × 1e6
//   event_count        — Actual events in window (may be ≤ 300)
// ============================================================================

fn main(
    // Public
    entity_bpi_hash:  pub Field,
    window_start:     pub Field,
    window_end:       pub Field,
    psi_threshold:    pub Field,
    min_bc_in_window: pub Field,

    // Private
    bc_values:    [Field; 300],
    event_count:  Field,
) {
    // ── Constraint 1: Entity BPI is valid ─────────────────────────────────
    assert(entity_bpi_hash != 0, "entity_bpi_hash must be non-zero");

    // ── Constraint 2: Window is temporally ordered ─────────────────────────
    assert(window_end > window_start, "Window end must be after start");

    // ── Constraint 3: Threshold is above absolute floor ────────────────────
    assert(psi_threshold >= MIN_COHERENCE_FLOOR, "psi_threshold below absolute floor");
    assert(psi_threshold <= SCALE, "psi_threshold cannot exceed 1.0");

    // ── Constraint 4: Event count is within window size ────────────────────
    assert(event_count <= SUSTAINED_WINDOW, "event_count exceeds 300-event window");

    // ── Constraint 5: For recovery, need exactly SUSTAINED_WINDOW events ──
    assert(event_count == SUSTAINED_WINDOW, "Need exactly 300 events for SILENCE recovery");

    // ── Constraint 6: All BC values in window are above threshold ──────────
    let mut computed_min: Field = SCALE;

    for i in 0..300 {
        let bc = bc_values[i];

        // Every BC value must be within valid range
        assert(bc >= psi_threshold, "BC dropped below Psi threshold in window");
        assert(bc <= SCALE, "BC value cannot exceed 1.0");
        assert(bc >= MIN_COHERENCE_FLOOR, "BC below absolute coherence floor");

        // Track the minimum BC in window
        if bc < computed_min {
            computed_min = bc;
        }
    }

    // ── Constraint 7: Claimed minimum matches computed minimum ─────────────
    assert(computed_min == min_bc_in_window, "min_bc_in_window does not match records");

    // ── Constraint 8: Minimum is above threshold (redundant, but explicit) ─
    assert(min_bc_in_window >= psi_threshold, "Minimum BC still below threshold");
}

// ============================================================================
// TRAJECTORY ANOMALY PROOF CIRCUIT
//
// Proves TRAJ(entity, t) < 3σ (not anomalous) without revealing the
// specific event sequence or baseline distribution.
//
// Public inputs:
//   entity_bpi_hash   — Identity commitment
//   traj_score_public — TRAJ × 1e6 (must be < 3 × 1e6)
//
// Private inputs:
//   deviation  — ||observed - expected|| distance × 1e6
//   sigma      — Baseline σ × 1e6 (must be > 0)
// ============================================================================

fn prove_normal_trajectory(
    // Public
    entity_bpi_hash:   pub Field,
    traj_score_public: pub Field,  // TRAJ × 1e6 (must be < 3e6)

    // Private
    deviation:  Field,  // ||observed - expected|| × 1e6
    sigma:      Field,  // Baseline σ × 1e6
) {
    // ── Constraint 1: Entity is valid ────────────────────────────────────
    assert(entity_bpi_hash != 0, "entity_bpi_hash must be non-zero");

    // ── Constraint 2: Sigma is positive ──────────────────────────────────
    assert(sigma > 0, "Sigma must be positive");

    // ── Constraint 3: TRAJ = deviation / sigma ────────────────────────────
    // TRAJ × SCALE = (deviation × SCALE) / sigma
    let traj_computed = (deviation * SCALE) / sigma;
    assert(traj_computed == traj_score_public, "TRAJ score mismatch");

    // ── Constraint 4: TRAJ < 3σ (below BIS Level 3 threshold) ───────────
    let threshold_3sigma = 3 * SCALE;
    assert(traj_score_public < threshold_3sigma, "Trajectory is anomalous (>= 3 sigma)");
}

// ============================================================================
// BC COMPUTATION HELPER (used in multi-circuit verification)
// ============================================================================

fn compute_bc(phi: Field, mu: Field, sigma: Field, kappa: Field, alpha: Field) -> Field {
    let weighted = ALPHA * phi + BETA * mu + GAMMA * sigma + DELTA * kappa + EPS * alpha;
    weighted / SCALE
}
