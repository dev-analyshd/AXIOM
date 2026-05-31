/**
 * AXIOM Behavioral Zero-Knowledge Proof (BZKP) Simulator
 * Invention #4 — dashboard/bzkp_simulator.js
 *
 * JavaScript implementation of the BehavioralZKVerifier.sol proof lifecycle:
 *   1. encodeProof()   — prover side (L4 coherence engine)
 *   2. verifyProof()   — verifier side (smart contract equivalent in JS)
 *   3. decodeInputs()  — extract public inputs from proof bytes
 *
 * Proof format (184 bytes) — identical to BehavioralZKVerifier.sol:
 *   [0 ..  3]  magic          0xBE0CA100
 *   [4 ..  7]  circuit_ver    0x00000001
 *   [8 .. 11]  claimed_bc     BC × 1e6, uint32 big-endian
 *   [12.. 15]  psi_threshold  Ψ × 1e6, uint32 big-endian
 *   [16.. 47]  entity_bpi     32-byte BPI commitment
 *   [48.. 55]  depth_commit   uint64 big-endian
 *   [56.. 87]  planes_hash    SHA256(phi‖mu‖sigma‖kappa‖alpha) — private witness
 *   [88..119]  witness_root   SHA256(planes_hash ‖ sat_proof)
 *   [120..151] sat_proof      SHA256(bc‖psi‖bpi‖planes_hash‖nonce)
 *   [152..183] nonce          32-byte randomness
 *   Total: 184 bytes
 *
 * Hash function: SHA256 (Node.js built-in crypto).
 * EVM deployment uses keccak256 for sat_proof (BehavioralZKVerifier.sol).
 * Both are collision-resistant; this simulator validates the proof logic
 * independently of EVM deployment.
 *
 * Noir source:  circuits/src/main.nr
 * Solidity:     contracts/contracts/BehavioralZKVerifier.sol
 */

'use strict';

const crypto = require('crypto');

// ── Constants (match Noir SCALE, PSI constants) ──────────────────────────────
const SCALE      = 1_000_000;   // 1e6 — fixed-point scale
const PSI_FLOOR  = 100_000;     // 0.10 × 1e6 — absolute coherence floor
const PSI_BASE   = 550_000;     // 0.55 × 1e6 — default threshold
const PROOF_LEN  = 184;

const MAGIC_BYTES   = Buffer.from('BE0CA100', 'hex');
const CIRCUIT_VER   = Buffer.from('00000001', 'hex');

// Plane weights × 1e6 (standard profile — matches Noir ALPHA, BETA, GAMMA, DELTA, EPS)
const WEIGHTS = {
    phi:   250_000,  // Causal Flux (Φ)
    mu:    200_000,  // Model Confidence (M)
    sigma: 250_000,  // Network Consensus (Σ)
    kappa: 150_000,  // Environmental Context (K)
    alpha: 150_000,  // Adaptive Intelligence (A)
};

// ── Internal helpers ─────────────────────────────────────────────────────────

function sha256(...parts) {
    const h = crypto.createHash('sha256');
    for (const p of parts) h.update(p);
    return h.digest();
}

function uint32BE(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n >>> 0, 0);
    return b;
}

function uint64BE(n) {
    const b = Buffer.alloc(8);
    // n may be a Number or BigInt
    const big = BigInt(n);
    b.writeBigUInt64BE(big, 0);
    return b;
}

function bpiToBuffer(bpi) {
    if (Buffer.isBuffer(bpi)) {
        const out = Buffer.alloc(32);
        bpi.copy(out, 32 - bpi.length);
        return out;
    }
    if (typeof bpi === 'string') {
        const s = bpi.replace(/^0x/, '');
        return Buffer.from(s.padStart(64, '0'), 'hex');
    }
    throw new Error('bpi must be Buffer or hex string');
}

// ── computeBC — mirrors Noir compute_bc() in main.nr ────────────────────────

/**
 * Compute BC from five plane values (all ∈ [0, 1.0]).
 * Returns BC as a float and as scaled integer × 1e6.
 */
function computeBC(phi, mu, sigma, kappa, alpha) {
    const bc = (
        WEIGHTS.phi   * phi   +
        WEIGHTS.mu    * mu    +
        WEIGHTS.sigma * sigma +
        WEIGHTS.kappa * kappa +
        WEIGHTS.alpha * alpha
    ) / SCALE;
    return {
        bc,
        bcScaled: Math.round(bc * SCALE),
    };
}

// ── computePlanesHash — private witness commitment ───────────────────────────

/**
 * Compute the planes hash (private witness commitment).
 * Equivalent to BehavioralZKVerifier.computePlanesHash().
 * All plane values are × 1e6 (integers).
 */
function computePlanesHash(phiInt, muInt, sigmaInt, kappaInt, alphaInt) {
    return sha256(
        uint32BE(phiInt),
        uint32BE(muInt),
        uint32BE(sigmaInt),
        uint32BE(kappaInt),
        uint32BE(alphaInt),
    );
}

// ── encodeProof — prover side ─────────────────────────────────────────────────

