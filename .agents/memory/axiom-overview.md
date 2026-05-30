---
name: AXIOM project overview
description: Build state, test commands, and durable invariants for the AXIOM system (7 layers, 19 inventions).
---

## Final test counts (all passing)

| Suite | Command | Count |
|-------|---------|-------|
| Rust axiom-core unit | `cargo test --package axiom-core` | 45 |
| Rust axiom-integration | `cargo run --bin axiom-integration` | 74 |
| Rust axiom-stress | `cargo run --bin axiom-stress` | 20 |
| Python axiom-coherence | `python3 -m pytest axiom-coherence/tests/ -v` | 27 |
| Go RCP unit | `cd axiom-rcp && go test ./rcp/... -v -timeout 120s` | 9 |
| Go RCP stress | (same command, same binary) | 8 |
| **Total** | | **183** |

## Known pitfalls

- Go 1.21 does NOT support `go test -q` (flag undefined); use `go test ./rcp/... -v` or no flags.
- Python `CoherencePlanes.dominant_plane` is an alias for `dominant_drag_plane` (alias added at planes.py line 178).
- `sqlx::query!` macros require a live DATABASE_URL at compile time; replaced with runtime `sqlx::query().bind()` in axiom-akashic.
- BPI `update()` only hashes: causal_history_root, spawner_bpi, purpose_hash, love, environment_hash — NOT timestamps.

## Dashboard
- Runs on port 5000 via `cd dashboard && node server.js`.
- Workflow name: "Start application".

**Why:** These are non-obvious runtime/compile-time behaviors that caused multiple failed attempts.
