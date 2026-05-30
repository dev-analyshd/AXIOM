//! BEO Universal — Behavioral Entity Object resolution across all entity types.
//!
//! ## Resolution Formula
//! ```text
//! BEO_confidence(sᵢ, sⱼ) = w_CF · CF(sᵢ,sⱼ) + w_ST · ST(sᵢ,sⱼ)
//!                          + w_SC · SC(sᵢ,sⱼ) + w_BP · BP(sᵢ,sⱼ)
//! ```
//! Weights: CF=0.40, ST=0.25, SC=0.20, BP=0.15

use crate::types::{BPI, UBEType, UniversalBehavioralHash};
use std::collections::HashMap;

/// BEO resolution weights.
const W_CAUSAL_FINGERPRINT: f32 = 0.40;
const W_SPATIO_TEMPORAL: f32    = 0.25;
const W_SOCIAL_CLUSTER: f32     = 0.20;
const W_BIOMETRIC_PROXY: f32    = 0.15;

/// Confidence thresholds for entity resolution.
const MERGE_THRESHOLD: f32      = 0.75;  // > 0.75 → same entity
const SEPARATE_THRESHOLD: f32   = 0.30;  // < 0.30 → distinct entities

/// A behavioral stream belonging to one entity.
#[derive(Debug, Clone)]
pub struct BehavioralStream {
    pub bpi: BPI,
    pub events: Vec<UniversalBehavioralHash>,
    /// 32-dimensional resonant frequency vector (one per UBE type).
    pub resonant_frequencies: [f32; 32],
    /// Known peer BPIs (social graph).
    pub known_peers: Vec<BPI>,
    /// Entity role tag.
    pub entity_type: &'static str,
}

impl BehavioralStream {
    /// Compute the resonant frequency vector from events.
    pub fn compute_resonant_frequencies(events: &[UniversalBehavioralHash]) -> [f32; 32] {
        let total = events.len().max(1) as f32;
        let mut counts = [0u32; 32];
        for e in events {
            let idx = (e.event_type as u8).saturating_sub(1) as usize;
            if idx < 32 {
                counts[idx] += 1;
            }
        }
        let mut rf = [0f32; 32];
        for (i, &c) in counts.iter().enumerate() {
            rf[i] = c as f32 / total;
        }
        rf
    }
}

/// BEO confidence score between two streams.
#[derive(Debug, Clone, Copy)]
pub struct BEOConfidence(pub f32);

impl BEOConfidence {
    pub fn is_same_entity(&self) -> bool { self.0 > MERGE_THRESHOLD }
    pub fn is_distinct_entity(&self) -> bool { self.0 < SEPARATE_THRESHOLD }
    pub fn is_ambiguous(&self) -> bool { !self.is_same_entity() && !self.is_distinct_entity() }
}

/// Result of BEO resolution.
#[derive(Debug, Clone)]
pub enum BEOResult {
    /// Streams resolve to the same entity.
    SameEntity { confidence: f32 },
    /// Streams are distinct entities.
    DistinctEntity { confidence: f32 },
    /// Resolution is ambiguous — more signal needed.
    Ambiguous { confidence: f32 },
}

/// BEO Universal resolver.
pub struct BEOResolver {
    streams: HashMap<[u8; 32], BehavioralStream>,
    /// Resolved entity groups (BPIs that map to same entity).
    resolved_groups: Vec<Vec<BPI>>,
}

impl BEOResolver {
    pub fn new() -> Self {
        Self {
            streams: HashMap::new(),
            resolved_groups: Vec::new(),
        }
    }

    /// Register a behavioral stream for an entity.
    pub fn register(&mut self, stream: BehavioralStream) {
        self.streams.insert(stream.bpi, stream);
    }

    /// Compute BEO confidence between two streams.
    pub fn confidence(&self, bpi_a: &BPI, bpi_b: &BPI) -> Option<BEOConfidence> {
        let a = self.streams.get(bpi_a)?;
        let b = self.streams.get(bpi_b)?;

        let cf = causal_fingerprint_similarity(a, b);
        let st = spatio_temporal_overlap(a, b);
        let sc = social_cluster_similarity(a, b);
        let bp = biometric_proxy_similarity(a, b);

        let score = W_CAUSAL_FINGERPRINT * cf
            + W_SPATIO_TEMPORAL * st
            + W_SOCIAL_CLUSTER * sc
            + W_BIOMETRIC_PROXY * bp;

        Some(BEOConfidence(score.clamp(0.0, 1.0)))
    }