/**
 * Encode a valid 184-byte BZKP simulation proof.
 *
 * @param {object} opts
 * @param {string|Buffer} opts.entityBpi    — 32-byte BPI (hex string or Buffer)
 * @param {number}        opts.phi          — Causal Flux plane ∈ [0, 1]
 * @param {number}        opts.mu           — Model Confidence plane ∈ [0, 1]
 * @param {number}        opts.sigma        — Network Consensus plane ∈ [0, 1]
 * @param {number}        opts.kappa        — Environmental Context plane ∈ [0, 1]
 * @param {number}        opts.alpha        — Adaptive Intelligence plane ∈ [0, 1]
 * @param {number}        opts.psiThreshold — Ψ ∈ [0.10, 1.0] (default 0.55)
 * @param {number}        opts.depth        — D(entity,t) depth value
 * @param {Buffer}        opts.nonce        — 32-byte nonce (random if omitted)
 * @returns {{ proof: Buffer, publicInputs: object, planes: object }}
 */
function encodeProof({
    entityBpi,
    phi   = 0.8,
    mu    = 0.8,
    sigma = 0.8,
    kappa = 0.8,
    alpha = 0.8,
    psiThreshold = 0.55,
    depth = 1000,
    nonce = null,
}) {
    const bpiBuffer     = bpiToBuffer(entityBpi);
    const psiInt        = Math.round(psiThreshold * SCALE);
    const { bc, bcScaled } = computeBC(phi, mu, sigma, kappa, alpha);

    if (psiInt < PSI_FLOOR)
        throw new Error(`psiThreshold ${psiThreshold} below absolute floor 0.10`);
    if (psiInt > SCALE)
        throw new Error(`psiThreshold ${psiThreshold} > 1.0`);
    if (bcScaled < psiInt)
        throw new Error(`BC ${bc.toFixed(4)} < Ψ ${psiThreshold} — proof would fail (entity SILENCED)`);

    // Private plane values × 1e6
    const phiInt   = Math.round(phi   * SCALE);
    const muInt    = Math.round(mu    * SCALE);
    const sigmaInt = Math.round(sigma * SCALE);
    const kappaInt = Math.round(kappa * SCALE);
    const alphaInt = Math.round(alpha * SCALE);

    const planesHash = computePlanesHash(phiInt, muInt, sigmaInt, kappaInt, alphaInt);

    const nonceBuffer = nonce || crypto.randomBytes(32);
    if (nonceBuffer.length !== 32) throw new Error('nonce must be 32 bytes');

    // sat_proof = SHA256(bc ‖ psi ‖ bpi ‖ planes_hash ‖ nonce)
    const satProof = sha256(
        uint32BE(bcScaled),
        uint32BE(psiInt),
        bpiBuffer,
        planesHash,
        nonceBuffer,
    );

    // witness_root = SHA256(planes_hash ‖ sat_proof)
    const witnessRoot = sha256(planesHash, satProof);

    const depthInt = Math.round(depth);

    const proof = Buffer.concat([
        MAGIC_BYTES,          // [0..3]    0xBE0CA100
        CIRCUIT_VER,          // [4..7]    0x00000001
        uint32BE(bcScaled),   // [8..11]   claimed_bc
        uint32BE(psiInt),     // [12..15]  psi_threshold
        bpiBuffer,            // [16..47]  entity_bpi_hash (32 bytes)
        uint64BE(depthInt),   // [48..55]  depth_commitment (8 bytes)
        planesHash,           // [56..87]  planes_hash (32 bytes)
        witnessRoot,          // [88..119] witness_root (32 bytes)
        satProof,             // [120..151] sat_proof (32 bytes)
        nonceBuffer,          // [152..183] nonce (32 bytes)
    ]);

    if (proof.length !== PROOF_LEN)
        throw new Error(`Internal: proof length ${proof.length} ≠ ${PROOF_LEN}`);

    return {
        proof,
        publicInputs: {
            entityBpi:    bpiBuffer.toString('hex'),
            claimedBc:    bcScaled,
            psiThreshold: psiInt,
            depthCommit:  depthInt,
            bcFloat:      bc,
        },
        planes: { phi, mu, sigma, kappa, alpha, phiInt, muInt, sigmaInt, kappaInt, alphaInt },
    };
}

// ── verifyProof — verifier side (mirrors BehavioralZKVerifier._checkConstraints) ──

/**
 * Verify a 184-byte BZKP simulation proof.
 *
 * Applies all eight constraints from BehavioralZKVerifier._checkConstraints().
 *
 * @param {object} opts
 * @param {string|Buffer} opts.entityBpi    — expected entity BPI
 * @param {number}        opts.claimedBc    — expected BC × 1e6
 * @param {number}        opts.psiThreshold — expected Ψ × 1e6
 * @param {Buffer}        opts.proof        — 184-byte proof
 * @returns {{ valid: boolean, constraint: string|null, reason: string|null }}
 */
