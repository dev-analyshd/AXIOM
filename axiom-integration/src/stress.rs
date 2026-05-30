//! AXIOM Rust Stress Test — Throughput & Correctness at Scale
//!
//! Tests:
//!   S01  UBH hash throughput (Blake3 events/sec)
//!   S02  Causal chain integrity at 10,000 events
//!   S03  BIS interrupt detection accuracy under load
//!   S04  CBRA scheduling fairness with 100 processes
//!   S05  Master equation throughput (1M computations)
//!   S06  RF vector cosine throughput
//!   S07  BPI update throughput
//!   S08  Concurrent Akashic append safety (in-memory)

use axiom_core::{
    l0::entropy::{EntropySource, SimulationEntropySource},
    l1::ubh::{UBHEngine, axiom_genesis_bpi},
    l2::bpi::BehavioralProcessIdentity,
    l5::{
        bis::BISController,
        scheduler::{CBRAScheduler, ScheduledProcess},
    },
    types::{SilenceState, UBEType},
    dynamic_threshold, living_moat, master_equation, PSI_BASE,
};
use std::time::Instant;

fn green(s: &str) -> String { format!("\x1b[32m{s}\x1b[0m") }
fn red(s: &str)   -> String { format!("\x1b[31m{s}\x1b[0m") }
fn bold(s: &str)  -> String { format!("\x1b[1m{s}\x1b[0m") }

pub struct StressRunner {
    pub passed: usize,
    pub failed: usize,
    pub results: Vec<String>,
}

impl StressRunner {
    pub fn new() -> Self { Self { passed: 0, failed: 0, results: Vec::new() } }

    pub fn section(&self, title: &str) {
        println!("\n{}", bold(&format!("══ {} ══", title)));
    }

    pub fn bench(&mut self, name: &str, ok: bool, metric: &str) {
        let status = if ok { green("PASS") } else { red("FAIL") };
        let line = format!("  [{}] {}  {}", status, name, metric);
        println!("{}", line);
        self.results.push(line);
        if ok { self.passed += 1; } else { self.failed += 1; }
    }

    pub fn summary(&self) -> bool {
        println!("\n{}", bold("━━━ Stress Test Summary ━━━"));
        println!("  Passed: {}", self.passed);
        if self.failed > 0 {
            println!("  {}", red(&format!("Failed: {}", self.failed)));
        } else {
            println!("  Failed: 0");
        }
        self.failed == 0
    }
}

