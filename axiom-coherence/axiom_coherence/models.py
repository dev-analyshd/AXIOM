"""
AXIOM Behavioral LSTM — trajectory prediction model.

Architecture: 4-layer bidirectional LSTM (when PyTorch is available)
              Markov-chain numpy fallback (when PyTorch is not available)
Input:  sequence of (UBE_type_onehot[32], BC, depth_normalized) = 34-dim
Output: probability distribution over next UBE_type (32 classes)

From whitepaper §9.8:
  input_dim  = 34  (32 UBE one-hot + BC scalar + depth scalar)
  hidden_dim = 128
  num_layers = 4
  bidirectional = True
"""

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

# ── Optional PyTorch support ─────────────────────────────────────────────────
try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore


class _NumpyLSTMFallback:
    """
    Numpy-based Markov-chain fallback for BehavioralLSTM.

    Used when PyTorch is not installed. Maintains a first-order
    transition matrix over UBE types, sufficient for anomaly detection
    in unit tests and lightweight deployments.
    """

    def __init__(self):
        # Transition counts [from_type, to_type] — shape (32, 32)
        self._transition: np.ndarray = np.ones((UBE_TYPES, UBE_TYPES), dtype=np.float32)
        self._bc_sums: np.ndarray = np.full(UBE_TYPES, 0.8, dtype=np.float32)
        self._bc_counts: np.ndarray = np.ones(UBE_TYPES, dtype=np.float32)
        self._last_type: int = 0

    def observe(self, event_type: int, bc: float) -> None:
        cur_idx = max(0, min(UBE_TYPES - 1, event_type - 1))
        self._transition[self._last_type, cur_idx] += 1.0
        self._bc_sums[cur_idx] += bc
        self._bc_counts[cur_idx] += 1.0
        self._last_type = cur_idx

    def predict(self) -> Tuple[np.ndarray, float]:
        row = self._transition[self._last_type]
        total = row.sum()
        probs = row / total if total > 0 else row
        bc_pred = float((self._bc_sums / self._bc_counts).mean())
        return probs, bc_pred

    def eval(self):
        return self


class BehavioralLSTM:
    """
    4-layer bidirectional LSTM for behavioral trajectory prediction.

    Wraps either a real PyTorch module (when torch is available) or the
    numpy Markov-chain fallback. The public API is identical in both cases.

    Input shape:  (batch, seq_len, 34)
      [0..31] — one-hot UBE type encoding
      [32]    — BC(entity, t) ∈ [0, 1]
      [33]    — D(entity, t) normalized ∈ [0, 1]

    Output:
      event_probs — (batch, 32) softmax over next UBE type
      bc_pred     — (batch, 1)  predicted next BC value ∈ [0, 1]
    """

    def __init__(
        self,
        input_dim:  int   = INPUT_DIM,
        hidden_dim: int   = HIDDEN_DIM,
        num_layers: int   = NUM_LAYERS,
        dropout:    float = DROPOUT,
    ):
        assert input_dim == 34, "input_dim must be 34 (32 UBE + BC + depth)"
        self.input_dim  = input_dim
        self.hidden_dim = hidden_dim
        self.num_layers = num_layers
        self._using_torch = _TORCH_AVAILABLE

        if _TORCH_AVAILABLE:
            self._torch_model = _TorchBehavioralLSTM(
                input_dim, hidden_dim, num_layers, dropout
            )
        else:
            self._numpy_model = _NumpyLSTMFallback()

    def eval(self):
        if self._using_torch:
            self._torch_model.eval()
        return self

    def __call__(self, x):
        """
        Forward pass. Works with numpy arrays or torch tensors.

        Returns (event_probs, bc_pred) as numpy arrays.
        """
        if self._using_torch:
            import torch
            if not isinstance(x, torch.Tensor):
                x = torch.tensor(x, dtype=torch.float32)
            with torch.no_grad():
                probs, bc = self._torch_model(x)
            return probs.numpy(), bc.numpy()
        else:
            # Fallback: use Markov model on last event in sequence
            seq = np.array(x)
            if seq.ndim == 3:
                last = seq[0, -1]  # (34,) last event of first batch
            else:
                last = seq[-1]
            event_idx = int(np.argmax(last[:32]))
            self._numpy_model._last_type = event_idx
            probs, bc = self._numpy_model.predict()
            batch_probs = probs[np.newaxis, :]   # (1, 32)
            batch_bc = np.array([[bc]])           # (1, 1)
            return batch_probs, batch_bc


if _TORCH_AVAILABLE:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    class _TorchBehavioralLSTM(nn.Module):
        def __init__(self, input_dim=INPUT_DIM, hidden_dim=HIDDEN_DIM,
                     num_layers=NUM_LAYERS, dropout=DROPOUT):
            super().__init__()
            self.lstm = nn.LSTM(
                input_dim, hidden_dim, num_layers,
                batch_first=True, bidirectional=True,
                dropout=dropout if num_layers > 1 else 0.0,
            )
            self.fc      = nn.Linear(hidden_dim * 2, UBE_TYPES)
            self.bc_head = nn.Linear(hidden_dim * 2, 1)

        def forward(self, x):
            out, _ = self.lstm(x)
            last = out[:, -1, :]
            probs  = F.softmax(self.fc(last), dim=-1)
            bc_pred = torch.sigmoid(self.bc_head(last))
            return probs, bc_pred


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
    """
    vec = np.zeros(INPUT_DIM, dtype=np.float32)
    ube_idx = max(0, min(UBE_TYPES - 1, event_type - 1))
    vec[ube_idx] = 1.0
    vec[32] = max(0.0, min(1.0, bc))
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
        model:       Optional["BehavioralLSTM"] = None,
        window_size: int = 64,
    ):
        self.model = model or BehavioralLSTM()
        self.model.eval()
        self.window_size = window_size
        self._windows: dict = {}  # entity_bpi_hex → list of encoded events
        self._numpy_models: dict = {}  # per-entity Markov models (fallback)

    def observe(
        self,
        entity_bpi: bytes,
        event_type: int,
        bc:         float,
        depth:      float,
        timestamp:  int = 0,
    ) -> None:
        """Add a new observation for an entity."""
        key = entity_bpi.hex()
        if key not in self._windows:
            self._windows[key] = []
        vec = encode_event(event_type, bc, depth)
        self._windows[key].append(vec)
        if len(self._windows[key]) > self.window_size:
            self._windows[key].pop(0)

        # Update per-entity Markov model for fallback
        if not _TORCH_AVAILABLE:
            if key not in self._numpy_models:
                self._numpy_models[key] = _NumpyLSTMFallback()
            self._numpy_models[key].observe(event_type, bc)

    def predict_next(
        self,
        entity_bpi: bytes,
    ) -> Optional[Tuple[np.ndarray, float]]:
        """
        Predict next event type distribution and BC for an entity.

        Returns (event_probs[32], bc_prediction) or None if insufficient history.
        """
        key = entity_bpi.hex()
        window = self._windows.get(key, [])
        if len(window) < 4:
            return None

        if not _TORCH_AVAILABLE:
            m = self._numpy_models.get(key)
            if m is None:
                return None
            probs, bc = m.predict()
            return probs, bc

        seq = np.array(window, dtype=np.float32)[np.newaxis, :, :]  # (1, N, 34)
        probs, bc = self.model(seq)
        return probs[0], float(bc[0, 0])

    def probability_of(self, entity_bpi: bytes, event_type: int) -> float:
        """P(event_type | entity history) from the trajectory model."""
        result = self.predict_next(entity_bpi)
        if result is None:
            return 1.0 / UBE_TYPES
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