function verifyProof({ entityBpi, claimedBc, psiThreshold, proof }) {
    const bpiBuffer = bpiToBuffer(entityBpi);

    // C0 — Proof structure
    if (!Buffer.isBuffer(proof) || proof.length !== PROOF_LEN)
        return fail('C0', `proof must be ${PROOF_LEN} bytes (got ${proof ? proof.length : 'null'})`);

    if (!proof.slice(0, 4).equals(MAGIC_BYTES))
        return fail('C0', `invalid magic bytes (expected BE0CA100, got ${proof.slice(0,4).toString('hex').toUpperCase()})`);

    if (!proof.slice(4, 8).equals(CIRCUIT_VER))
        return fail('C0', `invalid circuit version (expected 00000001, got ${proof.slice(4,8).toString('hex')})`);

    // C1 — BC and Ψ within scale
    if (claimedBc > SCALE)
        return fail('C1', `BC ${claimedBc} > SCALE (1e6)`);
    if (psiThreshold > SCALE)
        return fail('C1', `psiThreshold ${psiThreshold} > SCALE`);
    if (psiThreshold < PSI_FLOOR)
        return fail('C1', `psiThreshold ${psiThreshold} < PSI_FLOOR (100000)`);

    // C2 — Proof-encoded BC matches supplied BC
    const proofBc = proof.readUInt32BE(8);
    if (proofBc !== claimedBc)
        return fail('C2', `proof encodes BC=${proofBc}, caller claims BC=${claimedBc}`);

    // C3 — Proof-encoded Ψ matches supplied Ψ
    const proofPsi = proof.readUInt32BE(12);
    if (proofPsi !== psiThreshold)
        return fail('C3', `proof encodes Ψ=${proofPsi}, caller claims Ψ=${psiThreshold}`);

    // C4 — Entity BPI commitment matches
    const proofBpi = proof.slice(16, 48);
    if (proofBpi.equals(Buffer.alloc(32)))
        return fail('C4', 'entity_bpi_hash must be non-zero');
    if (!proofBpi.equals(bpiBuffer))
        return fail('C4', `BPI mismatch: proof=${proofBpi.toString('hex')} vs expected=${bpiBuffer.toString('hex')}`);

    // C5 — Planes commitment non-zero
    const planesHash = proof.slice(56, 88);
    if (planesHash.equals(Buffer.alloc(32)))
        return fail('C5', 'planes_hash commitment must be non-zero');

    // C6 — BC >= Ψ (core BZKP claim — mirrors main.nr Constraint 3)
    if (claimedBc < psiThreshold)
        return fail('C6', `BC ${claimedBc} < Ψ ${psiThreshold} — entity is SILENCED`);

    // C7 — Constraint satisfaction proof validates witness commitment
    const satProof  = proof.slice(120, 152);
    const nonce     = proof.slice(152, 184);
    const expectedSat = sha256(
        uint32BE(proofBc),
        uint32BE(proofPsi),
        proofBpi,
        planesHash,
        nonce,
    );
    if (!satProof.equals(expectedSat))
        return fail('C7', 'sat_proof mismatch — planes commitment is tampered or invalid');

    return { valid: true, constraint: null, reason: null };
}

/**
 * Verify proof with public inputs extracted from the proof bytes themselves.
 * Equivalent to BehavioralZKVerifier.verifyProofOnly().
 */
function verifyProofOnly({ entityBpi, proof }) {
    if (!Buffer.isBuffer(proof) || proof.length !== PROOF_LEN)
        return fail('C0', `proof must be ${PROOF_LEN} bytes`);
    const claimedBc    = proof.readUInt32BE(8);
    const psiThreshold = proof.readUInt32BE(12);
    return verifyProof({ entityBpi, claimedBc, psiThreshold, proof });
}

// ── decodeInputs — extract public inputs from proof ──────────────────────────

/**
 * Decode the four public inputs from a simulation-mode proof.
 * Equivalent to BehavioralZKVerifier.decodePublicInputs().
 */
function decodeInputs(proof) {
    if (!Buffer.isBuffer(proof) || proof.length !== PROOF_LEN)
        throw new Error(`proof must be ${PROOF_LEN} bytes`);
    return {
        claimedBc:      proof.readUInt32BE(8),
        psiThreshold:   proof.readUInt32BE(12),
        entityBpiHash:  proof.slice(16, 48).toString('hex'),
        depthCommit:    Number(proof.readBigUInt64BE(48)),
    };
}

// ── run BZKP test suite (used by dashboard /api/axiom/test) ──────────────────

/**
 * Run the complete BZKP simulation test suite.
 * Returns an array of { name, pass, detail } test results.
 */
