const express = require('express');
const path = require('path');
const { execSync, execFile } = require('child_process');
const bzkp = require('./bzkp_simulator');

const app = express();
const PORT = 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── AXIOM Master Equation ────────────────────────────────────────────────────
app.get('/api/axiom/compute', (req, res) => {
    const bc         = parseFloat(req.query.bc)         || 0.8;
    const psi        = parseFloat(req.query.psi)        || 0.55;
    const epsilon    = parseFloat(req.query.epsilon)    || 1.0;
    const lambda     = parseFloat(req.query.lambda)     || 0.001;
    const depth      = parseFloat(req.query.depth)      || 1000.0;
    const threat     = parseFloat(req.query.threat)     || 0;
    const volatility = parseFloat(req.query.volatility) || 0;
    const love       = parseFloat(req.query.love)       || 1.0;
    const roleMult   = parseFloat(req.query.roleMult)   || 1.0;

    const coherenceGate = bc >= psi ? 1.0 : 0.0;
    const xi = coherenceGate * epsilon * Math.exp(lambda * depth);

    const dynamicPsi = Math.max(0.10, Math.min(0.99,
        0.55 + 0.20 * threat + 0.10 * volatility - 0.05 * Math.log(1 + depth)
    ));

    // GovWeight = BC × D × Love  (whitepaper §8)
    const govWeight = bc * depth * love;

    // Living Moat rate Λ = Λ_base × Role_Mult × Love  (whitepaper §4.4)
    const livingMoat = 0.001 * roleMult * love;

    res.json({
        xi, bc,
        psi: dynamicPsi,
        silenced: bc < dynamicPsi,
        depth,
        love,
        govWeight,
        livingMoat,
    });
});

// ── RCP Resonance ────────────────────────────────────────────────────────────
app.get('/api/axiom/resonance', (req, res) => {
    const n   = 32;
    const rfA = Array.from({ length: n }, () => Math.random());
    const rfB = Array.from({ length: n }, () => Math.random());

    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < n; i++) {
        dot   += rfA[i] * rfB[i];
        normA += rfA[i] * rfA[i];
        normB += rfB[i] * rfB[i];
    }
    const resonance = dot / (Math.sqrt(normA) * Math.sqrt(normB));

    let tier = 'no_connection';
    if (resonance > 0.50) tier = 'high_bandwidth';
    else if (resonance > 0.15) tier = 'standard';
    else if (resonance > 0.05) tier = 'emergency_only';

    res.json({ resonance, tier, rfA, rfB });
});

// ── Five-Plane BC Computation ────────────────────────────────────────────────
app.get('/api/axiom/bc', (req, res) => {
    const phi   = parseFloat(req.query.phi)   || 0.8;
    const mu    = parseFloat(req.query.mu)    || 0.8;
    const sigma = parseFloat(req.query.sigma) || 0.8;
    const kappa = parseFloat(req.query.kappa) || 0.8;
    const alpha = parseFloat(req.query.alpha) || 0.8;
    const domain = req.query.domain || 'standard';

    // Domain weight profiles — aligned to whitepaper §4.8 [φ, μ, σ, κ, α]
    const profiles = {
        standard:   [0.25, 0.20, 0.25, 0.15, 0.15],
        financial:  [0.30, 0.25, 0.30, 0.10, 0.05],
        iot:        [0.40, 0.15, 0.20, 0.15, 0.10],
        ai:         [0.20, 0.30, 0.15, 0.10, 0.25],
        governance: [0.20, 0.20, 0.30, 0.20, 0.10],
        healthcare: [0.25, 0.30, 0.20, 0.15, 0.10],
    };
    const w = profiles[domain] || profiles.standard;
    const bc = Math.max(0, Math.min(1,
        w[0]*phi + w[1]*mu + w[2]*sigma + w[3]*kappa + w[4]*alpha
    ));
    res.json({ bc, phi, mu, sigma, kappa, alpha, domain, weights: w });
});

// ── BZKP: Prove BC >= Ψ without revealing plane values (Invention #4) ────────
app.post('/api/axiom/bzkp/prove', (req, res) => {
    try {
        const {
            entityBpi    = '0x' + 'ab'.repeat(32),
            phi          = 0.85,
            mu           = 0.80,
            sigma        = 0.85,
            kappa        = 0.75,
            alpha        = 0.80,
            psiThreshold = 0.55,
            depth        = 1000,
        } = req.body || {};

        const result = bzkp.encodeProof({ entityBpi, phi, mu, sigma, kappa, alpha, psiThreshold, depth });

        res.json({
            ok: true,
            publicInputs:   result.publicInputs,
            planes:         result.planes,
            proofHex:       result.proof.toString('hex'),
            proofLength:    result.proof.length,
            proofFormat:    'AXIOM-BZKP-v1 simulation (184 bytes)',
            productionPath: 'Run `nargo prove` to generate a Barretenberg UltraPlonk proof (~2KB)',
            circuits: [
                'circuits/src/main.nr           — BC >= Ψ single-shot proof',
                'circuits/src/coherence_check.nr — 300-event SILENCE recovery window',
                'circuits/src/temporal_cluster.nr — 365-day annual behavioral cluster',
            ],
        });
    } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});

