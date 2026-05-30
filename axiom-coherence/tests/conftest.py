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

class _Tensor:
    pass


class _Module:
    def __init__(self, *a, **kw): pass
    def forward(self, *a, **kw): pass


class _LSTM(_Module):
    pass


class _Linear(_Module):
    pass


_nn = _make_module("torch.nn", Module=_Module, LSTM=_LSTM, Linear=_Linear)
_nn_functional = _make_module("torch.nn.functional",
                              softmax=lambda x, **kw: x,
                              sigmoid=lambda x: x)

_torch = _make_module(
    "torch",
    nn=_nn,
    Tensor=_Tensor,
    sigmoid=lambda x: x,
)
_torch.nn = _nn

sys.modules.setdefault("torch", _torch)
sys.modules.setdefault("torch.nn", _nn)
sys.modules.setdefault("torch.nn.functional", _nn_functional)

# ── faiss stub ───────────────────────────────────────────────────────────────
sys.modules.setdefault("faiss", _make_module("faiss"))

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