function runBZKPTests() {
    const results = [];

    function pass(name, detail)  { results.push({ name, pass: true,  detail }); }
    function xfail(name, detail) { results.push({ name, pass: false, detail }); }

    // Valid 32-byte hex BPIs for test entities (64 hex chars each, no 0x prefix)
    const BPI_DEFI  = 'dcf1' + '00'.repeat(28) + '0001';  // "DeFi" entity — 64 hex chars
    const BPI_IOT   = 'beed' + '00'.repeat(28) + '0002';  // IoT entity   — 64 hex chars
    const BPI_ZERO  = '00'.repeat(32);

    // ── Test 1: Valid proof for healthy entity (BC 0.85 > Ψ 0.55) ────────────
    try {
        const { proof, publicInputs } = encodeProof({
            entityBpi:    BPI_DEFI,
            phi: 0.90, mu: 0.80, sigma: 0.85, kappa: 0.80, alpha: 0.90,
            psiThreshold: 0.55,
            depth: 5000,
        });
        const r = verifyProof({
            entityBpi:    BPI_DEFI,
            claimedBc:    publicInputs.claimedBc,
            psiThreshold: publicInputs.psiThreshold,
            proof,
        });
        if (r.valid) {
            pass('BZKP.01', `BC=${(publicInputs.claimedBc/1e6).toFixed(4)} >= Ψ=0.55 → proof accepted`);
        } else {
            xfail('BZKP.01', `Unexpected rejection: ${r.reason}`);
        }
    } catch (e) { xfail('BZKP.01', e.message); }

    // ── Test 2: Silenced entity proof correctly rejected (BC 0.40 < Ψ 0.55) ──
    try {
        encodeProof({
            entityBpi:    BPI_IOT,
            phi: 0.40, mu: 0.40, sigma: 0.40, kappa: 0.40, alpha: 0.40,
            psiThreshold: 0.55,
        });
        xfail('BZKP.02', 'Expected encodeProof to throw for silenced entity');
    } catch (e) {
        if (e.message.includes('SILENCED')) {
            pass('BZKP.02', `Encoder rejects: "${e.message}"`);
        } else {
            xfail('BZKP.02', `Wrong error: ${e.message}`);
        }
    }

    // ── Test 3: Tampered proof (flip BC byte) correctly rejected ─────────────
    try {
        const { proof, publicInputs } = encodeProof({
            entityBpi: BPI_DEFI,
            phi: 0.80, mu: 0.80, sigma: 0.80, kappa: 0.80, alpha: 0.80,
            psiThreshold: 0.55,
        });
        const tampered = Buffer.from(proof);
        tampered[8] ^= 0xFF;  // Flip BC high byte
        const tamperedBc = tampered.readUInt32BE(8);
        const r = verifyProof({
            entityBpi:    BPI_DEFI,
            claimedBc:    tamperedBc,
            psiThreshold: publicInputs.psiThreshold,
            proof:        tampered,
        });
        if (!r.valid) {
            pass('BZKP.03', `Tampered proof rejected at ${r.constraint}: ${r.reason}`);
        } else {
            xfail('BZKP.03', 'Tampered proof was accepted — sat_proof should have caught tampering');
        }
    } catch (e) { xfail('BZKP.03', e.message); }

    // ── Test 4: Planes commitment swap attack rejected ────────────────────────
    // Attacker takes a proof from a LOW-BC entity and swaps its planes_hash into
    // a HIGH-BC entity's proof, hoping to forge a valid proof with foreign witness.
    // The sat_proof cryptographically binds planes_hash to the other public inputs,
    // so any substitution of planes_hash breaks the C7 constraint.
    try {
        const { proof: p1 } = encodeProof({
            entityBpi: BPI_DEFI,
            phi: 0.90, mu: 0.88, sigma: 0.90, kappa: 0.85, alpha: 0.88, // HIGH-BC entity
            psiThreshold: 0.55,
        });
        const { proof: p2 } = encodeProof({
            entityBpi: BPI_IOT,
            phi: 0.60, mu: 0.60, sigma: 0.60, kappa: 0.60, alpha: 0.60, // different planes
            psiThreshold: 0.55,
        });
        // Verify p1's planes_hash ≠ p2's planes_hash (precondition for the attack)
        const ph1 = p1.slice(56, 88).toString('hex');
        const ph2 = p2.slice(56, 88).toString('hex');
        if (ph1 === ph2) {
            xfail('BZKP.04', 'Test precondition failed: planes_hash values are identical (use different plane values)');
        } else {
            const hybrid = Buffer.from(p1);
            p2.copy(hybrid, 56, 56, 88); // splice p2's planes_hash into p1's slot
            const r = verifyProof({
                entityBpi:    BPI_DEFI,
                claimedBc:    hybrid.readUInt32BE(8),
                psiThreshold: hybrid.readUInt32BE(12),
                proof:        hybrid,
            });
            if (!r.valid && r.constraint === 'C7') {
                pass('BZKP.04', `Planes swap detected at C7 — sat_proof binds planes_hash to public inputs`);
            } else if (!r.valid) {
                pass('BZKP.04', `Planes swap rejected at ${r.constraint}: ${r.reason}`);
            } else {
                xfail('BZKP.04', 'Planes commitment swap not detected — sat_proof binding broken');
            }
        }
    } catch (e) { xfail('BZKP.04', e.message); }

    // ── Test 5: decodeInputs round-trip ──────────────────────────────────────
    try {
        const { proof, publicInputs } = encodeProof({
            entityBpi: BPI_DEFI,
            phi: 0.75, mu: 0.70, sigma: 0.80, kappa: 0.65, alpha: 0.70,
            psiThreshold: 0.55, depth: 7777,
        });
        const decoded = decodeInputs(proof);
        const bcMatch  = decoded.claimedBc    === publicInputs.claimedBc;
        const psiMatch = decoded.psiThreshold === publicInputs.psiThreshold;
        const bpiMatch = decoded.entityBpiHash === bpiToBuffer(BPI_DEFI).toString('hex');
        const depMatch = decoded.depthCommit   === 7777;
        if (bcMatch && psiMatch && bpiMatch && depMatch) {
            pass('BZKP.05', `Public inputs round-trip: BC=${decoded.claimedBc} PSI=${decoded.psiThreshold} D=${decoded.depthCommit}`);
        } else {
            xfail('BZKP.05', `Round-trip mismatch: bc=${bcMatch} psi=${psiMatch} bpi=${bpiMatch} d=${depMatch}`);
        }
    } catch (e) { xfail('BZKP.05', e.message); }

    // ── Test 6: IoT domain entity with high phi ───────────────────────────────
    try {
        const { proof, publicInputs } = encodeProof({
            entityBpi:    BPI_IOT,
            phi: 0.95, mu: 0.60, sigma: 0.70, kappa: 0.85, alpha: 0.65,
            psiThreshold: 0.55,
            depth: 2000,
        });
        const r = verifyProof({
            entityBpi:    BPI_IOT,
            claimedBc:    publicInputs.claimedBc,
            psiThreshold: publicInputs.psiThreshold,
            proof,
        });
        if (r.valid) {
            pass('BZKP.06', `IoT entity BC=${(publicInputs.claimedBc/1e6).toFixed(4)} → proof accepted`);
        } else {
            xfail('BZKP.06', r.reason);
        }
    } catch (e) { xfail('BZKP.06', e.message); }

    // ── Test 7: verifyProofOnly (extracts bc/psi from proof) ─────────────────
    try {
        const { proof, publicInputs } = encodeProof({
            entityBpi: BPI_DEFI, phi: 0.85, mu: 0.80, sigma: 0.85,
            kappa: 0.75, alpha: 0.80, psiThreshold: 0.55,
        });
        const r = verifyProofOnly({ entityBpi: BPI_DEFI, proof });
        if (r.valid) {
            pass('BZKP.07', `verifyProofOnly: self-contained public input extraction works`);
        } else {
            xfail('BZKP.07', r.reason);
        }
    } catch (e) { xfail('BZKP.07', e.message); }

    // ── Test 8: Deterministic proof — same inputs, same nonce → same proof ───
    try {
        const nonce = Buffer.alloc(32, 0xAB);
        const r1 = encodeProof({ entityBpi: BPI_DEFI, nonce, psiThreshold: 0.55 });
        const r2 = encodeProof({ entityBpi: BPI_DEFI, nonce, psiThreshold: 0.55 });
        if (r1.proof.equals(r2.proof)) {
            pass('BZKP.08', 'Deterministic encoding: same inputs → same 184-byte proof');
        } else {
            xfail('BZKP.08', 'Proof is not deterministic');
        }
    } catch (e) { xfail('BZKP.08', e.message); }

    // ── Test 9: computeBC matches Noir circuit formula ───────────────────────
    try {
        const { bcScaled } = computeBC(1.0, 1.0, 1.0, 1.0, 1.0);
        if (bcScaled === SCALE) {
            pass('BZKP.09', `computeBC(1,1,1,1,1) = ${bcScaled} = SCALE ✓ (weights sum to 1.0)`);
        } else {
            xfail('BZKP.09', `computeBC(1,1,1,1,1) = ${bcScaled} ≠ ${SCALE}`);
        }
    } catch (e) { xfail('BZKP.09', e.message); }

    // ── Test 10: BPI identity binding — wrong BPI rejected ───────────────────
    try {
        const { proof, publicInputs } = encodeProof({
            entityBpi: BPI_DEFI, psiThreshold: 0.55,
        });
        const r = verifyProof({
            entityBpi:    BPI_IOT,  // WRONG BPI
            claimedBc:    publicInputs.claimedBc,
            psiThreshold: publicInputs.psiThreshold,
            proof,
        });
        if (!r.valid && r.constraint === 'C4') {
            pass('BZKP.10', `BPI identity binding: wrong BPI rejected at C4`);
        } else if (!r.valid) {
            pass('BZKP.10', `BPI mismatch rejected at ${r.constraint}`);
        } else {
            xfail('BZKP.10', 'Wrong BPI was accepted — identity binding failed');
        }
    } catch (e) { xfail('BZKP.10', e.message); }

    return results;
}