app.post('/api/axiom/bzkp/verify', (req, res) => {
    try {
        const { entityBpi, claimedBc, psiThreshold, proofHex } = req.body || {};

        if (!proofHex) return res.status(400).json({ ok: false, error: 'proofHex required' });

        const proof = Buffer.from(proofHex, 'hex');
        const decoded = bzkp.decodeInputs(proof);

        const bc  = claimedBc    !== undefined ? claimedBc    : decoded.claimedBc;
        const psi = psiThreshold !== undefined ? psiThreshold : decoded.psiThreshold;
        const bpi = entityBpi    !== undefined ? entityBpi    : '0x' + decoded.entityBpiHash;

        const result = bzkp.verifyProof({ entityBpi: bpi, claimedBc: bc, psiThreshold: psi, proof });

        res.json({
            ok:            result.valid,
            valid:         result.valid,
            constraint:    result.constraint,
            reason:        result.reason,
            publicInputs:  decoded,
            mode:          'simulation (BehavioralZKVerifier.sol constraint checks)',
        });
    } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});

// ── Layer Status ─────────────────────────────────────────────────────────────
app.get('/api/axiom/layers', (req, res) => {
    res.json({
        layers: [
            { id: 'L0', name: 'Physical Reality Substrate',   inventions: [1, 2],
              desc: 'GPS entropy, HSM attestation, physical continuity verification',
              status: 'active', lang: 'Rust' },
            { id: 'L1', name: 'Universal Behavioral Hash Engine', inventions: [3, 4, 5],
              desc: '32 UBE types, Blake3 self-hash, causal chain, BPI binding, BZKP (Noir)',
              status: 'active', lang: 'Rust + Noir' },
            { id: 'L2', name: 'Entity Resolution',            inventions: [10, 14, 15],
              desc: 'BPI causal identity, BEO cross-stream resolver, ODI, RF vectors',
              status: 'active', lang: 'Rust + Python' },
            { id: 'L3', name: 'Living Akashic Index',         inventions: [6, 13],
              desc: 'Append-only behavioral ledger, TimescaleDB, Redis hot cache',
              status: 'active', lang: 'Rust' },
            { id: 'L4', name: 'Behavioral Coherence Engine',  inventions: [7, 8, 16],
              desc: 'Five-plane BC model, dynamic Ψ threshold, LSTM trajectory',
              status: 'active', lang: 'Python' },
            { id: 'L5', name: 'Living Kernel',                inventions: [9, 11, 17, 18, 19],
              desc: 'CBRA scheduler, BIS interrupts, IKP immunity, BFS, LBP',
              status: 'active', lang: 'Rust' },
            { id: 'L6', name: 'Resonance Communication Protocol', inventions: [12],
              desc: 'Behavior-based routing, cosine RF similarity, TTL hop routing',
              status: 'active', lang: 'Go' },
        ],
        inventions: 19,
        version: 'D(AXIOM,t)',
    });
});

// ── System Health ─────────────────────────────────────────────────────────────
app.get('/api/axiom/health', (req, res) => {
    res.json({
        status: 'healthy',
        version: 'D(AXIOM,t)',
        uptime: process.uptime(),
        layers: 7,
        inventions: 19,
        timestamp: Date.now(),
    });
});

