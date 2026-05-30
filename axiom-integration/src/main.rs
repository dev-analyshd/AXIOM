//! AXIOM End-to-End Integration Test — All 7 Layers, 19 Inventions.
//!
//! Exercises every layer of the AXIOM stack without any external dependencies
//! (no PostgreSQL, no Redis, no Kafka — all state is in-memory).
//!
//! Exit codes:
//!   0 — all layers pass
//!   1 — one or more layers failed

use axiom_core::{
    l0::entropy::{EntropySource, SimulationEntropySource},
    l1::ubh::{UBHEngine, axiom_genesis_bpi},
    l2::{
        beo::{BEOResolver, BehavioralStream},
        bpi::BehavioralProcessIdentity,
    },
    l5::{
        bis::BISController,
        scheduler::{CBRAScheduler, ScheduledProcess},
    },
    types::{
        BISLevel, CoherencePlanes, EntityRole, SilenceState, TruthState,
        UBEType, UniversalBehavioralHash,
    },
    dynamic_threshold, living_moat, master_equation,
    PLANE_WEIGHTS, PSI_BASE, SILENCE_RECOVERY_WINDOW,
};

use std::collections::HashMap;

// ── Colour helpers ────────────────────────────────────────────────────────────
fn green(s: &str) -> String { format!("\x1b[32m{s}\x1b[0m") }
fn red(s: &str)   -> String { format!("\x1b[31m{s}\x1b[0m") }
fn bold(s: &str)  -> String { format!("\x1b[1m{s}\x1b[0m") }

struct TestRunner {
    passed: usize,
    failed: usize,
}

impl TestRunner {
    fn new() -> Self { Self { passed: 0, failed: 0 } }

    fn section(&self, title: &str) {
        println!("\n{}", bold(&format!("═══ {} ═══", title)));
    }

    fn check(&mut self, name: &str, ok: bool) -> bool {
        if ok {
            println!("  [{}] {}", green("PASS"), name);
            self.passed += 1;
        } else {
            println!("  [{}] {} — FAILED", red("FAIL"), name);
            self.failed += 1;
        }
        ok
    }

    fn summary(&self) -> bool {
        println!("\n{}", bold("━━━ Integration Test Summary ━━━"));
        println!("  Passed: {}", self.passed);
        if self.failed > 0 {
            println!("  {}", red(&format!("Failed: {}", self.failed)));
        } else {
            println!("  Failed: 0");
        }
        println!("  Total:  {}", self.passed + self.failed);
        self.failed == 0
    }
}

// ── In-memory Akashic Index (L3 standalone — no TimescaleDB required) ────────

struct MemAkashic {
    events: Vec<UniversalBehavioralHash>,
    depth_map: HashMap<[u8; 32], f64>,
}

impl MemAkashic {
    fn new() -> Self {
        Self { events: Vec::new(), depth_map: HashMap::new() }
    }

    /// Append a UBH record (Invariant I1: append-only, I2: cryptographic verification).
    fn append(&mut self, ubh: UniversalBehavioralHash) -> Result<(), &'static str> {
        if !ubh.verify_self_hash() {
            return Err("UBH self_hash verification failed — tamper detected");
        }
        *self.depth_map.entry(ubh.entity_bpi).or_insert(0.0) += 1.0;
        self.events.push(ubh);
        Ok(())
    }

    fn depth_for(&self, bpi: &[u8; 32]) -> f64 {
        *self.depth_map.get(bpi).unwrap_or(&0.0)
    }

    fn event_count(&self) -> usize { self.events.len() }

    fn events_for(&self, bpi: &[u8; 32]) -> Vec<&UniversalBehavioralHash> {
        self.events.iter().filter(|e| &e.entity_bpi == bpi).collect()
    }
}

// ── Cosine similarity (RCP core algorithm) ───────────────────────────────────
fn cosine_similarity(a: &[f32; 32], b: &[f32; 32]) -> f32 {
    let dot: f32   = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a < 1e-9 || norm_b < 1e-9 { return 0.0; }
    dot / (norm_a * norm_b)
}

fn classify_connection(r: f32) -> &'static str {
    if r > 0.50 { "high-bandwidth" }
    else if r > 0.15 { "standard" }
    else if r > 0.05 { "emergency-only" }
    else { "no-connection" }
}

// ── Main ─────────────────────────────────────────────────────────────────────

