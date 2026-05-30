//! # AXIOM Core
//!
//! The behavioral foundation for universal computation.
//!
//! ## Layers
//! - [`l0`] — Physical Reality Substrate (GPS, HSM, entropy)
//! - [`l1`] — Universal Behavioral Hash Engine (32 UBE types)
//! - [`l2`] — Entity Resolution (BEO Universal, BPI)
//! - [`l5`] — Living Kernel (CBRA, BIS, IKP, BFS)
//!
//! ## Master Equation
//! ```text
//! Ξ(entity, t) = [BC(entity,t) ≥ Ψ(entity,t)] · Ε(entity,t) · e^(Λ(entity)·D(entity,t))
//! ```

#![warn(missing_docs)]
#![cfg_attr(feature = "no_std", no_std)]

pub mod l0;
pub mod l1;
pub mod l2;
pub mod l5;
pub mod types;

pub use types::*;

/// AXIOM Genesis Epoch — 2026-01-01 00:00:00 UTC in GPS nanoseconds.
///
/// All gps_timestamp fields in UBH records are expressed as nanoseconds
/// since this epoch. Value: 1735689600 seconds × 10⁹ ns/s.
pub const AXIOM_GENESIS_EPOCH: u64 = 1_735_689_600_000_000_000;

/// Default coherence threshold Ψ_base = 0.55
pub const PSI_BASE: f32 = 0.55;

/// Living Moat base rate Λ_base = 0.001 per behavioral event
pub const LAMBDA_BASE: f64 = 0.001;

/// BC plane weights [α, β, γ, δ, ε] — must sum to exactly 1.0
///
/// BC(entity, t) = α·Φ + β·M + γ·Σ + δ·K + ε·A
///   α = 0.25 (Φ — Causal Flux / Entropy)
///   β = 0.20 (M — Model Confidence)
///   γ = 0.25 (Σ — Network Consensus)
///   δ = 0.15 (K — Environmental Context)
///   ε = 0.15 (A — Adaptive Intelligence)
pub const PLANE_WEIGHTS: [f32; 5] = [0.25, 0.20, 0.25, 0.15, 0.15];

/// Threat sensitivity α_threat for dynamic threshold
pub const ALPHA_THREAT: f32 = 0.20;

/// Volatility sensitivity β_vol for dynamic threshold
pub const BETA_VOL: f32 = 0.10;

/// Depth discount factor γ_depth for dynamic threshold
pub const GAMMA_DEPTH: f32 = 0.05;

/// Sustained recovery window — entity must sustain BC ≥ Ψ for 300 events
/// before SILENCE is lifted.
pub const SILENCE_RECOVERY_WINDOW: u64 = 300;

/// BPI update cycle — BPI is recomputed every 1000 behavioral events.
pub const BPI_UPDATE_CYCLE: u64 = 1000;

/// RCP connection tier thresholds (cosine similarity of RF vectors)
///
/// >0.50 → high-bandwidth connection
/// >0.15 → standard connection
/// >0.05 → emergency-only connection
/// ≤0.05 → no connection
pub const RCP_HIGH_BW_THRESHOLD: f32    = 0.50;
pub const RCP_STANDARD_THRESHOLD: f32   = 0.15;
pub const RCP_EMERGENCY_THRESHOLD: f32  = 0.05;

/// CBRA Priority_Flag conditions: BC > 0.90 AND D_rel > 0.05
pub const CBRA_PRIORITY_BC_THRESHOLD: f32   = 0.90;
pub const CBRA_PRIORITY_DREL_THRESHOLD: f64 = 0.05;
/// Priority_Flag multiplier (10x for 30 seconds)
pub const CBRA_PRIORITY_MULTIPLIER: f32     = 10.0;

/// Compute the AXIOM Master Equation Ξ(entity, t)
///
/// Ξ(entity, t) = [BC(entity,t) ≥ Ψ(entity,t)] · Ε(entity,t) · e^(Λ(entity)·D(entity,t))
///
/// # Arguments
/// * `bc`      — Behavioral coherence BC(entity, t) ∈ [0, 1]
/// * `psi`     — Dynamic threshold Ψ(entity, t) ∈ [0, 1]
/// * `epsilon` — Expression state Ε(entity, t) ≥ 0
/// * `lambda`  — Living moat rate Λ(entity)
/// * `depth`   — Akashic depth D(entity, t) ≥ 0
pub fn master_equation(bc: f32, psi: f32, epsilon: f64, lambda: f64, depth: f64) -> f64 {
    let coherence_gate = if bc >= psi { 1.0f64 } else { 0.0f64 };
    coherence_gate * epsilon * (lambda * depth).exp()
}

/// Compute Behavioral Coherence BC(entity, t)
///
/// BC = α·Φ + β·M + γ·Σ + δ·K + ε·A
/// Subject to: weights sum to 1, result ∈ [0, 1]
pub fn behavioral_coherence(phi: f32, mu: f32, sigma: f32, kappa: f32, alpha: f32) -> f32 {
    let w = PLANE_WEIGHTS;
    (w[0] * phi + w[1] * mu + w[2] * sigma + w[3] * kappa + w[4] * alpha).clamp(0.0, 1.0)
}

