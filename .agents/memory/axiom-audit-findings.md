---
name: AXIOM whitepaper audit findings
description: Durable summary of the 19 findings from the full codebase vs whitepaper audit.
---

## Critical (must fix before production)

- C1: Domain weight profiles for financial/IoT/governance/healthcare deviate from WP §4.8. Code is internally consistent (planes.py = server.js) but both differ from the whitepaper. AI domain is the only exact match.
- C2: TRIONOracleV4._computeXi() uses linear approx (1 + Λ·D) not true exp(Λ·D). Error reaches 99.95% at D=10000.
- C3: AkashicProof.sol verifyInclusion() uses keccak256 for Merkle, but Akashic uses Blake3. Every inclusion proof will fail.
- C4: BZKP verifier is a stub in both TRIONOracleV4 and AkashicProof: `zkProof.length >= 64`. Noir circuits are correctly written; Barretenberg not deployed.
- C5: BehavioralIdentity.sol uses keccak256(purpose) for purpose_hash; off-chain bpi.rs uses Blake3. Cross-layer BPI verification fails.
- C6: BIS L4 SilenceEntityImmediately action is never wired in LivingKernel.tick(). TRAJ ≥ 5σ does not actually silence entities.
- C7: IKP apply_crispr() always writes first_seen_ns=0 to immune memory records.

## Moderate (affects correctness, not blocking)

- M1: BFS fitness formula is (BC×Love×(1+D/age))/2, not BC×Love×(D/age) from WP §7.5.
- M2: BEO biometric proxy (15% weight) is `entity_type == entity_type ? 0.6 : 0.1`. Should use timing jitter histograms.
- M3: engine.py always calls compute_mu(window_events, trajectory_model=None). TrajectoryPredictor is observed but never passed; M plane is always 0.8.
- M4: dashboard server.js govWeight hardcodes Love=0.8.
- M5: SilenceState::Recovering { events_remaining } is defined but never constructed at runtime.
- M6: compute_kappa() uses only latitude diff, not haversine distance.
- M7: kernel.rs candidate ranking ignores age denominator: uses F×D not F×D/(1+age).

## Minor

- N1: Dashboard L2 invention list incorrectly includes #11 (CBRA, which is L5).
- N2: Dashboard L5 invention list incorrectly includes #13 (Akashic Index, which is L3).
- N3: Dashboard livingMoat API field returns Λ×depth (the exponent argument) not Λ (the rate).
- N4: axiom-integration binary not read/verified as part of audit.
- N5: sdk/ directory not audited.

## Exact matches (46 total)
All core constants, formulas, invariants confirmed exact across Rust/Python/Go/Noir/Solidity:
PSI_BASE=0.55, LAMBDA_BASE=0.001, PLANE_WEIGHTS=[0.25,0.20,0.25,0.15,0.15], BPI_UPDATE_CYCLE=1000,
SILENCE_RECOVERY_WINDOW=300, RCP thresholds=0.50/0.15/0.05, CBRA Priority_Flag BC>0.90 D_rel>0.05 10×,
all 32 UBE types, all 14 UBH fields, Blake3 self-hash, causal chain invariant, GENESIS epoch, GPS offset,
all role multipliers, BIS 1σ/2σ/3σ/5σ levels, IKP BC_drop=0.15 trigger, convergence formula, BEO weights,
BFS tiers, ODI formula, Akashic append-only, Redis 24h TTL, RF 32-dim, RCP routing argmax.

**Why:** Ensures future development tracks which deviations are known vs new regressions.
**How to apply:** Before changing any constant or formula, cross-check against AXIOM_WHITEPAPER_AUDIT.md Part 5.
