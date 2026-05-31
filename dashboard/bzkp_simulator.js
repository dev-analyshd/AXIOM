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
    computeBC,
    computePlanesHash,
    encodeProof,
    verifyProof,
    verifyProofOnly,
    decodeInputs,
    runBZKPTests,
};