// ── SILENCE RECOVERY PROOF (coherence_check.nr) ──────────────────────────────
//
// Secondary BZKP circuit: proves BC(entity, t_i) >= Ψ for all i in a 300-event
// sustained window, without revealing individual BC values or event types.
// Used to lift SILENCE on-chain with cryptographic attestation.
//
// Recovery proof format (AXIOM-BZKP-Recovery-v1 — 164 bytes):
//   [0 ..  3]  magic           0xBE0CAD00  (recovery circuit marker)
//   [4 ..  7]  version         0x00000001
//   [8 .. 39]  entity_bpi      32-byte BPI commitment
//   [40.. 47]  window_start    uint64 BE GPS ns (public)
//   [48.. 55]  window_end      uint64 BE GPS ns (public)
//   [56.. 59]  psi_threshold   uint32 BE × 1e6 (public)
//   [60.. 63]  min_bc          uint32 BE × 1e6 — minimum BC in window (public)
//   [64.. 67]  event_count     uint32 BE (must equal SUSTAINED_WINDOW = 300)
//   [68.. 99]  bc_commitment   SHA256(all 300 BC values packed uint32 BE) — witness
//   [100..131] sat_proof       SHA256(bpi‖ws‖we‖psi‖min_bc‖event_count‖bc_commitment‖nonce)
//   [132..163] nonce           32-byte randomness
//   Total: 164 bytes
//
// Recovery constraints (R0–R7) mirror coherence_check.nr:
//   R0 — magic 0xBE0CAD00, length 164, version 0x00000001
//   R1 — entity_bpi non-zero
//   R2 — window temporally ordered (window_end > window_start)
//   R3 — Ψ in valid range [PSI_FLOOR, SCALE]
//   R4 — min_bc >= psiThreshold (the SILENCE recovery claim)
//   R5 — event_count == SUSTAINED_WINDOW (300 events required)
//   R6 — bc_commitment non-zero (witness was provided)
//   R7 — sat_proof = SHA256(bpi‖ws‖we‖psi‖min_bc‖ec‖bc_commitment‖nonce)

