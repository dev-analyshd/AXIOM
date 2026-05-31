---
name: AXIOM BZKP implementation
description: Noir ZK circuits, BehavioralZKVerifier.sol, and JS simulator design — pitfalls and invariants.
---

## Files

- `circuits/src/main.nr`             — BC >= Ψ single-shot proof (5 private plane inputs)
- `circuits/src/coherence_check.nr`  — 300-event SILENCE recovery window proof
- `circuits/src/temporal_cluster.nr` — 365-day annual behavioral cluster proof
- `contracts/contracts/BehavioralZKVerifier.sol` — 8-constraint verifier (simulation + production modes)
- `dashboard/bzkp_simulator.js`      — JS proof encoder/verifier (Node.js, no external deps)

## Proof format (simulation mode — 184 bytes)

```
[0..3]   magic          0xBE0CA100
[4..7]   circuit_ver    0x00000001
[8..11]  claimed_bc     uint32 BE × 1e6
[12..15] psi_threshold  uint32 BE × 1e6
[16..47] entity_bpi     32 bytes
[48..55] depth_commit   uint64 BE
[56..87] planes_hash    SHA256(phi‖mu‖sigma‖kappa‖alpha)  — private witness
[88..119] witness_root  SHA256(planes_hash ‖ sat_proof)
[120..151] sat_proof    SHA256(bc‖psi‖bpi‖planes_hash‖nonce)
[152..183] nonce        32 bytes
```

Hash: SHA256 in JS simulator, keccak256 in Solidity (BehavioralZKVerifier.sol). They are not byte-compatible but both validate the same logical constraints.

## Eight constraints (mirrors Noir main.nr)

- C0: Proof structure — magic 0xBE0CA100, length 184, version 0x00000001
- C1: BC and Ψ within [PSI_FLOOR=0.10, SCALE=1.0]
- C2: Proof-encoded BC matches caller-supplied BC
- C3: Proof-encoded Ψ matches caller-supplied Ψ
- C4: Entity BPI commitment matches expected BPI (identity binding)
- C5: Planes commitment (planes_hash) is non-zero
- C6: BC >= Ψ (core BZKP claim — mirrors main.nr Constraint 3)
- C7: Constraint satisfaction proof sat_proof = H(bc‖psi‖bpi‖planes_hash‖nonce) — binds private planes to public inputs

## BZKP.04 planes swap attack test

Test requires two proofs with **different** plane values so their planes_hash values differ. Using default planes for both proofs makes planes_hash identical → attack undetectable → test false-passes. Always specify distinct phi/mu/sigma/kappa/alpha for the two proofs.

## BPI hex encoding pitfall

Test BPIs must use valid hex strings (64 hex chars = 32 bytes). Strings with non-hex chars like `defi`, `iotiot` silently truncate in Node.js Buffer.from(hex) → produce short buffers → proof length < 184 bytes → C0 fails immediately. Use `'dc'+'f1'+'00'.repeat(28)+'0001'` pattern (exact 64 hex chars, no 0x prefix).

## Two-mode architecture

- Simulation mode (`barretenbergVerifier == address(0)`): full 8-constraint Solidity check, accepts 184-byte proof
- Production mode (`barretenbergVerifier != address(0)`): delegates to deployed Barretenberg UltraPlonk verifier, accepts ~2KB PLONK proof from `nargo prove`
- Switch via `BehavioralZKVerifier.setBarretenbergVerifier(address)`

## TRIONOracleV4 integration

`_verifyBZKP()` reads entity's on-chain BC and Ψ from `entityTruths[entityBpi]` and cross-checks them against the proof's encoded values. Prevents proof replay from a prior BC state.

## AkashicProof integration

`verifyBZKP()` calls `bzkpVerifier.verifyProofOnly()` which extracts BC/Ψ from the proof itself — AkashicProof does not need to track per-entity BC.

## API endpoints

- POST `/api/axiom/bzkp/prove` — encodes a simulation proof (JSON body: entityBpi, phi–alpha, psiThreshold, depth)
- POST `/api/axiom/bzkp/verify` — verifies a hex-encoded proof
- POST `/api/axiom/test` — includes `bzkp` section (10 tests) alongside rust/python/go

**Why:** The BPI hex pitfall and planes swap test precondition were non-obvious and caused test failures that took multiple attempts to diagnose.
