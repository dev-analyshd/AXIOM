---
name: AXIOM project overview
description: Build state, test commands, and durable invariants for the AXIOM system (7 layers, 19 inventions).
---

## Final test counts (all passing — post-audit)

| Suite | Command | Count |
|-------|---------|-------|
| Rust axiom-core unit | `cargo test --lib` | 45 |
| Rust axiom-integration | `cargo run --bin axiom-integration` | 74 |
| Python axiom-coherence | `python3 axiom-coherence/tests/test_coherence.py` | 45 |
| Go RCP unit + stress | `cd axiom-rcp && go test ./rcp/... -v -timeout 120s` | 17 |
| **Total** | | **181** |

All findings from AXIOM_WHITEPAPER_AUDIT.md (C1–C7, M1–M7, N1–N5) are implemented and verified.

## Known pitfalls

- Go 1.21 does NOT support `go test -q` (flag undefined); use `go test ./rcp/... -v` or no flags.
- Python `CoherencePlanes.dominant_plane` is an alias for `dominant_drag_plane` (alias added at planes.py line 178).
- `sqlx::query!` macros require a live DATABASE_URL at compile time; replaced with runtime `sqlx::query().bind()` in axiom-akashic.
- BPI `update()` only hashes: causal_history_root, spawner_bpi, purpose_hash, love, environment_hash — NOT timestamps.
- IoT domain profile (WP §4.8): phi=0.40 is highest (causal continuity), NOT kappa. Test comment was wrong; test was updated.
- `TrajectoryPredictor` already has `probability_of(entity_bpi, event_type)` — no need to add `get_probability`.
- Python test for domains must use plane values where phi ≠ sigma to expose financial vs IoT weight differences.

## Dashboard
- Runs on port 5000 via `cd dashboard && node server.js`.
- Workflow name: "Start application".
- `/api/axiom/compute` now accepts `love` and `roleMult` params; returns `govWeight=BC×D×Love`, `livingMoat=0.001×roleMult×love`.

**Why:** These are non-obvious runtime/compile-time behaviors that caused multiple failed attempts.
