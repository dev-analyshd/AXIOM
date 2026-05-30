---
name: AXIOM axiom-core API surface
description: Corrected call signatures and pitfalls for axiom-core Rust crate; use before writing new integration or unit tests.
---

## BehavioralProcessIdentity::update
- Signature: `(&mut self, causal_history_root: &UBHHash, environment_hash: &UBHHash, timestamp: GpsTimestampNs)`
- Mutates in-place, returns nothing. Clone the record before calling if you need both old and new BPI.

## BEOResolver::compute_resonant_frequencies
- It is a **static method on `BehavioralStream`**, not on `BEOResolver`.
- Correct: `BehavioralStream::compute_resonant_frequencies(&events) -> [f32; 32]`

## BISController::process_event
- Signature: `(&mut self, bpi: &BPI, ube: UBEType, bc: f32, depth: f64, timestamp: GpsTimestampNs, causal_context: UBHHash) -> Option<BISInterrupt>`
- No `psi` argument; 6 args after `&mut self`.

## ScheduledProcess struct fields
`bpi, current_bc, psi, depth, silence_state, love, hint_priority, error_count, event_count`
- NOT `bc`, `name`, `resource_weight`, `silence`, `consecutive_below_fitness`.

## dynamic_threshold
- Signature: `(threat_level: f32, volatility: f32, depth: f64) -> f32`
- PSI_BASE (0.55) is baked in internally. No psi_base argument.

## UBH tamper detection
- `bc_at_event` is NOT included in `compute_self_hash()`. To test tamper rejection,
  corrupt `self_hash[0]` directly (XOR with 0xFF). That makes `verify_self_hash()` return false.

## SimulationEntropySource timestamps
- Adds seed-based jitter to system time → GPS timestamps across events are NOT guaranteed monotone.
- Tests should check `> 0` (non-zero), not `w[1] >= w[0]` (strictly non-decreasing).

## RF cosine similarity thresholds
- Two AI-entity RF vectors like [0.5,0.5,...] vs [0.6,0.4,...] produce cosine ≈ 0.98, not > 0.99.
- Use `> 0.95` for "high resonance" checks between non-identical vectors.

**Why:** These were discovered by compiling axiom-integration and reading error messages + test failures.
**How to apply:** Before writing any new test that calls axiom-core, re-check these signatures instead of guessing from names.
