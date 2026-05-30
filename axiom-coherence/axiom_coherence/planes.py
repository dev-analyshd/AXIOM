"""
Five-Plane Behavioral Coherence Model.

BC(entity, t) = α·Φ + β·M + γ·Σ + δ·K + ε·A

Where:
    Φ (phi)   = Causal Flux / Entropy plane  — weight α = 0.25
    M (mu)    = Model Confidence plane        — weight β = 0.20
    Σ (sigma) = Network Consensus plane       — weight γ = 0.25
    K (kappa) = Environmental Context plane   — weight δ = 0.15
    A (alpha) = Adaptive Intelligence plane   — weight ε = 0.15

All planes ∈ [0, 1], result BC ∈ [0, 1].

Domain-specific weight profiles allow tuning for deployment context
(Financial, IoT, AI, Governance, Healthcare) while keeping the same
formula structure.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
import math

# ── Standard AXIOM plane weights (whitepaper §4.2) ──────────────────────────
ALPHA   = 0.25  # Φ causal flux / entropy
BETA    = 0.20  # M model confidence
GAMMA   = 0.25  # Σ network consensus
DELTA   = 0.15  # K environmental context
EPSILON = 0.15  # A adaptive intelligence

# Verify weights sum to 1.0
_WEIGHT_SUM = ALPHA + BETA + GAMMA + DELTA + EPSILON
assert abs(_WEIGHT_SUM - 1.0) < 1e-9, \
    f"Plane weights must sum to 1.0, got {_WEIGHT_SUM}"

# ── Dynamic threshold constants (whitepaper §4.3) ───────────────────────────
PSI_BASE     = 0.55   # Ψ_base
ALPHA_THREAT = 0.20   # α_threat — threat sensitivity
BETA_VOL     = 0.10   # β_vol   — volatility sensitivity
GAMMA_DEPTH  = 0.05   # γ_depth — depth discount factor


# ── Domain-Specific BC Weight Profiles ──────────────────────────────────────
#
# Different deployment domains emphasize different behavioral planes.
# All profiles must sum to 1.0.

@dataclass(frozen=True)
class BCWeightProfile:
    """BC plane weight profile for a specific domain."""
    name:    str
    phi:     float  # α — Causal Flux / Entropy
    mu:      float  # β — Model Confidence
    sigma:   float  # γ — Network Consensus
    kappa:   float  # δ — Environmental Context
    alpha:   float  # ε — Adaptive Intelligence

    def __post_init__(self) -> None:
        total = self.phi + self.mu + self.sigma + self.kappa + self.alpha
        assert abs(total - 1.0) < 1e-9, \
            f"Profile '{self.name}' weights must sum to 1.0, got {total}"

    def compute_bc(
        self,
        phi:   float,
        mu:    float,
        sigma: float,
        kappa: float,
        alpha: float,
    ) -> float:
        """Compute BC using this domain's weight profile."""
        score = (
            self.phi   * phi +
            self.mu    * mu +
            self.sigma * sigma +
            self.kappa * kappa +
            self.alpha * alpha
        )
        return max(0.0, min(1.0, score))


# Standard AXIOM profile (default)
PROFILE_STANDARD = BCWeightProfile(
    name="standard",
    phi=0.25, mu=0.20, sigma=0.25, kappa=0.15, alpha=0.15,
)

# Financial (DeFi, trading): causal integrity + model confidence + network consensus
# Whitepaper §4.8: φ=0.30, μ=0.25, σ=0.30, κ=0.10, α=0.05
PROFILE_FINANCIAL = BCWeightProfile(
    name="financial",
    phi=0.30, mu=0.25, sigma=0.30, kappa=0.10, alpha=0.05,
)

# IoT / Sensor Networks: causal continuity + environmental context primary
# Whitepaper §4.8: φ=0.40, μ=0.15, σ=0.20, κ=0.15, α=0.10
PROFILE_IOT = BCWeightProfile(
    name="iot",
    phi=0.40, mu=0.15, sigma=0.20, kappa=0.15, alpha=0.10,
)

# AI Models: model confidence + adaptive intelligence emphasized
PROFILE_AI = BCWeightProfile(
    name="ai",
    phi=0.20, mu=0.30, sigma=0.15, kappa=0.10, alpha=0.25,
)

# Governance / DAO: network consensus is paramount
# Whitepaper §4.8: φ=0.20, μ=0.20, σ=0.30, κ=0.20, α=0.10
PROFILE_GOVERNANCE = BCWeightProfile(
    name="governance",
    phi=0.20, mu=0.20, sigma=0.30, kappa=0.20, alpha=0.10,
)