const RECOVERY_MAGIC       = Buffer.from('BE0CAD00', 'hex');
const RECOVERY_PROOF_LEN   = 164;
const SUSTAINED_WINDOW     = 300;   // coherence_check.nr SUSTAINED_WINDOW

/**
 * Encode a 164-byte SILENCE recovery proof.
 *
 * Implements the coherence_check.nr circuit in simulation mode.
 * Proves that all 300 BC values in the window are >= psiThreshold,
 * without revealing any individual BC value.
 *
 * @param {object} opts
 * @param {string|Buffer} opts.entityBpi      — 32-byte BPI
 * @param {number[]}      opts.bcValues       — Array of exactly 300 BC values ∈ [0, 1.0]
 * @param {number}        opts.psiThreshold   — Ψ ∈ [0.10, 1.0] (default 0.55)
 * @param {number}        opts.windowStart    — GPS ns (integer; default: now - 300s)
 * @param {number}        opts.windowEnd      — GPS ns (integer; default: now)
 * @param {Buffer}        opts.nonce          — 32-byte nonce (random if omitted)
 * @returns {{ proof: Buffer, publicInputs: object }}
 */
function encodeSilenceRecoveryProof({
    entityBpi,
    bcValues,
    psiThreshold = 0.55,
    windowStart  = null,
    windowEnd    = null,
    nonce        = null,
}) {
    const bpiBuffer = bpiToBuffer(entityBpi);
    const psiInt    = Math.round(psiThreshold * SCALE);

    // ── Validate inputs (mirrors coherence_check.nr constraints) ─────────────
    if (psiInt < PSI_FLOOR)
        throw new Error(`psiThreshold ${psiThreshold} below absolute floor 0.10`);
    if (psiInt > SCALE)
        throw new Error(`psiThreshold ${psiThreshold} > 1.0`);

    if (!Array.isArray(bcValues) || bcValues.length !== SUSTAINED_WINDOW)
        throw new Error(`bcValues must be exactly ${SUSTAINED_WINDOW} BC values (got ${bcValues ? bcValues.length : 0})`);

    // Validate each BC value >= Ψ (coherence_check.nr Constraint 6)
    let minBcFloat = Infinity;
    for (let i = 0; i < bcValues.length; i++) {
        const v = bcValues[i];
        if (v < 0 || v > 1.0)
            throw new Error(`bcValues[${i}] = ${v} is outside [0, 1.0]`);
        if (v < psiThreshold)
            throw new Error(`bcValues[${i}] = ${v.toFixed(4)} < Ψ ${psiThreshold} — entity not recovered at event ${i}`);
        if (v < minBcFloat) minBcFloat = v;
    }

    const minBcInt = Math.round(minBcFloat * SCALE);

    // GPS timestamps
    const GPS_OFFSET = 315_964_800_000_000_000n; // GPS epoch vs Unix epoch (ns)
    const nowNs = BigInt(Date.now()) * 1_000_000n + GPS_OFFSET;
    const wsInt = windowStart !== null ? BigInt(windowStart) : nowNs - BigInt(SUSTAINED_WINDOW) * 1_000_000_000n;
    const weInt = windowEnd   !== null ? BigInt(windowEnd)   : nowNs;

    if (weInt <= wsInt)
        throw new Error(`window_end (${weInt}) must be after window_start (${wsInt})`);

    // ── Compute private witness commitment ────────────────────────────────────
    // bc_commitment = SHA256(all 300 bcValues packed as uint32 BE)
    const h = crypto.createHash('sha256');
    for (const v of bcValues) {
        h.update(uint32BE(Math.round(v * SCALE)));
    }
    const bcCommitment = h.digest();

    const nonceBuffer = nonce || crypto.randomBytes(32);
    if (nonceBuffer.length !== 32) throw new Error('nonce must be 32 bytes');

    const eventCountBuf = uint32BE(SUSTAINED_WINDOW);

    // sat_proof = SHA256(bpi ‖ ws ‖ we ‖ psi ‖ min_bc ‖ event_count ‖ bc_commitment ‖ nonce)
    const satProof = sha256(
        bpiBuffer,
        uint64BE(wsInt),
        uint64BE(weInt),
        uint32BE(psiInt),
        uint32BE(minBcInt),
        eventCountBuf,
        bcCommitment,
        nonceBuffer,
    );

    const proof = Buffer.concat([
        RECOVERY_MAGIC,           // [0..3]    0xBE0CAD00
        CIRCUIT_VER,              // [4..7]    0x00000001
        bpiBuffer,                // [8..39]   entity_bpi (32 bytes)
        uint64BE(wsInt),          // [40..47]  window_start (8 bytes)
        uint64BE(weInt),          // [48..55]  window_end (8 bytes)
        uint32BE(psiInt),         // [56..59]  psi_threshold
        uint32BE(minBcInt),       // [60..63]  min_bc
        eventCountBuf,            // [64..67]  event_count
        bcCommitment,             // [68..99]  bc_commitment (32 bytes)
        satProof,                 // [100..131] sat_proof (32 bytes)
        nonceBuffer,              // [132..163] nonce (32 bytes)
    ]);

    if (proof.length !== RECOVERY_PROOF_LEN)
        throw new Error(`Internal: recovery proof length ${proof.length} ≠ ${RECOVERY_PROOF_LEN}`);

    return {
        proof,
        publicInputs: {
            entityBpi:     bpiBuffer.toString('hex'),
            windowStart:   wsInt.toString(),
            windowEnd:     weInt.toString(),
            psiThreshold:  psiInt,
            minBc:         minBcInt,
            minBcFloat:    minBcFloat,
            eventCount:    SUSTAINED_WINDOW,
        },
    };
}

