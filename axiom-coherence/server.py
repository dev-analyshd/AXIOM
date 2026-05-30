"""
AXIOM Coherence Engine — HTTP REST API server (Layer 4).

Exposes the CoherenceEngine over HTTP so all other layers can query it.

Endpoints:
  POST /events          — submit a UBH behavioral event
  GET  /truth-state/<bpi_hex>  — get Ξ(entity,t) truth state
  POST /threat/<bpi_hex>       — raise threat level for entity
  GET  /metrics         — engine performance metrics
  GET  /health          — liveness check
"""

import os
import time
import logging
import structlog
from flask import Flask, request, jsonify
from axiom_coherence import CoherenceEngine
from axiom_coherence.planes import compute_bc

structlog.configure(
    wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
)
logger = structlog.get_logger()

app = Flask(__name__)
engine = CoherenceEngine()

# ── Routes ───────────────────────────────────────────────────────────────────

@app.post("/events")
def submit_event():
    """
    Process a UBH behavioral event.

    Body JSON:
      entity_bpi   (hex string)   — 32-byte entity BPI
      event_type   (int 1-32)     — UBE type
      bc_at_event  (float 0-1)    — BC at event time
      depth_at_event (float ≥ 0)  — Akashic depth
      gps_timestamp  (int)        — GPS nanoseconds
    """
    data = request.get_json(force=True, silent=True) or {}
    bpi_hex = data.get("entity_bpi", "")
    try:
        bpi = bytes.fromhex(bpi_hex) if bpi_hex else bytes(32)
    except ValueError:
        return jsonify({"error": "invalid entity_bpi hex"}), 400

    event = {
        "entity_bpi":    bpi,
        "event_type":    int(data.get("event_type", 1)),
        "bc_at_event":   float(data.get("bc_at_event", 0.8)),
        "depth_at_event": float(data.get("depth_at_event", 0.0)),
        "gps_timestamp": int(data.get("gps_timestamp", time.time_ns())),
        "self_hash":     data.get("self_hash", ""),
        "prior_hash":    data.get("prior_hash", ""),
    }

    update = engine.process_event(event)
    if update is None:
        state = engine.get_truth_state(bpi)
        return jsonify({"status": "ok", "significant_change": False,
                        "truth_state": state}), 200

    update_serializable = dict(update)
    if isinstance(update_serializable.get("entity_bpi"), bytes):
        update_serializable["entity_bpi"] = update_serializable["entity_bpi"].hex()

    return jsonify({"status": "ok", "significant_change": True,
                    "coherence_update": update_serializable}), 200


@app.get("/truth-state/<bpi_hex>")
def get_truth_state(bpi_hex: str):
    """Return Ξ(entity,t) truth state for an entity."""
    try:
        bpi = bytes.fromhex(bpi_hex)
    except ValueError:
        return jsonify({"error": "invalid bpi_hex"}), 400

    state = engine.get_truth_state(bpi)
    if state is None:
        return jsonify({"error": "entity not found"}), 404
    return jsonify(state), 200


@app.post("/threat/<bpi_hex>")
def raise_threat(bpi_hex: str):
    """Raise Ψ threshold for an entity under attack."""
    try:
        bpi = bytes.fromhex(bpi_hex)
    except ValueError:
        return jsonify({"error": "invalid bpi_hex"}), 400

    data = request.get_json(force=True, silent=True) or {}
    threat = float(data.get("threat_level", 0.5))
    engine.raise_threat_level(bpi, threat)
    state = engine.get_truth_state(bpi)
    return jsonify({"status": "ok", "new_psi": state["psi"] if state else None}), 200


@app.get("/metrics")
def get_metrics():
    """Return engine performance metrics."""
    return jsonify(engine.metrics()), 200


@app.get("/health")
def health():
    """Liveness check."""
    m = engine.metrics()
    return jsonify({
        "status": "healthy",
        "version": "D(AXIOM,t)",
        "layer": "L4-CoherenceEngine",
        **m
    }), 200


@app.get("/bc")
def compute_bc_inline():
    """
    Inline BC computation without entity tracking.

    Query params: phi, mu, sigma, kappa, alpha, domain
    """
    try:
        phi   = float(request.args.get("phi",   0.8))
        mu    = float(request.args.get("mu",    0.8))
        sigma = float(request.args.get("sigma", 0.8))
        kappa = float(request.args.get("kappa", 0.8))
        alpha = float(request.args.get("alpha", 0.8))
        domain = request.args.get("domain", "standard")
    except ValueError:
        return jsonify({"error": "invalid plane value"}), 400

    bc = compute_bc(phi, mu, sigma, kappa, alpha, domain)
    return jsonify({"bc": bc, "domain": domain}), 200


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("COHERENCE_PORT", 5001))
    logger.info("AXIOM Coherence HTTP server starting",
                port=port, layer="L4")
    app.run(host="0.0.0.0", port=port, debug=False)