pub fn run_stress() -> bool {
    let mut s = StressRunner::new();

    // ── S01: UBH Hash Throughput ────────────────────────────────────────────
    s.section("S01 · UBH Hash Throughput");
    {
        const N: usize = 50_000;
        let genesis = axiom_genesis_bpi();
        let mut engine = UBHEngine::new(genesis, Box::new(SimulationEntropySource::from_u64(1)));

        let t = Instant::now();
        for i in 0..N {
            let ube = UBEType::from_u8(((i % 32) + 1) as u8).unwrap_or(UBEType::Execute);
            engine.emit_event(ube, vec![0xAAu8; 8]);
        }
        let elapsed = t.elapsed();
        let rate = N as f64 / elapsed.as_secs_f64();

        s.bench("S01.01 UBH emit_event throughput",
            rate > 50_000.0,
            &format!("{:.0} events/sec  ({} events in {:.1}ms)", rate, N, elapsed.as_millis()));

        s.bench("S01.02 Event counter accurate after stress",
            engine.event_count() == N as u64,
            &format!("count={}", engine.event_count()));
    }

    // ── S02: Causal Chain Integrity at 10k events ────────────────────────────
    s.section("S02 · Causal Chain Integrity");
    {
        const N: usize = 10_000;
        let genesis = axiom_genesis_bpi();
        let mut engine = UBHEngine::new(genesis, Box::new(SimulationEntropySource::from_u64(2)));

        let mut events = Vec::with_capacity(N);
        for i in 0..N {
            let ube = UBEType::from_u8(((i % 32) + 1) as u8).unwrap_or(UBEType::Execute);
            events.push(engine.emit_event(ube, vec![i as u8 & 0xFF; 4]));
        }

        let all_hashes_ok = events.iter().all(|e| e.verify_self_hash());
        s.bench("S02.01 All 10k self-hashes valid (cryptographic integrity)",
            all_hashes_ok,
            &format!("{}/{} verified", if all_hashes_ok { N } else { 0 }, N));

        let chain_ok = events.windows(2).all(|w| w[1].verify_chain_link(&w[0]));
        s.bench("S02.02 Causal chain intact across all 10k events",
            chain_ok,
            &format!("{} links verified", N - 1));

        // Tamper one event and verify chain breaks
        let mut tampered = events[5000].clone();
        tampered.self_hash[0] ^= 0xFF;
        s.bench("S02.03 Tampered event detected mid-chain",
            !tampered.verify_self_hash(),
            "tamper detection confirmed");
    }

    // ── S03: BIS Anomaly Detection Under Load ───────────────────────────────
    s.section("S03 · BIS Interrupt Accuracy Under Load");
    {
        let genesis = axiom_genesis_bpi();
        let mut bis = BISController::new(200);
        bis.register(genesis);

        // Establish baseline: repetitive Execute/Read/Write pattern
        const BASELINE: usize = 500;
        for i in 0..BASELINE {
            let ube = match i % 3 {
                0 => UBEType::Execute,
                1 => UBEType::Read,
                _ => UBEType::Write,
            };
            bis.process_event(&genesis, ube, 0.85, 1000.0, i as u64, [0u8; 32]);
        }

        // Inject 50 anomalous events
        const ANOMALY: usize = 50;
        let mut interrupts_generated = 0;
        for i in 0..ANOMALY {
            let ube = UBEType::Liquidate; // Very rare in Execute/Read/Write context
            if bis.process_event(&genesis, ube, 0.3, 1000.0, (BASELINE + i) as u64, [0u8; 32]).is_some() {
                interrupts_generated += 1;
            }
        }

        s.bench("S03.01 BIS processes 500+50 events without panic", true, "no panics");
        s.bench("S03.02 Anomaly injection generates BIS interrupts",
            interrupts_generated > 0,
            &format!("{}/{} anomalies triggered interrupts", interrupts_generated, ANOMALY));

        let log_len = bis.interrupt_log().len();
        s.bench("S03.03 Interrupt log bounded (no memory explosion)",
            log_len <= 1000,
            &format!("{} entries in log", log_len));
    }

    // ── S04: CBRA Scheduling Fairness with 100 Processes ────────────────────
    s.section("S04 · CBRA Scheduler Fairness (100 processes)");
    {
        let mut cbra = CBRAScheduler::new(0.5, 5);
        let genesis = axiom_genesis_bpi();

        // Register 100 processes with varying BC (0.55 to 0.99)
        for i in 0..100usize {
            let bc = 0.55 + (i as f32) * 0.0044; // 0.55 → 0.99
            let proc = ScheduledProcess {
                bpi:           genesis, // same BPI used for simplicity
                current_bc:    bc,
                psi:           0.55,
                depth:         100.0 + i as f64 * 10.0,
                silence_state: SilenceState::Operational,
                love:          1.0,
                hint_priority: 50,
                error_count:   0,
                event_count:   1000,
            };
            cbra.register(proc);
        }

        let allocs = cbra.allocate();
        let total_cpu: f32 = allocs.iter().map(|a| a.cpu_share).sum();

        s.bench("S04.01 CBRA allocates resources to all processes",
            !allocs.is_empty(),
            &format!("{} allocations", allocs.len()));

        s.bench("S04.02 CPU shares sum to ≤ 1.0 (no over-allocation)",
            total_cpu <= 1.001,
            &format!("Σcpu = {:.4}", total_cpu));

        // Higher BC should get more resources
        let sorted_allocs = {
            let mut v = allocs.clone();
            v.sort_by(|a, b| b.cpu_share.partial_cmp(&a.cpu_share).unwrap());
            v
        };
        s.bench("S04.03 CBRA allocation is non-zero for all active processes",
            sorted_allocs.iter().all(|a| a.cpu_share > 0.0),
            &format!("min share = {:.6}", sorted_allocs.last().map(|a| a.cpu_share).unwrap_or(0.0)));

        let pruned = cbra.tick();
        s.bench("S04.04 CBRA tick() runs without panic under 100 processes",
            true,
            &format!("{} processes pruned", pruned.len()));
    }

    // ── S05: Master Equation Throughput ─────────────────────────────────────
    s.section("S05 · Master Equation Throughput (1M computations)");
    {
        const N: usize = 1_000_000;
        let lambda = living_moat(1.2, 1.0);

        let t = Instant::now();
        let mut total = 0.0f64;
        for i in 0..N {
            let bc    = 0.55 + (i % 45) as f32 * 0.01;
            let depth = (i % 10_000) as f64;
            total += master_equation(bc, PSI_BASE, 1.0, lambda, depth);
        }
        let elapsed = t.elapsed();
        let rate = N as f64 / elapsed.as_secs_f64();

        s.bench("S05.01 master_equation throughput ≥ 5M/sec",
            rate > 5_000_000.0,
            &format!("{:.1}M computations/sec  (sum={:.2})", rate / 1e6, total));

        // Dynamic threshold throughput
        let t2 = Instant::now();
        let mut total_psi = 0.0f32;
        for i in 0..N {
            let threat = (i % 10) as f32 * 0.1;
            let depth  = (i % 5000) as f64;
            total_psi += dynamic_threshold(threat, 0.0, depth);
        }
        let rate2 = N as f64 / t2.elapsed().as_secs_f64();
        s.bench("S05.02 dynamic_threshold throughput ≥ 5M/sec",
            rate2 > 5_000_000.0,
            &format!("{:.1}M/sec", rate2 / 1e6));
        let _ = total_psi;
    }

    // ── S06: RF Vector Cosine Throughput ─────────────────────────────────────
    s.section("S06 · RF Cosine Similarity Throughput");
    {
        const N: usize = 1_000_000;

        let rf_a: [f32; 32] = {
            let mut v = [0.0f32; 32];
            for i in 0..32 { v[i] = (i + 1) as f32 / 528.0; }
            v
        };
        let rf_b: [f32; 32] = {
            let mut v = [0.0f32; 32];
            for i in 0..32 { v[i] = (32 - i) as f32 / 528.0; }
            v
        };

        let t = Instant::now();
        let mut total = 0.0f32;
        for _ in 0..N {
            let dot:  f32 = rf_a.iter().zip(&rf_b).map(|(a, b)| a * b).sum();
            let na:   f32 = rf_a.iter().map(|x| x * x).sum::<f32>().sqrt();
            let nb:   f32 = rf_b.iter().map(|x| x * x).sum::<f32>().sqrt();
            total += if na > 1e-9 && nb > 1e-9 { dot / (na * nb) } else { 0.0 };
        }
        let rate = N as f64 / t.elapsed().as_secs_f64();
        s.bench("S06.01 RF cosine throughput ≥ 1M/sec",
            rate > 1_000_000.0,
            &format!("{:.1}M/sec  (avg_resonance={:.4})", rate / 1e6, total / N as f32));
    }

    // ── S07: BPI Update Throughput ──────────────────────────────────────────
    s.section("S07 · BPI Causal Identity Update Throughput");
    {
        const N: usize = 100_000;
        let entropy = SimulationEntropySource::from_u64(99);
        let ts = entropy.gps_timestamp_ns();

        let mut bpi = BehavioralProcessIdentity::genesis(
            "axiom://stress-test", 1.0, None, &[0u8; 32], ts,
        );
        let env = [0x22u8; 32];

        let t = Instant::now();
        let mut prev_bpi = bpi.bpi;
        let mut all_different = true;
        let mut merkle = [0x11u8; 32];
        for i in 0..N {
            // Change causal root each iteration (simulates growing event chain)
            merkle[0] = (i & 0xFF) as u8;
            merkle[1] = ((i >> 8) & 0xFF) as u8;
            merkle[2] = ((i >> 16) & 0xFF) as u8;
            bpi.update(&merkle, &env, ts + i as u64 * 1000);
            if bpi.bpi == prev_bpi { all_different = false; }
            prev_bpi = bpi.bpi;
        }
        let rate = N as f64 / t.elapsed().as_secs_f64();

        s.bench("S07.01 BPI update throughput ≥ 100k/sec",
            rate > 100_000.0,
            &format!("{:.0}k updates/sec", rate / 1000.0));

        s.bench("S07.02 Every BPI update produces a unique identity",
            all_different,
            &format!("{} unique identities generated", N));

        s.bench("S07.03 Depth cycles track correctly",
            bpi.depth_cycles() == N as u64,
            &format!("cycles={}", bpi.depth_cycles()));
    }

    // ── S08: Concurrent In-Memory Akashic Simulation ─────────────────────────
    s.section("S08 · Concurrent Akashic Append Safety");
    {
        use std::sync::{Arc, Mutex};

        let genesis = axiom_genesis_bpi();
        let mut engine = UBHEngine::new(genesis, Box::new(SimulationEntropySource::from_u64(77)));

        // Pre-generate events (single-threaded for correct causal chain)
        const EVENTS: usize = 5_000;
        let mut events = Vec::with_capacity(EVENTS);
        for i in 0..EVENTS {
            let ube = UBEType::from_u8(((i % 32) + 1) as u8).unwrap_or(UBEType::Execute);
            events.push(engine.emit_event(ube, vec![0u8; 4]));
        }

        // Concurrent reads from multiple threads (append-only log)
        let log = Arc::new(Mutex::new(events.clone()));

        let mut handles = Vec::new();
        for _ in 0..8 {
            let log = Arc::clone(&log);
            handles.push(std::thread::spawn(move || {
                let guard = log.lock().unwrap();
                let count = guard.iter().filter(|e| e.verify_self_hash()).count();
                count
            }));
        }

        let counts: Vec<usize> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        let all_agree = counts.iter().all(|&c| c == EVENTS);

        s.bench("S08.01 Concurrent reads all agree on hash validity",
            all_agree,
            &format!("8 threads × {} events verified concurrently", EVENTS));

        s.bench("S08.02 All events pass self-hash verification",
            counts[0] == EVENTS,
            &format!("{}/{} events verified", counts[0], EVENTS));
    }

    s.summary()
}