    /// Resolve two streams — determine if they belong to the same entity.
    pub fn resolve(&self, bpi_a: &BPI, bpi_b: &BPI) -> BEOResult {
        match self.confidence(bpi_a, bpi_b) {
            None => BEOResult::Ambiguous { confidence: 0.0 },
            Some(c) if c.is_same_entity() => BEOResult::SameEntity { confidence: c.0 },
            Some(c) if c.is_distinct_entity() => BEOResult::DistinctEntity { confidence: c.0 },
            Some(c) => BEOResult::Ambiguous { confidence: c.0 },
        }
    }

    /// Run full cross-stream resolution on all registered streams.
    /// Returns groups of BPIs that resolve to the same entity.
    pub fn resolve_all(&self) -> Vec<Vec<BPI>> {
        let bpis: Vec<BPI> = self.streams.keys().copied().collect();
        let mut merged: Vec<Vec<BPI>> = vec![];
        let mut assigned = vec![false; bpis.len()];

        for i in 0..bpis.len() {
            if assigned[i] { continue; }
            let mut group = vec![bpis[i]];
            assigned[i] = true;

            for j in (i + 1)..bpis.len() {
                if assigned[j] { continue; }
                if let Some(c) = self.confidence(&bpis[i], &bpis[j]) {
                    if c.is_same_entity() {
                        group.push(bpis[j]);
                        assigned[j] = true;
                    }
                }
            }
            merged.push(group);
        }
        merged
    }
}

impl Default for BEOResolver {
    fn default() -> Self { Self::new() }
}

// ── Similarity functions ─────────────────────────────────────────────────────