# Healthcare: model confidence (diagnostic accuracy) + causal continuity
# Whitepaper §4.8: φ=0.25, μ=0.30, σ=0.20, κ=0.15, α=0.10
PROFILE_HEALTHCARE = BCWeightProfile(
    name="healthcare",
    phi=0.25, mu=0.30, sigma=0.20, kappa=0.15, alpha=0.10,
)

# Registry of all named profiles
DOMAIN_PROFILES: Dict[str, BCWeightProfile] = {
    "standard":   PROFILE_STANDARD,
    "financial":  PROFILE_FINANCIAL,
    "iot":        PROFILE_IOT,
    "ai":         PROFILE_AI,
    "governance": PROFILE_GOVERNANCE,
    "healthcare": PROFILE_HEALTHCARE,
}


def get_profile(domain: str) -> BCWeightProfile:
    """Return the BC weight profile for the given domain name."""
    return DOMAIN_PROFILES.get(domain.lower(), PROFILE_STANDARD)


# ── Core Data Types ──────────────────────────────────────────────────────────

@dataclass
class CoherencePlanes:
    """Five-plane coherence scores for one entity at one time."""
    phi:   float  # Causal Flux / Entropy ∈ [0,1]
    mu:    float  # Model Confidence ∈ [0,1]
    sigma: float  # Network Consensus ∈ [0,1]
    kappa: float  # Environmental Context ∈ [0,1]
    alpha: float  # Adaptive Intelligence ∈ [0,1]

    def bc(self, profile: Optional[BCWeightProfile] = None) -> float:
        """
        Compute BC(entity, t) = α·Φ + β·M + γ·Σ + δ·K + ε·A.

        Uses PROFILE_STANDARD by default; pass a domain profile for
        domain-specific deployment.
        """
        p = profile or PROFILE_STANDARD
        score = (
            p.phi   * self.phi +
            p.mu    * self.mu +
            p.sigma * self.sigma +
            p.kappa * self.kappa +
            p.alpha * self.alpha
        )
        return max(0.0, min(1.0, score))

    def dominant_drag_plane(self, profile: Optional[BCWeightProfile] = None) -> str:
        """Identify which plane is dragging coherence down most."""
        p = profile or PROFILE_STANDARD
        weighted = {
            'phi':   p.phi   * self.phi,
            'mu':    p.mu    * self.mu,
            'sigma': p.sigma * self.sigma,
            'kappa': p.kappa * self.kappa,
            'alpha': p.alpha * self.alpha,
        }
        return min(weighted, key=weighted.get)  # lowest weighted = greatest drag

    # Alias for backward compatibility
    dominant_plane = dominant_drag_plane

    def as_vector(self) -> Tuple[float, float, float, float, float]:
        """Return plane scores as a tuple."""
        return (self.phi, self.mu, self.sigma, self.kappa, self.alpha)


# ── Free Functions ───────────────────────────────────────────────────────────

def compute_bc(
    phi:   float,
    mu:    float,
    sigma: float,
    kappa: float,
    alpha: float,
    domain: str = "standard",
) -> float:
    """Compute BC(entity, t) from five raw plane values."""
    profile = get_profile(domain)
    return profile.compute_bc(phi, mu, sigma, kappa, alpha)


def dynamic_threshold(
    psi_base:     float = PSI_BASE,
    threat_level: float = 0.0,
    volatility:   float = 0.0,
    depth:        float = 0.0,
    alpha_threat: float = ALPHA_THREAT,
    beta_vol:     float = BETA_VOL,
    gamma_depth:  float = GAMMA_DEPTH,
) -> float:
    """
    Ψ(entity, t) = Ψ_base + α_threat·ThreatLevel + β_vol·Volatility − γ_depth·log(1+D)

    Dynamic coherence threshold that adapts to:
    - Threat level (raises during active attacks)
    - Volatility (raises in uncertain conditions)
    - Depth (lowers for deeply-established entities — earned trust)
    """
    psi = (
        psi_base
        + alpha_threat * threat_level
        + beta_vol     * volatility
        - gamma_depth  * math.log(1.0 + depth)
    )
    return max(0.10, min(0.99, psi))


def compute_phi(events: list) -> float:
    """
    Φ: Causal Flux / Entropy plane.

    Measures causal continuity — how smoothly behavior transitions.
    High Φ: smooth causal chain, expected transitions.
    Low Φ: abrupt transitions, hash chain breaks, entropy spikes.

    Formula:
        Φ = 1 - (causal_breaks / total_events)
        Where causal_break = UBH[n].prior_hash ≠ UBH[n-1].self_hash
    """
    if not events:
        return 0.5  # Unknown — return default

    total  = len(events)
    breaks = 0

    for i in range(1, total):
        prev = events[i - 1]
        curr = events[i]
        if hasattr(prev, 'self_hash') and hasattr(curr, 'prior_hash'):
            if prev.self_hash != curr.prior_hash:
                breaks += 1
        elif isinstance(prev, dict) and isinstance(curr, dict):
            if prev.get('self_hash') != curr.get('prior_hash'):
                breaks += 1

    return 1.0 - (breaks / total)


