const express = require('express');
const path = require('path');
const { execSync, execFile } = require('child_process');

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

// ── Layer Status ─────────────────────────────────────────────────────────────
app.get('/api/axiom/layers', (req, res) => {
    res.json({
        layers: [
            { id: 'L0', name: 'Physical Reality Substrate',   inventions: [1, 2],
              desc: 'GPS entropy, HSM attestation, physical continuity verification',
              status: 'active', lang: 'Rust' },
            { id: 'L1', name: 'Universal Behavioral Hash Engine', inventions: [3, 4, 5],
              desc: '32 UBE types, Blake3 self-hash, causal chain, BPI binding',
              status: 'active', lang: 'Rust' },
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

    res.json({ ok: allOk, results });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`AXIOM Dashboard running on http://0.0.0.0:${PORT}`);
    console.log(`Version: D(AXIOM,t) — 7 layers, 19 inventions`);
});