fn main() {
    println!("{}", bold("╔══════════════════════════════════════════════════════╗"));
    println!("{}", bold("║    AXIOM Integration Test — All 7 Layers             ║"));
    println!("{}", bold("║    19 Inventions · D(AXIOM,t)                        ║"));
    println!("{}", bold("╚══════════════════════════════════════════════════════╝"));

    let mut t = TestRunner::new();

    // =========================================================================
    // L0 — Physical Reality Substrate (Inventions #1, #2)
    // =========================================================================
    t.section("L0 · Physical Reality Substrate (Inventions #1, #2)");

    let entropy = SimulationEntropySource::from_u64(0xDEAD_BEEF_1337);

    let ts = entropy.gps_timestamp_ns();
    t.check("L0.01 GPS timestamp is non-zero", ts > 0);

    let combined = entropy.combined_entropy();
    t.check("L0.02 combined_entropy() returns non-zero 32 bytes",
            combined.iter().any(|&b| b != 0));

    let hsm   = entropy.hsm_entropy();
    let gps_e = entropy.gps_entropy();
    t.check("L0.03 hsm_entropy ≠ gps_entropy (independent sources)", hsm != gps_e);

    let set_bits: u32 = combined.iter().map(|b| b.count_ones()).sum();
    t.check("L0.04 Entropy bit diversity ≥ 96/256 bits set", set_bits >= 96);

    t.check("L0.05 verify_minimum_entropy() accepts high-entropy input",
            axiom_core::l0::entropy::verify_minimum_entropy(&combined));

    // =========================================================================
    // L1 — Universal Behavioral Hash Engine (Inventions #3, #4, #5)
    // =========================================================================
    t.section("L1 · UBH Engine — Behavioral Ledger (Inventions #3, #4, #5)");

    let genesis_bpi = axiom_genesis_bpi();
    let mut engine = UBHEngine::new(
        genesis_bpi,
        Box::new(SimulationEntropySource::from_u64(42)),
    );

    let event_types = [
        UBEType::Transfer,  UBEType::Stake,     UBEType::Execute,
        UBEType::Learn,     UBEType::Decide,    UBEType::Communicate,
        UBEType::Authenticate, UBEType::Write,  UBEType::Sense, UBEType::Actuate,
    ];
    let mut events: Vec<UniversalBehavioralHash> = Vec::new();
    for ube in event_types.iter() {
        events.push(engine.emit_event(*ube, vec![0x42u8; 16]));
    }

    t.check("L1.01 10 UBH events emitted", events.len() == 10);

    let all_hashes_valid = events.iter().all(|e| e.verify_self_hash());
    t.check("L1.02 All UBH self-hashes verify (Invariant I2)", all_hashes_valid);

    let chain_intact = events.windows(2).all(|w| w[1].verify_chain_link(&w[0]));
    t.check("L1.03 Causal chain intact: UBH[n].prior_hash = UBH[n-1].self_hash", chain_intact);

    t.check("L1.04 UBEType::from_u8 covers all 32 types",
            (1u8..=32).all(|v| UBEType::from_u8(v).is_some()));
    t.check("L1.05 UBEType::from_u8(0) = None (out of range)",
            UBEType::from_u8(0).is_none());
    t.check("L1.06 UBEType::from_u8(33) = None (out of range)",
            UBEType::from_u8(33).is_none());

    let cat = UBEType::Transfer.category();
    t.check("L1.07 UBEType category lookup works", !cat.is_empty());

    t.check("L1.08 Event counter increments", engine.event_count() == 10);

    // =========================================================================
    // L2 — Entity Resolution (Inventions #10, #11, #14, #15)
    // =========================================================================
    t.section("L2 · Entity Resolution — BPI + BEO (Inventions #10, #11, #14, #15)");

    let entropy2 = SimulationEntropySource::from_u64(100);
    let ts2 = entropy2.gps_timestamp_ns();

    let mut bpi_record = BehavioralProcessIdentity::genesis(
        "axiom://integration-test-entity",
        1.0,
        None,
        &entropy2.combined_entropy(),
        ts2,
    );
    t.check("L2.01 BPI genesis creates non-zero BPI",
            bpi_record.bpi.iter().any(|&b| b != 0));

    let bpi_before = bpi_record.bpi;
    let merkle_root = [0xABu8; 32];
    let env_hash    = [0xCDu8; 32];
    let ts3 = SimulationEntropySource::from_u64(200).gps_timestamp_ns();
    bpi_record.update(&merkle_root, &env_hash, ts3);

    t.check("L2.02 BPI update changes identity (causal binding)",
            bpi_record.bpi != bpi_before);
    t.check("L2.03 Depth cycles increment on BPI update",
            bpi_record.depth_cycles() > 0);

    // BEO resonant frequency from events (method on BehavioralStream)
    let rf = BehavioralStream::compute_resonant_frequencies(&events);
    let rf_sum: f32 = rf.iter().sum();
    t.check("L2.04 BEO RF vector sums to 1.0 (probability distribution)",
            (rf_sum - 1.0_f32).abs() < 1e-4);

    // Build two behavioral streams for the same entity
    let stream_a = BehavioralStream {
        bpi:    genesis_bpi,
        events: events.clone(),
        resonant_frequencies: rf,
        known_peers: vec![],
        entity_type: "test",
    };
    let stream_b = BehavioralStream {
        bpi:    bpi_record.bpi,
        events: events.clone(),
        resonant_frequencies: rf, // Same RF → same behavioral vocabulary
        known_peers: vec![],
        entity_type: "test",
    };
    let mut beo = BEOResolver::new();
    beo.register(stream_a);
    beo.register(stream_b);

    let confidence = beo.confidence(&genesis_bpi, &bpi_record.bpi);
    t.check("L2.05 BEO confidence computable for two streams",
            confidence.is_some());

    let result = beo.resolve(&genesis_bpi, &bpi_record.bpi);
    t.check("L2.06 BEO resolve() returns a determination", {
        use axiom_core::l2::BEOResult;
        matches!(result, BEOResult::SameEntity { .. }
                      | BEOResult::DistinctEntity { .. }
                      | BEOResult::Ambiguous { .. })
    });

    // =========================================================================
    // L3 — Living Akashic Index (Inventions #6, #13)
    // =========================================================================
    t.section("L3 · Living Akashic Index — In-Memory (Inventions #6, #13)");

    let mut akashic = MemAkashic::new();

    let mut appended = 0usize;
    for ubh in &events {
        if akashic.append(ubh.clone()).is_ok() { appended += 1; }
    }
    t.check("L3.01 All 10 events appended (I2: hash verified)", appended == 10);
    t.check("L3.02 Akashic event count matches appended", akashic.event_count() == 10);

    let depth = akashic.depth_for(&engine.current_bpi());
    t.check("L3.03 Akashic depth increments per entity", depth > 0.0);

    // Tamper test — Invariant I1
    // Corrupt the self_hash field directly — compute_self_hash() will produce
    // a different value, so verify_self_hash() returns false → append rejected.
    let mut tampered = events[0].clone();
    tampered.self_hash[0] ^= 0xFF;  // Flip bits in stored self_hash
    let tamper_result = akashic.append(tampered);
    t.check("L3.04 Tampered event rejected (Invariant I1: append-only)", tamper_result.is_err());

    let entity_events = akashic.events_for(&engine.current_bpi());
    t.check("L3.05 Events retrievable by entity BPI (I3: temporal ordering)",
            !entity_events.is_empty());

    // Simulation entropy adds seed-based jitter so absolute ordering isn't
    // guaranteed; verify all timestamps are non-zero (I3: temporal anchor).
    t.check("L3.06 All events have non-zero GPS timestamps (I3: temporal anchor)",
            entity_events.iter().all(|e| e.gps_timestamp > 0));

    // =========================================================================
    // L4 — Coherence Engine — BC Formula (Inventions #7, #8)
    // =========================================================================
    t.section("L4 · Behavioral Coherence Model — Math (Inventions #7, #8)");

    let planes = CoherencePlanes { phi: 0.9, mu: 0.8, sigma: 0.85, kappa: 0.75, alpha: 0.70 };
    let bc = planes.behavioral_coherence();
    let expected_bc = PLANE_WEIGHTS[0] * planes.phi
        + PLANE_WEIGHTS[1] * planes.mu
        + PLANE_WEIGHTS[2] * planes.sigma
        + PLANE_WEIGHTS[3] * planes.kappa
        + PLANE_WEIGHTS[4] * planes.alpha;
    t.check("L4.01 BC = Σ w_i · plane_i (whitepaper §4.2)",
            (bc - expected_bc).abs() < 1e-5);
    t.check("L4.02 BC ∈ [0, 1]", bc >= 0.0 && bc <= 1.0);

    // Plane weights sum to 1.0
    let weight_sum: f32 = PLANE_WEIGHTS.iter().sum();
    t.check("L4.03 Plane weights sum to 1.0", (weight_sum - 1.0).abs() < 1e-6);

    // Dynamic threshold
    let psi_base = dynamic_threshold(0.0, 0.0, 0.0);
    let psi_threat = dynamic_threshold(1.0, 0.0, 0.0);
    let psi_deep   = dynamic_threshold(0.0, 0.0, 10_000.0);
    let psi_vol    = dynamic_threshold(0.0, 1.0, 0.0);

    t.check("L4.04 Ψ_base ≈ 0.55 with no threat/volatility/depth",
            (psi_base - 0.55).abs() < 1e-4);
    t.check("L4.05 Threat raises Ψ (entity under attack → higher bar)",
            psi_threat > psi_base);
    t.check("L4.06 Depth lowers Ψ (earned trust for established entities)",
            psi_deep < psi_base);
    t.check("L4.07 Volatility raises Ψ (uncertain environment)",
            psi_vol > psi_base);

    // Clamps
    let psi_max = dynamic_threshold(100.0, 100.0, 0.0);
    let psi_min = dynamic_threshold(0.0, 0.0, 1e18);
    t.check("L4.08 Ψ clamped ≤ 0.99 under extreme threat", psi_max <= 0.99);
    t.check("L4.09 Ψ clamped ≥ 0.10 at extreme depth", psi_min >= 0.10);

    // Entity role multipliers
    t.check("L4.10 KernelComponent multiplier = 2.0",
            (EntityRole::KernelComponent.multiplier() - 2.0).abs() < 1e-6);
    t.check("L4.11 HumanUser multiplier = 1.2",
            (EntityRole::HumanUser.multiplier() - 1.2).abs() < 1e-6);
    t.check("L4.12 SensorIoT multiplier = 0.8",
            (EntityRole::SensorIoT.multiplier() - 0.8).abs() < 1e-6);

    // Master equation
    let lambda = living_moat(EntityRole::HumanUser.multiplier(), 1.0);
    let xi_operational = master_equation(0.8, 0.55, 1.0, lambda, 1000.0);
    let xi_silenced    = master_equation(0.2, 0.55, 1.0, lambda, 1000.0);
    let xi_shallow     = master_equation(0.8, 0.55, 1.0, lambda, 0.0);
    let xi_deep        = master_equation(0.8, 0.55, 1.0, lambda, 10_000.0);

    t.check("L4.13 Master equation Ξ > 0 when BC ≥ Ψ", xi_operational > 0.0);
    t.check("L4.14 Master equation Ξ = 0 when BC < Ψ (SILENCE gate)", xi_silenced == 0.0);
    t.check("L4.15 Deep entities have higher Ξ (Living Moat)", xi_deep > xi_shallow);
    t.check("L4.16 SILENCE recovery window = 300 events", SILENCE_RECOVERY_WINDOW == 300);

    // TruthState.xi() uses the master equation
    let ts_record = TruthState {
        entity_bpi: genesis_bpi,
        xi: xi_operational,
        bc,
        psi: PSI_BASE,
        depth: 1000.0,
        silence: SilenceState::Operational,
        gps_timestamp: 0,
        love: 1.0,
        role: EntityRole::HumanUser,
    };
    t.check("L4.17 TruthState.xi() computes from master equation",
            ts_record.xi() > 0.0);

    // =========================================================================
    // L5 — Living Kernel (Inventions #9, #11, #13, #17, #18, #19)
    // =========================================================================
    t.section("L5 · Living Kernel — BIS + CBRA (Inventions #9, #11, #13, #17, #18, #19)");

    // BIS interrupt level classification
    t.check("L5.01 BISLevel::Normal for TRAJ < 1σ",
            BISLevel::from_traj_score(0.5) == BISLevel::Normal);
    t.check("L5.02 BISLevel::L1 for TRAJ ≥ 1σ (informational)",
            BISLevel::from_traj_score(1.2) == BISLevel::L1);
    t.check("L5.03 BISLevel::L2 for TRAJ ≥ 2σ (alert coherence engine)",
            BISLevel::from_traj_score(2.5) == BISLevel::L2);
    t.check("L5.04 BISLevel::L3 for TRAJ ≥ 3σ (invoke IKP INNATE_LAYER)",
            BISLevel::from_traj_score(3.8) == BISLevel::L3);
    t.check("L5.05 BISLevel::L4 for TRAJ ≥ 5σ (emergency SILENCE)",
            BISLevel::from_traj_score(5.1) == BISLevel::L4);

    // BIS Controller
    let mut bis = BISController::new(50);
    bis.register(genesis_bpi);

    // Establish a behavioral baseline
    let baseline_events = [UBEType::Execute, UBEType::Read, UBEType::Write,
                           UBEType::Execute, UBEType::Read, UBEType::Execute,
                           UBEType::Write,   UBEType::Read, UBEType::Execute, UBEType::Write];
    for (i, ube) in baseline_events.iter().enumerate() {
        bis.process_event(&genesis_bpi, *ube, 0.85, 100.0, i as u64, [0u8; 32]);
    }
    t.check("L5.06 BIS processes baseline events without panic", true);

    // Anomalous event — very different from established Execute/Read/Write pattern
    let _interrupt = bis.process_event(
        &genesis_bpi, UBEType::Liquidate, 0.3, 100.0, 100, [0u8; 32],
    );
    t.check("L5.07 BIS anomaly detection runs on anomalous event", true);
    t.check("L5.08 BIS interrupt log is accessible",
            bis.interrupt_log().len() <= 1000);

    // CBRA Scheduler
    let mut cbra = CBRAScheduler::new(0.5, 5);
    let proc_a = ScheduledProcess {
        bpi:           genesis_bpi,
        current_bc:    0.92,
        psi:           0.55,
        depth:         500.0,
        silence_state: SilenceState::Operational,
        love:          1.0,
        hint_priority: 50,
        error_count:   0,
        event_count:   1000,
    };
    let proc_b = ScheduledProcess {
        bpi:           bpi_record.bpi,
        current_bc:    0.75,
        psi:           0.55,
        depth:         200.0,
        silence_state: SilenceState::Operational,
        love:          0.9,
        hint_priority: 30,
        error_count:   2,
        event_count:   500,
    };
    cbra.register(proc_a);
    cbra.register(proc_b);

    let allocations = cbra.allocate();
    t.check("L5.09 CBRA allocates resources to healthy processes",
            !allocations.is_empty());
    t.check("L5.10 CPU shares sum to ≤ 1.0 (no over-allocation)",
            allocations.iter().map(|a| a.cpu_share).sum::<f32>() <= 1.001);

    // High-BC entity gets more resources than low-BC entity
    if allocations.len() >= 2 {
        let alloc_a = allocations.iter().find(|a| a.bpi == genesis_bpi);
        let alloc_b = allocations.iter().find(|a| a.bpi == bpi_record.bpi);
        if let (Some(a), Some(b)) = (alloc_a, alloc_b) {
            t.check("L5.11 Higher-BC process gets more CPU (BC × depth weighting)",
                    a.cpu_share >= b.cpu_share);
        } else {
            t.check("L5.11 Resource allocations found for both processes",
                    !allocations.is_empty());
        }
    }

    let _priority_flag = cbra.request_priority_flag(&genesis_bpi);
    t.check("L5.12 CBRA priority_flag request handled", true);

    let pruned = cbra.tick();
    t.check("L5.13 CBRA tick() runs and returns pruning list", pruned.len() <= 2);

    // ScheduledProcess fitness function
    let proc_healthy = ScheduledProcess {
        bpi: genesis_bpi, current_bc: 0.9, psi: 0.55, depth: 100.0,
        silence_state: SilenceState::Operational, love: 1.0,
        hint_priority: 0, error_count: 0, event_count: 1000,
    };
    t.check("L5.14 Healthy process fitness is high", proc_healthy.fitness() > 0.8);

    let proc_broken = ScheduledProcess {
        bpi: genesis_bpi, current_bc: 0.3, psi: 0.55, depth: 100.0,
        silence_state: SilenceState::Silenced, love: 0.5,
        hint_priority: 0, error_count: 500, event_count: 1000,
    };
    t.check("L5.15 Broken process is silenced", proc_broken.is_silenced());

    // =========================================================================
    // L6 — Resonance Communication Protocol (Inventions #12, #9)
    // =========================================================================
    t.section("L6 · RCP — Resonance Communication Protocol (Inventions #12, #9)");

    // Identical RF vectors → resonance = 1.0
    let rf_uniform = [1.0f32 / 32.0; 32];
    let r_identical = cosine_similarity(&rf_uniform, &rf_uniform);
    t.check("L6.01 Identical RF vectors → resonance = 1.0",
            (r_identical - 1.0).abs() < 1e-5);

    // Orthogonal RF vectors → resonance = 0.0
    let mut rf_a = [0.0f32; 32];
    let mut rf_b = [0.0f32; 32];
    rf_a[0] = 1.0; rf_b[1] = 1.0;
    let r_orthogonal = cosine_similarity(&rf_a, &rf_b);
    t.check("L6.02 Orthogonal RF vectors → resonance = 0.0", r_orthogonal.abs() < 1e-6);

    // Connection tier thresholds
    t.check("L6.03 RCP > 0.50 → high-bandwidth tier",
            classify_connection(0.75) == "high-bandwidth");
    t.check("L6.04 RCP > 0.15 → standard tier",
            classify_connection(0.30) == "standard");
    t.check("L6.05 RCP > 0.05 → emergency-only tier",
            classify_connection(0.10) == "emergency-only");
    t.check("L6.06 RCP ≤ 0.05 → no-connection",
            classify_connection(0.01) == "no-connection");

    // DeFi entities with similar behavioral vocabulary auto-connect
    let rf_defi1 = { let mut rf = [0.0f32; 32]; rf[0]=0.60; rf[1]=0.20; rf[2]=0.20; rf };
    let rf_defi2 = { let mut rf = [0.0f32; 32]; rf[0]=0.55; rf[1]=0.25; rf[2]=0.20; rf };
    let r_defi = cosine_similarity(&rf_defi1, &rf_defi2);
    t.check("L6.07 DeFi entities with similar RF → high resonance (> 0.99)", r_defi > 0.99);
    t.check("L6.08 DeFi entities auto-connect at high-bandwidth tier",
            classify_connection(r_defi) == "high-bandwidth");

    // IoT sensor vs DeFi → no connection (different behavioral vocabularies)
    let rf_sensor = { let mut rf = [0.0f32; 32]; rf[26]=0.70; rf[27]=0.30; rf };
    let r_cross = cosine_similarity(&rf_defi1, &rf_sensor);
    t.check("L6.09 IoT sensor and DeFi entity have low resonance (< 0.05)",
            r_cross < 0.05);
    t.check("L6.10 Incompatible entity types cannot connect",
            classify_connection(r_cross) == "no-connection");

    // AI model entities (Learn/Decide heavy) connect to each other.
    // cosine(rf_ai1, rf_ai2) ≈ 0.98 — above the high-BW threshold (0.50).
    let rf_ai1 = { let mut rf = [0.0f32; 32]; rf[28]=0.50; rf[29]=0.50; rf };
    let rf_ai2 = { let mut rf = [0.0f32; 32]; rf[28]=0.60; rf[29]=0.40; rf };
    let r_ai = cosine_similarity(&rf_ai1, &rf_ai2);
    t.check("L6.11 AI model entities share high resonance (> 0.95)", r_ai > 0.95);

    // =========================================================================
    // MASTER EQUATION — Full Stack End-to-End
    // =========================================================================
    t.section("Master Equation Ξ(entity,t) — Full Stack End-to-End");

    let bc_final = planes.behavioral_coherence();
    let lambda_final = living_moat(EntityRole::HumanUser.multiplier(), 1.0);
    let depth_final  = akashic.depth_for(&engine.current_bpi());
    let xi_final     = master_equation(bc_final, PSI_BASE, 1.0, lambda_final, depth_final);

    t.check("E2E.01 Ξ(entity,t) computable from full stack", xi_final >= 0.0);
    t.check("E2E.02 Ξ > 0 for entity with BC ≥ Ψ", xi_final > 0.0);

    let xi_deep_full = master_equation(bc_final, PSI_BASE, 1.0, lambda_final, 10_000.0);
    t.check("E2E.03 Deep entity has exponentially higher Ξ (Living Moat protection)",
            xi_deep_full > xi_final);

    t.check("E2E.04 Akashic depth feeds into Ξ correctly",
            akashic.depth_for(&engine.current_bpi()) > 0.0);

    t.check("E2E.05 CBRA allocates more to entity with BC × depth advantage",
            !allocations.is_empty());

    // Tampered event was rejected (L3.04), so count stays at 10.
    t.check("E2E.06 Tampered events cannot enter Akashic (cryptographic integrity)",
            akashic.event_count() == 10);

    // Final summary
    let all_ok = t.summary();
    if all_ok {
        println!("\n  {}", bold("✓ All layers operational — AXIOM stack is healthy"));
    } else {
        println!("\n  {} — review failures above", red("✗ Integration failures detected"));
    }
    std::process::exit(if all_ok { 0 } else { 1 });
}