def compute_mu(events: list, trajectory_model=None) -> float:
    """
    M: Model Confidence plane.

    Measures how well the entity's behavior matches the L4 LSTM prediction.
    High M: behavior is predictable within the entity's own established patterns.
    Low M: behavior deviates significantly from the trajectory model's prediction.

    Formula:
        M = 1 - P(anomaly | trajectory_model)
    """
    if trajectory_model is None or not events:
        return 0.8  # Default confidence without model

    last_event_type = getattr(events[-1], 'event_type', 1)
    if isinstance(events[-1], dict):
        last_event_type = events[-1].get('event_type', 1)

    try:
        prob = trajectory_model.probability_of(last_event_type)
        return max(0.0, min(1.0, prob * 32.0))
    except Exception:
        return 0.8


def compute_sigma(
    events: list,
    validator_signatures: Optional[Dict] = None,
) -> float:
    """
    Σ: Network Consensus plane.

    Measures agreement among validator nodes about this entity's behavior.
    High Σ: multiple independent validators agree on BC score.
    Low Σ: validator disagreement, possible Sybil attack or network partition.

    Formula:
        Σ = (agreeing_validators / total_validators) × (1 - byzantine_ratio)
    """
    if not events:
        return 0.5

    if validator_signatures is None:
        return 0.70  # Moderate consensus without validator data

    total_validators = len(validator_signatures)
    if total_validators == 0:
        return 0.5

    signed_validators = sum(1 for sig in validator_signatures.values() if sig is not None)
    return min(1.0, signed_validators / max(1, total_validators))


def compute_kappa(
    events:             list,
    current_context:    Optional[Dict] = None,
    historical_context: Optional[Dict] = None,
) -> float:
    """
    K: Environmental Context plane.

    Measures consistency between current behavioral context and expected context.
    High K: entity is operating in its known environment.
    Low K: entity is in unexpected context (stolen device, location anomaly).

    Formula:
        K = similarity(current_context, historical_context)
    """
    if not events:
        return 0.5

    if current_context is None or historical_context is None:
        return 0.75

    signals: List[float] = []

    # Network context
    curr_net = current_context.get('network_hash', '')
    hist_net = historical_context.get('network_hash', '')
    if curr_net and hist_net:
        signals.append(1.0 if curr_net == hist_net else 0.3)

    # Time-of-day pattern
    curr_hour = current_context.get('hour_of_day', -1)
    hist_hours = historical_context.get('typical_hours', [])
    if curr_hour >= 0 and hist_hours:
        signals.append(1.0 if curr_hour in hist_hours else 0.5)

    # Geographic proximity using Haversine distance
    curr_lat = current_context.get('lat', 0.0)
    curr_lon = current_context.get('lon', 0.0)
    hist_lat = historical_context.get('typical_lat', 0.0)
    hist_lon = historical_context.get('typical_lon', 0.0)
    if curr_lat and hist_lat:
        dist_km = _haversine_km(curr_lat, curr_lon, hist_lat, hist_lon)
        # Within 10km → 1.0; at 500km → 0.0; beyond → clamp to 0.0
        signals.append(max(0.0, 1.0 - dist_km / 500.0))

    return sum(signals) / max(1, len(signals)) if signals else 0.75


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute great-circle distance in km between two (lat, lon) coordinates."""
    R = 6371.0  # Earth mean radius in km
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return 2.0 * R * math.asin(math.sqrt(max(0.0, min(1.0, a))))


def compute_alpha(
    events:              list,
    learning_trajectory: Optional[List[float]] = None,
) -> float:
    """
    A: Adaptive Intelligence plane.

    Measures whether the entity is demonstrating positive learning and adaptation.
    High A: entity is improving, solving novel problems, demonstrating intelligence.
    Low A: entity is stagnating, repeating errors, not adapting.

    Formula:
        A = positive_adaptations / (positive_adaptations + regressions)
    """
    if not events or learning_trajectory is None:
        return 0.7

    if len(learning_trajectory) < 2:
        return 0.7

    improvements = sum(
        1 for i in range(1, len(learning_trajectory))
        if learning_trajectory[i] > learning_trajectory[i - 1]
    )
    regressions = len(learning_trajectory) - 1 - improvements

    if improvements + regressions == 0:
        return 0.7

    return min(1.0, (improvements + 0.5) / (improvements + regressions + 1))