// ── Run Integration Tests (on-demand) ─────────────────────────────────────────
app.post('/api/axiom/test', (req, res) => {
    const layer = req.body && req.body.layer;

    if (layer === 'rust' || layer === 'L0-L5') {
        try {
            const out = execSync(
                'cargo run --bin axiom-integration 2>&1',
                { timeout: 120000, cwd: path.join(__dirname, '..') }
            ).toString();
            const passed = (out.match(/\[.*PASS.*\]/g) || []).length;
            const failed = (out.match(/\[.*FAIL.*\]/g) || []).length;
            return res.json({ ok: failed === 0, passed, failed, output: out.slice(-3000) });
        } catch (e) {
            return res.json({ ok: false, error: e.message, output: (e.stdout || '').toString().slice(-3000) });
        }
    }

    if (layer === 'python' || layer === 'L4') {
        try {
            const out = execSync(
                'python3 axiom-coherence/tests/test_coherence.py 2>&1',
                { timeout: 60000, cwd: path.join(__dirname, '..') }
            ).toString();
            const passed = (out.match(/\[.*PASS.*\]/g) || []).length;
            const failed = (out.match(/\[.*FAIL.*\]/g) || []).length;
            return res.json({ ok: failed === 0, passed, failed, output: out.slice(-3000) });
        } catch (e) {
            return res.json({ ok: false, error: e.message,
                output: ((e.stdout || '') + (e.stderr || '')).toString().slice(-3000) });
        }
    }

    if (layer === 'go' || layer === 'L6') {
        try {
            const out = execSync(
                'go test ./rcp/... -v -timeout 30s 2>&1',
                { timeout: 60000, cwd: path.join(__dirname, '../axiom-rcp') }
            ).toString();
            const passed = (out.match(/--- PASS/g) || []).length;
            const failed = (out.match(/--- FAIL/g) || []).length;
            return res.json({ ok: failed === 0, passed, failed, output: out.slice(-3000) });
        } catch (e) {
            return res.json({ ok: false, error: e.message,
                output: ((e.stdout || '') + (e.stderr || '')).toString().slice(-3000) });
        }
    }

    // All layers
    const results = {};
    let allOk = true;

    // Rust
    try {
        const out = execSync(
            'cargo run --bin axiom-integration 2>&1',
            { timeout: 120000, cwd: path.join(__dirname, '..') }
        ).toString();
        results.rust = {
            ok: !out.includes('FAIL'),
            passed: (out.match(/\[.*PASS.*\]/g) || []).length,
            failed: (out.match(/\[.*FAIL.*\]/g) || []).length,
            output: out.slice(-2000),
        };
        if (!results.rust.ok) allOk = false;
    } catch (e) {
        results.rust = { ok: false, error: e.message };
        allOk = false;
    }

    // Python
    try {
        const out = execSync(
            'python3 axiom-coherence/tests/test_coherence.py 2>&1',
            { timeout: 60000, cwd: path.join(__dirname, '..') }
        ).toString();
        results.python = {
            ok: !out.includes('FAIL'),
            passed: (out.match(/\[.*PASS.*\]/g) || []).length,
            failed: (out.match(/\[.*FAIL.*\]/g) || []).length,
            output: out.slice(-2000),
        };
        if (!results.python.ok) allOk = false;
    } catch (e) {
        results.python = { ok: false, error: e.message };
        allOk = false;
    }

    // Go
    try {
        const out = execSync(
            'go test ./rcp/... -v -timeout 30s 2>&1',
            { timeout: 60000, cwd: path.join(__dirname, '../axiom-rcp') }
        ).toString();
        results.go = {
            ok: !out.includes('FAIL'),
            passed: (out.match(/--- PASS/g) || []).length,
            failed: (out.match(/--- FAIL/g) || []).length,
            output: out.slice(-2000),
        };
        if (!results.go.ok) allOk = false;
    } catch (e) {
        results.go = { ok: false, error: e.message };
        allOk = false;
    }

    // BZKP — Noir circuits + BehavioralZKVerifier (JS simulation)
    try {
        const testResults = bzkp.runBZKPTests();
        const passed = testResults.filter(r => r.pass).length;
        const failed = testResults.filter(r => !r.pass).length;
        const lines = testResults.map(r => {
            const status = r.pass ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
            return `  ${status} ${r.name}  ${r.detail}`;
        });
        const header = '\x1b[1m═══ Invention #4 · BZKP — Behavioral Zero-Knowledge Proofs (Noir) ═══\x1b[0m';
        const summary = `\n  Passed: ${passed}  Failed: ${failed}  Total: ${testResults.length}`;
        const mode = '  Mode: simulation (BehavioralZKVerifier.sol constraints in JS)';
        const noir = '  Noir:  circuits/src/main.nr + coherence_check.nr + temporal_cluster.nr';
        const sol  = '  Contract: contracts/contracts/BehavioralZKVerifier.sol';
        const output = [header, ...lines, summary, mode, noir, sol].join('\n');
        results.bzkp = {
            ok: failed === 0,
            passed,
            failed,
            output,
            tests: testResults,
        };
        if (failed > 0) allOk = false;
    } catch (e) {
        results.bzkp = { ok: false, error: e.message };
        allOk = false;
    }

    res.json({ ok: allOk, results });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`AXIOM Dashboard running on http://0.0.0.0:${PORT}`);
    console.log(`Version: D(AXIOM,t) — 7 layers, 19 inventions`);
});
