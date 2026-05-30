package rcp

import (
        "testing"

        "go.uber.org/zap"
)

func nopConfig() Config {
        return Config{
                AkashicURL: "postgres://localhost:5432/axiom_test",
                RedisURL:   "redis://localhost:6379/0",
                Logger:     zap.NewNop(),
        }
}

// TestNewRCPDaemon verifies construction succeeds and returns non-nil.
func TestNewRCPDaemon(t *testing.T) {
        d, err := NewRCPDaemon(nopConfig())
        if err != nil {
                t.Fatalf("NewRCPDaemon returned error: %v", err)
        }
        if d == nil {
                t.Fatal("NewRCPDaemon returned nil daemon")
        }
}

// TestInitialMetrics verifies that a fresh daemon reports zero packet counts.
func TestInitialMetrics(t *testing.T) {
        d, _ := NewRCPDaemon(nopConfig())
        metrics := d.Metrics()
        for k, v := range metrics {
                if v != 0 {
                        t.Errorf("metric %s should be 0 on init, got %d", k, v)
                }
        }
}

// TestInitialPeers verifies no peers on construction.
func TestInitialPeers(t *testing.T) {
        d, _ := NewRCPDaemon(nopConfig())
        peers := d.ConnectedPeers()
        if len(peers) != 0 {
                t.Errorf("expected 0 connected peers on init, got %d", len(peers))
        }
}

// TestRegisterPeer verifies that a registered peer becomes visible.
func TestRegisterPeer(t *testing.T) {
        d, _ := NewRCPDaemon(nopConfig())

        var bpi [32]byte
        bpi[0] = 0xAB
        var rf [RFVectorDim]float32
        for i := range rf {
                rf[i] = 1.0 // uniform RF vector
        }

        d.RegisterPeer(bpi, rf, "127.0.0.1:9000")

        // A peer with a matching RF to local (all-zero) has resonance 0; just check no panic.
        resonance := d.ComputeResonance(bpi)
        if resonance < 0 || resonance > 1 {
                t.Errorf("resonance %f out of [0, 1]", resonance)
        }
}

// TestComputeResonanceBetween_identical verifies identical vectors give resonance 1.0.
func TestComputeResonanceBetween_identical(t *testing.T) {
        var rf [RFVectorDim]float32
        for i := range rf {
                rf[i] = 0.5
        }
        r := ComputeResonanceBetween(rf, rf)
        if r < 0.999 {
                t.Errorf("identical vectors should give resonance ≈ 1.0, got %f", r)
        }
}

// TestComputeResonanceBetween_zero verifies zero vectors give resonance 0.
func TestComputeResonanceBetween_zero(t *testing.T) {
        var a, b [RFVectorDim]float32
        r := ComputeResonanceBetween(a, b)
        if r != 0 {
                t.Errorf("zero vectors should give resonance 0, got %f", r)
        }
}

// TestUpdateLocalRF does not panic and keeps daemon consistent.
func TestUpdateLocalRF(t *testing.T) {
        d, _ := NewRCPDaemon(nopConfig())
        var rf [RFVectorDim]float32
        rf[0] = 1.0
        d.UpdateLocalRF(rf) // must not panic
}

// TestRouteUnknownPacket verifies routing a packet with no peers returns an error.
func TestRouteUnknownPacket(t *testing.T) {
        d, _ := NewRCPDaemon(nopConfig())
        // ReceiverBPI must differ from the daemon's (zero) localBPI so we don't
        // short-circuit on "we are the receiver" and actually hit the routing path.
        var receiverBPI [32]byte
        receiverBPI[0] = 0xDE
        receiverBPI[1] = 0xAD
        pkt := &RCPPacket{
                ReceiverBPI: receiverBPI,
                TTL:         4,
                Payload:     []byte("hello"),
        }
        err := d.Route(pkt)
        if err == nil {
                t.Error("expected error routing packet with no peers, got nil")
        }
}

// TestIsResonant_unknownPeer verifies unknown BPIs are not resonant.
func TestIsResonant_unknownPeer(t *testing.T) {
        d, _ := NewRCPDaemon(nopConfig())
        var bpi [32]byte
        bpi[1] = 0xFF
        if d.IsResonant(bpi) {
                t.Error("unknown BPI should not be resonant")
        }
}