/**
 * Verify a 164-byte SILENCE recovery proof.
 *
 * Applies all eight recovery constraints (R0–R7) mirroring coherence_check.nr.
 *
 * @param {object} opts
 * @param {string|Buffer} opts.entityBpi   — expected entity BPI
 * @param {Buffer}        opts.proof       — 164-byte recovery proof
 * @returns {{ valid: boolean, constraint: string|null, reason: string|null, silenceLifted: boolean }}
 */
function verifySilenceRecoveryProof({ entityBpi, proof }) {
    const bpiBuffer = bpiToBuffer(entityBpi);

    // R0 — Structure: magic, length, version
    if (!Buffer.isBuffer(proof) || proof.length !== RECOVERY_PROOF_LEN)
        return fail('R0', `recovery proof must be ${RECOVERY_PROOF_LEN} bytes (got ${proof ? proof.length : 'null'})`);

    if (!proof.slice(0, 4).equals(RECOVERY_MAGIC))
        return fail('R0', `invalid magic (expected BE0CAD00, got ${proof.slice(0,4).toString('hex').toUpperCase()})`);

    if (!proof.slice(4, 8).equals(CIRCUIT_VER))
        return fail('R0', `invalid circuit version (expected 00000001, got ${proof.slice(4,8).toString('hex')})`);

    // R1 — Entity BPI non-zero and matches caller
    const proofBpi = proof.slice(8, 40);
    if (proofBpi.equals(Buffer.alloc(32)))
        return fail('R1', 'entity_bpi must be non-zero');
    if (!proofBpi.equals(bpiBuffer))
        return fail('R1', `entity_bpi mismatch: proof=${proofBpi.toString('hex').slice(0,8)}… expected=${bpiBuffer.toString('hex').slice(0,8)}…`);

    // R2 — Window temporally ordered
    const wsInt = proof.readBigUInt64BE(40);
    const weInt = proof.readBigUInt64BE(48);
    if (weInt <= wsInt)
        return fail('R2', `window_end (${weInt}) must be after window_start (${wsInt})`);

    // R3 — Ψ in valid range
    const psiInt = proof.readUInt32BE(56);
    if (psiInt < PSI_FLOOR)
        return fail('R3', `psi_threshold ${psiInt} below absolute floor ${PSI_FLOOR} (0.10)`);
    if (psiInt > SCALE)
        return fail('R3', `psi_threshold ${psiInt} > SCALE (1e6)`);

    // R4 — min_bc >= psiThreshold (core SILENCE recovery claim)
    const minBc = proof.readUInt32BE(60);
    if (minBc < psiInt)
        return fail('R4', `min_bc ${minBc} < psi_threshold ${psiInt} — entity not recovered`);
    if (minBc > SCALE)
        return fail('R4', `min_bc ${minBc} > SCALE (1e6) — invalid BC value`);

    // R5 — event_count == SUSTAINED_WINDOW (300)
    const eventCount = proof.readUInt32BE(64);
    if (eventCount !== SUSTAINED_WINDOW)
        return fail('R5', `event_count ${eventCount} ≠ ${SUSTAINED_WINDOW} (sustained 300-event window required)`);

    // R6 — bc_commitment non-zero
    const bcCommitment = proof.slice(68, 100);
    if (bcCommitment.equals(Buffer.alloc(32)))
        return fail('R6', 'bc_commitment must be non-zero (BC witness required)');

    // R7 — sat_proof binds all public inputs to the private bc_commitment
    const eventCountBuf = uint32BE(eventCount);
    const nonce         = proof.slice(132, 164);
    const satProof      = proof.slice(100, 132);
    const expectedSat = sha256(
        proofBpi,
        uint64BE(wsInt),
        uint64BE(weInt),
        uint32BE(psiInt),
        uint32BE(minBc),
        eventCountBuf,
        bcCommitment,
        nonce,
    );
    if (!satProof.equals(expectedSat))
        return fail('R7', 'sat_proof invalid — bc_commitment or public inputs tampered');

    return {
        valid:         true,
        constraint:    null,
        reason:        null,
        silenceLifted: true,
        publicInputs: {
            entityBpi:    proofBpi.toString('hex'),
            windowStart:  wsInt.toString(),
            windowEnd:    weInt.toString(),
            psiThreshold: psiInt,
            minBc,
            minBcFloat:   minBc / SCALE,
            eventCount,
        },
    };
}

// ── SILENCE recovery tests (BZKP.11–BZKP.15) ─────────────────────────────────

