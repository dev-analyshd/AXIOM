const express = require('express');
const path = require('path');

const app = express();
const PORT = 5000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/axiom/compute', (req, res) => {
    const bc = parseFloat(req.query.bc) || 0.8;
    const psi = parseFloat(req.query.psi) || 0.55;
    const epsilon = parseFloat(req.query.epsilon) || 1.0;
    const lambda = parseFloat(req.query.lambda) || 0.001;
    const depth = parseFloat(req.query.depth) || 1000.0;

    const coherenceGate = bc >= psi ? 1.0 : 0.0;
    const xi = coherenceGate * epsilon * Math.exp(lambda * depth);

    const psiBase = 0.55;
    const threat = parseFloat(req.query.threat) || 0;
    const volatility = parseFloat(req.query.volatility) || 0;
    const dynamicPsi = Math.max(0.10, Math.min(0.99,
        psiBase + 0.20 * threat + 0.10 * volatility - 0.05 * Math.log(1 + depth)
    ));

    res.json({
        xi: xi,
        bc: bc,
        psi: dynamicPsi,
        silenced: bc < dynamicPsi,
        depth: depth,
        govWeight: bc * depth * 0.8,
        moat: 0.001 * 1.0 * 0.8 * depth,
    });
});

app.get('/api/axiom/resonance', (req, res) => {
    const n = 32;
    const rfA = Array.from({ length: n }, () => Math.random());
    const rfB = Array.from({ length: n }, () => Math.random());

    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < n; i++) {
        dot += rfA[i] * rfB[i];
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`AXIOM Dashboard running on http://0.0.0.0:${PORT}`);
});
