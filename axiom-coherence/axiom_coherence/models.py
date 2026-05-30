"""
AXIOM Behavioral LSTM — PyTorch model for trajectory prediction.

Architecture: 4-layer bidirectional LSTM
Input:  sequence of (UBE_type_onehot[32], BC, depth_normalized) = 34-dim
Output: probability distribution over next UBE_type (32 classes)

From whitepaper §9.8:
  input_dim  = 34  (32 UBE one-hot + BC scalar + depth scalar)
  hidden_dim = 128
  num_layers = 4
  bidirectional = True

Used by:
- Coherence Engine (M plane computation)
- BIS pre-detection (anomaly prediction before occurrence)
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Tuple
import numpy as np

# ── Input dimensions (whitepaper §9.8) ─────────────────────────────────────
UBE_TYPES    = 32  # 32 Universal Behavioral Event types
BC_DIM       = 1   # BC(entity, t) scalar
DEPTH_DIM    = 1   # D(entity, t) normalized scalar
INPUT_DIM    = UBE_TYPES + BC_DIM + DEPTH_DIM  # 34 — exact per whitepaper

# ── Architecture hyperparameters (whitepaper §9.8) ──────────────────────────
HIDDEN_DIM = 128
NUM_LAYERS = 4
DROPOUT    = 0.2

assert INPUT_DIM == 34, f"input_dim must be 34 per whitepaper §9.8, got {INPUT_DIM}"


class BehavioralLSTM(nn.Module):
    """
    4-layer bidirectional LSTM for behavioral trajectory prediction.

    Input shape:  (batch, seq_len, 34)
      [0..31] — one-hot UBE type encoding
      [32]    — BC(entity, t) ∈ [0, 1]
      [33]    — D(entity, t) normalized ∈ [0, 1]

    Output:
      event_probs — (batch, 32) softmax over next UBE type
      bc_pred     — (batch, 1)  predicted next BC value ∈ [0, 1]

    Trained on Akashic Index historical sequences.
    Loss: cross-entropy on next UBE_type prediction.
    """

    def __init__(
        self,
        input_dim:  int   = INPUT_DIM,
        hidden_dim: int   = HIDDEN_DIM,
        num_layers: int   = NUM_LAYERS,
        dropout:    float = DROPOUT,
    ):
        super().__init__()
        assert input_dim == 34, "input_dim must be 34 (32 UBE + BC + depth)"
        self.input_dim  = input_dim
        self.hidden_dim = hidden_dim
        self.num_layers = num_layers

        self.lstm = nn.LSTM(
            input_dim,
            hidden_dim,
            num_layers,
            batch_first=True,
            bidirectional=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )

        # Output head: 32 UBE type probabilities
        self.fc = nn.Linear(hidden_dim * 2, UBE_TYPES)

        # BC prediction head
        self.bc_head = nn.Linear(hidden_dim * 2, 1)

    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Args:
            x: (batch, seq_len, 34) — behavioral event sequence

        Returns:
            event_probs: (batch, 32) — softmax over next UBE type
            bc_pred:     (batch, 1)  — predicted next BC ∈ [0, 1]
        """
        assert x.shape[-1] == INPUT_DIM, \
            f"Expected input_dim={INPUT_DIM}, got {x.shape[-1]}"
        out, _ = self.lstm(x)
        last = out[:, -1, :]  # Last timestep (most recent behavioral state)

        event_logits = self.fc(last)
        event_probs  = F.softmax(event_logits, dim=-1)

        bc_pred = torch.sigmoid(self.bc_head(last))  # BC ∈ [0, 1]

        return event_probs, bc_pred


def encode_event(
    event_type: int,
    bc: float,
    depth: float,
    max_depth: float = 1_000_000.0,
) -> np.ndarray:
    """
    Encode a single behavioral event as a 34-dimensional feature vector.

    Dimensions (whitepaper §9.8):
        [0..31]  — one-hot encoding of UBE type (32 dims)
        [32]     — BC(entity, t) ∈ [0, 1]
        [33]     — D(entity, t) normalized ∈ [0, 1]

    Note: timestamp is NOT included in the feature vector per whitepaper §9.8.
    """
    vec = np.zeros(INPUT_DIM, dtype=np.float32)

    # UBE type one-hot (types 1..32 → indices 0..31)
    ube_idx = max(0, min(UBE_TYPES - 1, event_type - 1))
    vec[ube_idx] = 1.0

    # BC scalar
    vec[32] = max(0.0, min(1.0, bc))

    # Depth normalized
    vec[33] = max(0.0, min(1.0, depth / max_depth))

    return vec


class TrajectoryPredictor:
    """
    Wrapper around BehavioralLSTM for online behavioral trajectory prediction.

    Maintains a sliding window of recent events per entity and predicts
    the next event type + BC.

    Used for:
    - BIS Level 2 proactive interrupt (P(observed | predicted) < 0.01)
    - Coherence Engine M-plane computation
    """

    def __init__(
        self,
        model:       Optional[BehavioralLSTM] = None,
        window_size: int = 64,
    ):
        self.model = model or BehavioralLSTM()
        self.model.eval()
        self.window_size = window_size
        self._windows: dict = {}  # entity_bpi_hex → list of encoded events

    def observe(
        self,
        entity_bpi: bytes,
        event_type: int,
        bc:         float,
        depth:      float,
    ) -> None:
        """Add a new observation for an entity."""
        key = entity_bpi.hex()
        if key not in self._windows:
            self._windows[key] = []
        vec = encode_event(event_type, bc, depth)
        self._windows[key].append(vec)
        if len(self._windows[key]) > self.window_size:
            self._windows[key].pop(0)

    def predict_next(
        self,
        entity_bpi: bytes,
    ) -> Optional[Tuple[np.ndarray, float]]:
        """
        Predict next event type distribution and BC for an entity.

        Returns:
            (event_probs[32], bc_prediction) or None if insufficient history.
        """
        key = entity_bpi.hex()
        window = self._windows.get(key, [])
        if len(window) < 4:
            return None  # Need at least 4 events for meaningful prediction

        with torch.no_grad():
            seq = torch.tensor(
                np.array(window), dtype=torch.float32
            ).unsqueeze(0)
            event_probs, bc_pred = self.model(seq)
            return event_probs[0].numpy(), bc_pred[0, 0].item()

    def probability_of(self, entity_bpi: bytes, event_type: int) -> float:
        """P(event_type | entity history) from the LSTM model."""
        result = self.predict_next(entity_bpi)
        if result is None:
            return 1.0 / UBE_TYPES  # Uniform prior
        probs, _ = result
        idx = max(0, min(UBE_TYPES - 1, event_type - 1))
        return float(probs[idx])

    def is_anomalous(
        self,
        entity_bpi: bytes,
        event_type: int,
        threshold:  float = 0.01,
    ) -> bool:
        """
        Pre-detection: is this event anomalous given the trajectory model?

        Triggers BIS Level 2 proactive interrupt if P < threshold.
        """
        return self.probability_of(entity_bpi, event_type) < threshold