/// Compute Dynamic Threshold Ψ(entity, t)
///
/// Ψ = Ψ_base + α_threat·ThreatLevel + β_vol·Volatility − γ_depth·log(1 + D)
pub fn dynamic_threshold(threat_level: f32, volatility: f32, depth: f64) -> f32 {
    let depth_discount = GAMMA_DEPTH * (1.0 + depth as f32).ln();
    (PSI_BASE + ALPHA_THREAT * threat_level + BETA_VOL * volatility - depth_discount)
        .clamp(0.1, 0.99)
}

/// Compute Akashic Depth increment ΔD
///
/// ΔD = BH_rate · BC · Love · Δt
pub fn depth_increment(bh_rate: f64, bc: f32, love: f32, delta_t_secs: f64) -> f64 {
    bh_rate * bc as f64 * love as f64 * delta_t_secs
}

/// Compute Living Moat Λ(entity)
///
/// Λ = Λ_base · Role_Multiplier · Love
pub fn living_moat(role_multiplier: f64, love: f32) -> f64 {
    LAMBDA_BASE * role_multiplier * love as f64
}

/// Compute Governance Weight GovWeight(entity, t)
///
/// GovWeight = BC · D · Love
pub fn governance_weight(bc: f32, depth: f64, love: f32) -> f64 {
    bc as f64 * depth * love as f64
}

/// Convert Unix timestamp (ns) to GPS-epoch timestamp (ns).
///
/// GPS epoch offset: 315,964,800 seconds (difference between GPS epoch
/// 1980-01-06 and Unix epoch 1970-01-01).
pub fn unix_ns_to_gps_ns(unix_ns: u64) -> u64 {
    unix_ns + 315_964_800_000_000_000
}

/// Convert GPS-epoch timestamp (ns) to Unix timestamp (ns).
pub fn gps_ns_to_unix_ns(gps_ns: u64) -> u64 {
    gps_ns.saturating_sub(315_964_800_000_000_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_genesis_epoch_correct_ns() {
        // 2026-01-01 00:00:00 UTC = 1735689600 seconds since Unix epoch
        // In GPS nanoseconds: 1735689600 × 10⁹
        assert_eq!(AXIOM_GENESIS_EPOCH, 1_735_689_600_000_000_000);
    }

    #[test]
    fn test_plane_weights_sum_to_one() {
        let sum: f32 = PLANE_WEIGHTS.iter().sum();
        assert!((sum - 1.0).abs() < 1e-6, "Plane weights must sum to 1.0, got {}", sum);
    }

    #[test]
    fn test_master_equation_coherent() {
        let xi = master_equation(0.80, 0.55, 1.0, 0.001, 1000.0);
        assert!(xi > 0.0);
    }

    #[test]
    fn test_master_equation_silence() {
        // BC below Ψ → SILENCE → Ξ = 0
        let xi = master_equation(0.40, 0.55, 1.0, 0.001, 1000.0);
        assert_eq!(xi, 0.0);
    }

    #[test]
    fn test_behavioral_coherence_exact_weights() {
        // With all planes = 1.0, BC = 0.25+0.20+0.25+0.15+0.15 = 1.0
        let bc = behavioral_coherence(1.0, 1.0, 1.0, 1.0, 1.0);
        assert!((bc - 1.0).abs() < 1e-6);
        // With all planes = 0.0, BC = 0.0
        let bc_zero = behavioral_coherence(0.0, 0.0, 0.0, 0.0, 0.0);
        assert_eq!(bc_zero, 0.0);
    }

    #[test]
    fn test_dynamic_threshold_base() {
        let psi = dynamic_threshold(0.0, 0.0, 0.0);
        assert!((psi - 0.55).abs() < 0.01);
    }

    #[test]
    fn test_dynamic_threshold_under_attack() {
        let normal = dynamic_threshold(0.0, 0.0, 0.0);
        let under_attack = dynamic_threshold(1.0, 0.5, 0.0);
        assert!(under_attack > normal);
    }

    #[test]
    fn test_dynamic_threshold_deep_entity_lower() {
        let new_entity = dynamic_threshold(0.0, 0.0, 0.0);
        let deep_entity = dynamic_threshold(0.0, 0.0, 1_000_000.0);
        assert!(deep_entity < new_entity);
    }

    #[test]
    fn test_depth_increases_moat() {
        let xi_shallow = master_equation(0.80, 0.55, 1.0, 0.001, 100.0);
        let xi_deep    = master_equation(0.80, 0.55, 1.0, 0.001, 10000.0);
        assert!(xi_deep > xi_shallow);
    }

    #[test]
    fn test_rcp_thresholds_ordered() {
        assert!(RCP_HIGH_BW_THRESHOLD > RCP_STANDARD_THRESHOLD);
        assert!(RCP_STANDARD_THRESHOLD > RCP_EMERGENCY_THRESHOLD);
        assert!(RCP_EMERGENCY_THRESHOLD > 0.0);
    }

    #[test]
    fn test_cbra_priority_conditions() {
        assert!((CBRA_PRIORITY_BC_THRESHOLD - 0.90).abs() < 1e-6);
        assert!((CBRA_PRIORITY_DREL_THRESHOLD - 0.05).abs() < 1e-9);
        assert!((CBRA_PRIORITY_MULTIPLIER - 10.0).abs() < 1e-6);
    }

    #[test]
    fn test_gps_epoch_conversion() {
        let unix_ns = 1_735_689_600_000_000_000u64;
        let gps_ns = unix_ns_to_gps_ns(unix_ns);
        let back = gps_ns_to_unix_ns(gps_ns);
        assert_eq!(back, unix_ns);
    }
}
