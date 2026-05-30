"""
conftest.py — stub out heavy optional dependencies so the AXIOM
coherence-engine tests run without a full ML environment.

Modules stubbed:
  torch, torch.nn, torch.nn.functional  — replaced with lightweight mocks
  faiss, kafka, redis, psycopg2, grpc    — replaced with empty stubs

Tests that exercise these modules directly should live in a separate
integration-test suite that is only run in a full ML environment.
"""
import sys
import types


def _make_module(name: str, **attrs) -> types.ModuleType:
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    return m


# ── torch stubs ─────────────────────────────────────────────────────────────
import numpy as np
import contextlib


class _Tensor:
    def __init__(self, data=None):
        self._data = np.array(data, dtype=np.float32) if data is not None else np.array([], dtype=np.float32)
    def numpy(self): return self._data
    def __len__(self): return len(self._data)
    def __getitem__(self, key): return _Tensor(self._data[key])
    def __setitem__(self, key, val): self._data[key] = val
    def __iter__(self): return iter(self._data)
    def shape(self): return self._data.shape
    def detach(self): return self
    def item(self): return float(self._data.flat[0]) if self._data.size > 0 else 0.0
    def squeeze(self): return _Tensor(self._data.squeeze())
    def unsqueeze(self, dim): return _Tensor(np.expand_dims(self._data, axis=dim))
    def __repr__(self): return f"_Tensor({self._data})"


def _tensor(data, dtype=None, **kw):
    arr = np.array(data, dtype=np.float32)
    t = _Tensor(arr)
    t._data = arr
    return t


@contextlib.contextmanager
def _no_grad():
    yield


class _Module:
    def __init__(self, *a, **kw): pass
    def forward(self, *a, **kw):
        import numpy as _np
        return _Tensor(_np.zeros(32)), _Tensor(_np.zeros(1))
    def eval(self): return self
    def train(self, mode=True): return self
    def parameters(self): return iter([])
    def state_dict(self): return {}
    def load_state_dict(self, sd): pass
    def __call__(self, *a, **kw): return self.forward(*a, **kw)


class _LSTM(_Module):
    def __init__(self, *a, **kw): super().__init__()
    def forward(self, x, hidden=None):
        import numpy as _np
        if hasattr(x, '_data') and x._data.ndim >= 2:
            batch = int(x._data.shape[0])
            seq   = int(x._data.shape[1]) if x._data.ndim >= 3 else 1
        else:
            batch, seq = 1, 1
        # Return (batch, seq, hidden*2=256) — matches bidirectional LSTM output
        return _Tensor(_np.zeros((batch, seq, 256), dtype=_np.float32)), None


class _Linear(_Module):
    def __init__(self, *a, **kw):
        super().__init__()
        args = [x for x in a if isinstance(x, int)]
        self._out_f = args[1] if len(args) >= 2 else 1
    def forward(self, x):
        import numpy as _np
        if hasattr(x, '_data') and x._data.ndim >= 2:
            batch = int(x._data.shape[0])
        else:
            batch = 1
        return _Tensor(_np.zeros((batch, self._out_f), dtype=_np.float32))


_nn = _make_module(
    "torch.nn",
    Module=_Module, LSTM=_LSTM, Linear=_Linear,
    Dropout=_Module, LayerNorm=_Module, BatchNorm1d=_Module,
)
def _softmax(x, dim=None, **kw):
    import numpy as _np
    arr = x._data if hasattr(x, '_data') else _np.array(x)
    # stable softmax along last axis
    e = _np.exp(arr - arr.max(axis=-1, keepdims=True))
    s = e / (e.sum(axis=-1, keepdims=True) + 1e-9)
    return _Tensor(s)

_nn_functional = _make_module(
    "torch.nn.functional",
    softmax=_softmax,
    sigmoid=lambda x: x,
    relu=lambda x: x,
)

_torch = _make_module(
    "torch",
    nn=_nn,
    Tensor=_Tensor,
    tensor=_tensor,
    zeros=lambda *s, **kw: _Tensor(np.zeros(s)),
    ones=lambda *s, **kw: _Tensor(np.ones(s)),
    sigmoid=lambda x: x,
    no_grad=_no_grad,
    float32=np.float32,
    long=np.int64,
)
_torch.nn = _nn

sys.modules.setdefault("torch", _torch)
sys.modules.setdefault("torch.nn", _nn)
sys.modules.setdefault("torch.nn.functional", _nn_functional)

# ── faiss stub ───────────────────────────────────────────────────────────────
class _FaissIndex:
    def __init__(self, dim=32, *a, **kw):
        self._dim = dim
        self._vecs = []
    def add(self, x): self._vecs.append(x)
    def search(self, q, k):
        import numpy as _np
        n = len(self._vecs)
        k = min(k, max(n, 1))
        return _np.zeros((1, k), dtype=_np.float32), _np.zeros((1, k), dtype=_np.int64)
    ntotal = property(lambda self: len(self._vecs))

_faiss = _make_module("faiss",
    IndexFlatIP=_FaissIndex,
    IndexFlatL2=_FaissIndex,
    IndexIVFFlat=_FaissIndex,
    normalize_L2=lambda x: x,
)
sys.modules.setdefault("faiss", _faiss)

# ── kafka stub ───────────────────────────────────────────────────────────────
_kafka = _make_module("kafka")
_kafka_producer = _make_module("kafka.producer")
sys.modules.setdefault("kafka", _kafka)
sys.modules.setdefault("kafka.producer", _kafka_producer)

# ── redis stub ───────────────────────────────────────────────────────────────
sys.modules.setdefault("redis", _make_module("redis"))
sys.modules.setdefault("redis.asyncio", _make_module("redis.asyncio"))

# ── psycopg2 stub ────────────────────────────────────────────────────────────
sys.modules.setdefault("psycopg2", _make_module("psycopg2"))

# ── grpc stubs ───────────────────────────────────────────────────────────────
sys.modules.setdefault("grpc", _make_module("grpc"))

# ── sklearn stubs ────────────────────────────────────────────────────────────
_sklearn = _make_module("sklearn")
_sklearn_preprocessing = _make_module("sklearn.preprocessing")
sys.modules.setdefault("sklearn", _sklearn)
sys.modules.setdefault("sklearn.preprocessing", _sklearn_preprocessing)

# ── scipy stubs ──────────────────────────────────────────────────────────────
_scipy = _make_module("scipy")
_scipy_spatial = _make_module("scipy.spatial")
_scipy_spatial_distance = _make_module("scipy.spatial.distance",
                                       cosine=lambda a, b: 0.0)
sys.modules.setdefault("scipy", _scipy)
sys.modules.setdefault("scipy.spatial", _scipy_spatial)
sys.modules.setdefault("scipy.spatial.distance", _scipy_spatial_distance)

# ── prometheus stubs ─────────────────────────────────────────────────────────
sys.modules.setdefault("prometheus_client", _make_module("prometheus_client"))