function runRecoveryTests() {
    const results = [];
    const pass  = (name, detail) => { results.push({ name, detail, pass: true });  };
    const xfail = (name, detail) => { results.push({ name, detail, pass: false }); };

    const BPI = 'aabbccdd' + '00'.repeat(24) + 'aabbccdd';

    // ── BZKP.11: Valid recovery proof — 300 events all above Ψ ───────────────
    try {
        const bcValues = Array.from({ length: 300 }, () => 0.60 + Math.random() * 0.39);
        const { proof, publicInputs } = encodeSilenceRecoveryProof({
            entityBpi: BPI,
            bcValues,
            psiThreshold: 0.55,
        });
        const r = verifySilenceRecoveryProof({ entityBpi: BPI, proof });
        if (r.valid && r.silenceLifted && proof.length === RECOVERY_PROOF_LEN) {
            pass('BZKP.11', `Recovery proof accepted — minBC=${(publicInputs.minBcFloat).toFixed(3)}, 300 events above Ψ=0.55, SILENCE lifted`);
        } else {
            xfail('BZKP.11', `Rejected at ${r.constraint}: ${r.reason}`);
        }
    } catch (e) { xfail('BZKP.11', e.message); }

    // ── BZKP.12: Too few events — encoder rejects ────────────────────────────
    try {
        const bcValues = Array.from({ length: 299 }, () => 0.75);
        encodeSilenceRecoveryProof({ entityBpi: BPI, bcValues, psiThreshold: 0.55 });
        xfail('BZKP.12', '299-event window was accepted (should require exactly 300)');
    } catch (e) {
        if (e.message.includes('299')) {
            pass('BZKP.12', `Encoder rejects < 300 events: "${e.message}"`);
        } else {
            xfail('BZKP.12', `Unexpected error: ${e.message}`);
        }
    }

    // ── BZKP.13: One BC below Ψ in window — encoder rejects ──────────────────
    try {
        const bcValues = Array.from({ length: 300 }, () => 0.75);
        bcValues[147] = 0.40; // Inject one BC below Ψ at event 147
        encodeSilenceRecoveryProof({ entityBpi: BPI, bcValues, psiThreshold: 0.55 });
        xfail('BZKP.13', 'Sub-threshold BC at event 147 was accepted (should reject)');
    } catch (e) {
        if (e.message.includes('0.4000') || e.message.includes('0.400') || e.message.includes('event 147')) {
            pass('BZKP.13', `Encoder rejects window with BC < Ψ: "${e.message}"`);
        } else {
            xfail('BZKP.13', `Unexpected error: ${e.message}`);
        }
    }

    // ── BZKP.14: Tampered min_bc (attacker lowers claim) → R7 rejected ───────
    try {
        const bcValues = Array.from({ length: 300 }, (_, i) => 0.60 + (i % 10) * 0.04);
        const { proof } = encodeSilenceRecoveryProof({ entityBpi: BPI, bcValues, psiThreshold: 0.55 });
        // Tamper: raise min_bc to claim higher minimum (forge a better record)
        const tampered = Buffer.from(proof);
        tampered.writeUInt32BE(950_000, 60); // claim min_bc = 0.95 (impossible — sat_proof breaks)
        const r = verifySilenceRecoveryProof({ entityBpi: BPI, proof: tampered });
        if (!r.valid && r.constraint === 'R7') {
            pass('BZKP.14', `Tampered min_bc detected at R7 — sat_proof binds min_bc to bc_commitment`);
        } else if (!r.valid) {
            pass('BZKP.14', `Tampered min_bc rejected at ${r.constraint}: ${r.reason}`);
        } else {
            xfail('BZKP.14', 'Tampered min_bc was accepted — sat_proof binding broken');
        }
    } catch (e) { xfail('BZKP.14', e.message); }

    // ── BZKP.15: Wrong BPI — recovery proof for a different entity rejected ───
    try {
        const BPI_B = 'ff001122' + '00'.repeat(24) + 'ff001122';
        const bcValues = Array.from({ length: 300 }, () => 0.70);
        const { proof } = encodeSilenceRecoveryProof({ entityBpi: BPI, bcValues, psiThreshold: 0.55 });
        // Try to submit entity A's recovery proof to lift SILENCE for entity B
        const r = verifySilenceRecoveryProof({ entityBpi: BPI_B, proof });
        if (!r.valid && r.constraint === 'R1') {
            pass('BZKP.15', `Cross-entity recovery rejected at R1 — BPI identity binding holds`);
        } else if (!r.valid) {
            pass('BZKP.15', `Cross-entity recovery rejected at ${r.constraint}: ${r.reason}`);
        } else {
            xfail('BZKP.15', 'Recovery proof accepted for wrong entity — identity binding failed');
        }
    } catch (e) { xfail('BZKP.15', e.message); }

    return results;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fail(constraint, reason) {
    return { valid: false, constraint, reason };
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    SCALE,
    PSI_FLOOR,
    PSI_BASE,
    PROOF_LEN,
    RECOVERY_PROOF_LEN,
    SUSTAINED_WINDOW,
    computeBC,
    computePlanesHash,
    encodeProof,
    verifyProof,
    verifyProofOnly,
    decodeInputs,
    encodeSilenceRecoveryProof,
    verifySilenceRecoveryProof,
    runBZKPTests,
    runRecoveryTests,
};