/// CF: Causal fingerprint similarity (behavioral pattern correlation).
/// Cosine similarity of resonant frequency vectors.
fn causal_fingerprint_similarity(a: &BehavioralStream, b: &BehavioralStream) -> f32 {
    let rf_a = &a.resonant_frequencies;
    let rf_b = &b.resonant_frequencies;
    let dot: f32 = rf_a.iter().zip(rf_b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = rf_a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = rf_b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a < 1e-9 || norm_b < 1e-9 { return 0.0; }
    (dot / (norm_a * norm_b)).clamp(0.0, 1.0)
}

/// ST: Spatio-temporal overlap (are streams co-located in time?).
fn spatio_temporal_overlap(a: &BehavioralStream, b: &BehavioralStream) -> f32 {
    if a.events.is_empty() || b.events.is_empty() { return 0.0; }

    let a_min = a.events.iter().map(|e| e.gps_timestamp).min().unwrap_or(0);
    let a_max = a.events.iter().map(|e| e.gps_timestamp).max().unwrap_or(0);
    let b_min = b.events.iter().map(|e| e.gps_timestamp).min().unwrap_or(0);
    let b_max = b.events.iter().map(|e| e.gps_timestamp).max().unwrap_or(0);

    // Temporal overlap ratio
    let overlap_start = a_min.max(b_min);
    let overlap_end = a_max.min(b_max);
    if overlap_end <= overlap_start { return 0.0; }

    let overlap = (overlap_end - overlap_start) as f64;
    let union = (a_max.max(b_max) - a_min.min(b_min)).max(1) as f64;
    (overlap / union).clamp(0.0, 1.0) as f32
}

/// SC: Social/network clustering (same peer interactions?).
fn social_cluster_similarity(a: &BehavioralStream, b: &BehavioralStream) -> f32 {
    if a.known_peers.is_empty() && b.known_peers.is_empty() { return 0.5; }
    let a_set: std::collections::HashSet<&BPI> = a.known_peers.iter().collect();
    let b_set: std::collections::HashSet<&BPI> = b.known_peers.iter().collect();
    let intersection = a_set.intersection(&b_set).count();
    let union = a_set.union(&b_set).count();
    if union == 0 { return 0.0; }
    (intersection as f32 / union as f32).clamp(0.0, 1.0)
}

/// BP: Biometric proxy similarity — inter-event timing jitter histogram comparison.
///
/// Computes inter-arrival time (IAT) distributions for both streams, then
/// measures histogram intersection (overlap). Similar behavioral timing rhythms
/// (keystroke cadence, API call patterns, physiological signals) produce similar
/// IAT histograms and yield high BP scores.
///
/// Uses 16 logarithmic bins spanning 1µs to 1000s (nanosecond timestamps).
fn biometric_proxy_similarity(a: &BehavioralStream, b: &BehavioralStream) -> f32 {
    let iat_a = inter_arrival_times_ns(&a.events);
    let iat_b = inter_arrival_times_ns(&b.events);

    if iat_a.is_empty() || iat_b.is_empty() {
        // Insufficient timing data — fall back to entity type comparison
        return if a.entity_type == b.entity_type { 0.5 } else { 0.2 };
    }

    histogram_overlap_score(&iat_a, &iat_b)
}

/// Compute inter-arrival time intervals (nanoseconds) from event GPS timestamps.
fn inter_arrival_times_ns(events: &[UniversalBehavioralHash]) -> Vec<u64> {
    if events.len() < 2 {
        return vec![];
    }
    let mut timestamps: Vec<u64> = events.iter().map(|e| e.gps_timestamp).collect();
    timestamps.sort_unstable();
    timestamps.windows(2)
        .map(|w| w[1].saturating_sub(w[0]))
        .filter(|&dt| dt > 0)
        .collect()
}

/// Histogram intersection similarity ∈ [0, 1] using 16 log-scale bins.
///
/// Bins span 1µs (1_000 ns) to 1000s (1e12 ns) on a logarithmic scale.
/// Similarity = Σ min(hist_A[i], hist_B[i]) after normalizing both histograms.
fn histogram_overlap_score(a_iats: &[u64], b_iats: &[u64]) -> f32 {
    const BINS: usize = 16;
    const MIN_NS: f64 = 1_000.0;   // 1µs
    const MAX_NS: f64 = 1.0e12;    // 1000s
    let log_min = MIN_NS.ln();
    let log_max = MAX_NS.ln();
    let bin_width = (log_max - log_min) / BINS as f64;

    let mut hist_a = [0.0f32; BINS];
    let mut hist_b = [0.0f32; BINS];

    for &t in a_iats {
        let logval = (t as f64).max(MIN_NS).ln();
        let idx = ((logval - log_min) / bin_width) as usize;
        hist_a[idx.min(BINS - 1)] += 1.0;
    }
    for &t in b_iats {
        let logval = (t as f64).max(MIN_NS).ln();
        let idx = ((logval - log_min) / bin_width) as usize;
        hist_b[idx.min(BINS - 1)] += 1.0;
    }

    // Normalize to probability distributions
    let sum_a = hist_a.iter().sum::<f32>().max(1.0);
    let sum_b = hist_b.iter().sum::<f32>().max(1.0);
    for v in &mut hist_a { *v /= sum_a; }
    for v in &mut hist_b { *v /= sum_b; }

    // Intersection: sum of min(p, q) for each bin ∈ [0, 1]
    hist_a.iter().zip(hist_b.iter())
        .map(|(p, q)| p.min(*q))
        .sum::<f32>()
        .clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_stream(bpi: u8, ube_types: &[UBEType]) -> BehavioralStream {
        let bpi_arr = [bpi; 32];
        let events: Vec<UniversalBehavioralHash> = ube_types.iter().map(|&et| {
            UniversalBehavioralHash {
                entity_bpi: bpi_arr,
                event_type: et,
                event_subtype: 0,
                prior_hash: [0u8; 32],
                causal_context: [0u8; 32],
                gps_timestamp: 1_000_000_000,
                device_timestamp: 1_000_000_000,
                environment_hash: [0u8; 32],
                event_payload: vec![],
                entropy_proof: [0u8; 32],
                validator_sig: [0u8; 32],
                self_hash: [0u8; 32],
                bc_at_event: 0.8,
                depth_at_event: 100.0,
            }
        }).collect();
        let rf = BehavioralStream::compute_resonant_frequencies(&events);
        BehavioralStream { bpi: bpi_arr, events, resonant_frequencies: rf, known_peers: vec![], entity_type: "test" }
    }

    #[test]
    fn identical_streams_high_confidence() {
        let types = [UBEType::Execute, UBEType::Read, UBEType::Write];
        let s1 = make_stream(1, &types);
        let s2 = make_stream(2, &types);
        let mut resolver = BEOResolver::new();
        resolver.register(s1);
        resolver.register(s2);
        let c = resolver.confidence(&[1u8; 32], &[2u8; 32]).unwrap();
        assert!(c.0 > 0.5);
    }

    #[test]
    fn different_streams_lower_confidence() {
        let s1 = make_stream(1, &[UBEType::Execute, UBEType::Execute]);
        let s2 = make_stream(2, &[UBEType::Stake, UBEType::Governance]);
        let mut resolver = BEOResolver::new();
        resolver.register(s1);
        resolver.register(s2);
        let c = resolver.confidence(&[1u8; 32], &[2u8; 32]).unwrap();
        assert!(c.0 < 0.8);
    }
}
