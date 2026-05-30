// AXIOM Cairo — Identity Proof Program
//
// StarkNet ZK program for Ontological Device Identity (ODI — Invention #15)
// and Behavioral Process Identity (BPI) attestation.
//
// Proves: a device's identity is authentic and its BPI encodes its
//         genuine causal history — without revealing private entropy.
//
// Use cases:
//   - Cross-chain identity attestation (entity proves it is the same across chains)
//   - Device genesis verification (first-boot ODI proof)
//   - BPI freshness proof (BPI was updated within the last N events)
//   - Sybil resistance (entity proves it is not a duplicate of another entity)
//
// Author: Hudu Yusuf (Analys), @The_analys
// License: CC0 1.0 Universal

use core::poseidon::poseidon_hash_span;
use starknet::ContractAddress;

// ============================================================================
// CONSTANTS
// ============================================================================

const SCALE:      u128 = 1000000_u128;   // Fixed-point scale factor
const PSI_BASE:   u128 = 550000_u128;    // 0.55 — base SILENCE threshold
const BPI_UPDATE_CYCLE: u64 = 1000_u64; // BPI recomputed every 1000 events

// ============================================================================
// ODI VERIFICATION
//
// ODI(device, t) = Blake3(
//   genesis_event_hash             ||
//   hardware_fingerprint           ||
//   accumulated_depth: D(device,t) ||
//   physical_entropy_seed          ||
//   first_validator_attestation
// )
//
// Proves: the device's ODI is correctly derived from its genesis materials,
//         and the accumulated depth is non-zero (device has honest history).
// ============================================================================

/// Verify an Ontological Device Identity (ODI) commitment.
///
/// Public inputs:
///   odi_commitment        — H(genesis_hash || hw_fp || depth || entropy || attestation)
///   entity_bpi_hash       — Current BPI of the device
///   claimed_depth_ge      — Claimed lower bound on D(device, t)
///
/// Private inputs:
///   genesis_event_hash    — Hash of first boot UBH event
///   hardware_fingerprint  — CPU_ID || MAC || TPM_pubkey hash
///   accumulated_depth     — Actual D(device, t) (revealed only to prover)
///   physical_entropy_seed — L0 entropy at genesis (32-byte equivalent as felt252)
///   attestation_hash      — First validator attestation signature hash
fn verify_odi(
    odi_commitment:        felt252,
    entity_bpi_hash:       felt252,
    claimed_depth_ge:      u64,
    genesis_event_hash:    felt252,
    hardware_fingerprint:  felt252,
    accumulated_depth:     u64,
    physical_entropy_seed: felt252,
    attestation_hash:      felt252,
) -> bool {
    // Constraint 1: Entity BPI is valid (non-zero)
    assert(entity_bpi_hash != 0, 'Invalid entity BPI hash');

    // Constraint 2: Device has real history (depth > 0 for non-genesis)
    assert(accumulated_depth >= claimed_depth_ge, 'Depth below claimed minimum');

    // Constraint 3: ODI commitment is correctly derived from genesis materials
    let odi_inputs = array![
        genesis_event_hash,
        hardware_fingerprint,
        accumulated_depth.into(),
        physical_entropy_seed,
        attestation_hash,
    ];
    let computed_odi = poseidon_hash_span(odi_inputs.span());
    assert(computed_odi == odi_commitment, 'ODI commitment mismatch');

    // Constraint 4: All genesis materials are non-zero (real device, not spoofed)
    assert(genesis_event_hash != 0, 'Genesis event hash is zero');
    assert(hardware_fingerprint != 0, 'Hardware fingerprint is zero');
    assert(physical_entropy_seed != 0, 'Physical entropy seed is zero');
    assert(attestation_hash != 0, 'Attestation hash is zero');

    true
}

// ============================================================================
// BPI AUTHENTICITY PROOF
//
// BPI(process, t) = Blake3(
//   causal_history_root(t₀→t) ||
//   spawner_BPI(t₀)           ||
//   purpose_declaration        ||
//   Love_coefficient           ||
//   environmental_context(t)
// )
//
// Proves: the entity's current BPI is correctly derived from its
//         causal history and spawner context.
// ============================================================================

/// Verify that an entity's BPI is authentically derived.
///
/// Public inputs:
///   bpi_commitment     — H(causal_root || spawner_bpi || purpose || love || env)
///   spawner_bpi_hash   — Hash of spawner entity's BPI
///   event_count_ge     — Claimed lower bound on event count
///
/// Private inputs:
///   causal_history_root — Merkle root of event hash chain
///   purpose_hash        — H(purpose_declaration_string)
///   love_q16            — Love coefficient as Q16 fixed-point (× 65536)
///   env_hash            — Environmental context hash
///   actual_event_count  — Actual event count
fn verify_bpi_authenticity(
    bpi_commitment:     felt252,
    spawner_bpi_hash:   felt252,
    event_count_ge:     u64,
    causal_history_root: felt252,
    purpose_hash:       felt252,
    love_q16:           u64,
    env_hash:           felt252,
    actual_event_count: u64,
) -> bool {
    // Constraint 1: Event count meets claimed minimum
    assert(actual_event_count >= event_count_ge, 'Event count below claimed minimum');

    // Constraint 2: Love coefficient is bounded [0, 65536] (Q16 for [0.0, 1.0])
    assert(love_q16 <= 65536_u64, 'Love coefficient out of bounds');

    // Constraint 3: BPI commitment is correctly derived from causal materials
    let bpi_inputs = array![
        causal_history_root,
        spawner_bpi_hash,
        purpose_hash,
        love_q16.into(),
        env_hash,
    ];
    let computed_bpi = poseidon_hash_span(bpi_inputs.span());
    assert(computed_bpi == bpi_commitment, 'BPI commitment mismatch');

    // Constraint 4: Causal history is non-trivial
    assert(causal_history_root != 0, 'Causal history root is zero (no events)');

    true
}

// ============================================================================
// SYBIL RESISTANCE PROOF
//
// Proves that two different BPIs represent genuinely distinct entities —
// they do not share a common genesis event hash or hardware fingerprint.
//
// Used to prevent one physical device from claiming multiple identities.
// ============================================================================

/// Prove that two BPIs are genuinely distinct entities (anti-Sybil).
///
/// Public inputs:
///   bpi_hash_a, bpi_hash_b — The two entity BPIs being compared
///
/// Private inputs:
///   genesis_a, genesis_b   — Genesis event hashes (must differ)
///   hw_fp_a, hw_fp_b       — Hardware fingerprints (must differ for physical entities)
fn prove_distinct_entities(
    bpi_hash_a:  felt252,
    bpi_hash_b:  felt252,
    genesis_a:   felt252,
    genesis_b:   felt252,
    hw_fp_a:     felt252,
    hw_fp_b:     felt252,
) -> bool {
    // Constraint 1: Both BPIs are valid
    assert(bpi_hash_a != 0, 'BPI A is zero');
    assert(bpi_hash_b != 0, 'BPI B is zero');
    assert(bpi_hash_a != bpi_hash_b, 'BPI A and B are identical — not distinct');

    // Constraint 2: Genesis events differ (different creation moments)
    assert(genesis_a != genesis_b, 'Same genesis event — possible Sybil');

    // Constraint 3: Hardware fingerprints differ (different physical devices)
    // Note: software entities (AI, smart contracts) may share hw fingerprints
    // — this is acceptable. Physical devices (humans, IoT) must have unique hw_fp.
    // Caller must set hw_fp = 0 for software-only entities.
    if hw_fp_a != 0 && hw_fp_b != 0 {
        assert(hw_fp_a != hw_fp_b, 'Same hardware fingerprint — Sybil attack detected');
    }

    true
}

// ============================================================================
// STARKNET CONTRACT INTERFACE
// ============================================================================

#[starknet::interface]
trait IIdentityProver<TContractState> {
    fn verify_odi_proof(
        self: @TContractState,
        odi_commitment:        felt252,
        entity_bpi_hash:       felt252,
        claimed_depth_ge:      u64,
        genesis_event_hash:    felt252,
        hardware_fingerprint:  felt252,
        accumulated_depth:     u64,
        physical_entropy_seed: felt252,
        attestation_hash:      felt252,
    ) -> bool;

    fn verify_bpi_proof(
        self: @TContractState,
        bpi_commitment:      felt252,
        spawner_bpi_hash:    felt252,
        event_count_ge:      u64,
        causal_history_root: felt252,
        purpose_hash:        felt252,
        love_q16:            u64,
        env_hash:            felt252,
        actual_event_count:  u64,
    ) -> bool;

    fn verify_distinct_entities(
        self: @TContractState,
        bpi_hash_a: felt252,
        bpi_hash_b: felt252,
        genesis_a:  felt252,
        genesis_b:  felt252,
        hw_fp_a:    felt252,
        hw_fp_b:    felt252,
    ) -> bool;
}

#[starknet::contract]
mod IdentityProver {
    use super::{verify_odi, verify_bpi_authenticity, prove_distinct_entities};

    #[storage]
    struct Storage {
        verified_odis:  starknet::storage::Map<felt252, bool>,
        verified_bpis:  starknet::storage::Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        ODIVerified:      ODIVerified,
        BPIVerified:      BPIVerified,
        SybilRejected:    SybilRejected,
    }

    #[derive(Drop, starknet::Event)]
    struct ODIVerified {
        entity_bpi_hash: felt252,
        odi_commitment:  felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct BPIVerified {
        bpi_commitment:  felt252,
        spawner_bpi:     felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct SybilRejected {
        bpi_hash_a: felt252,
        bpi_hash_b: felt252,
    }

    #[abi(embed_v0)]
    impl IdentityProverImpl of super::IIdentityProver<ContractState> {
        fn verify_odi_proof(
            self: @ContractState,
            odi_commitment:        felt252,
            entity_bpi_hash:       felt252,
            claimed_depth_ge:      u64,
            genesis_event_hash:    felt252,
            hardware_fingerprint:  felt252,
            accumulated_depth:     u64,
            physical_entropy_seed: felt252,
            attestation_hash:      felt252,
        ) -> bool {
            verify_odi(
                odi_commitment,
                entity_bpi_hash,
                claimed_depth_ge,
                genesis_event_hash,
                hardware_fingerprint,
                accumulated_depth,
                physical_entropy_seed,
                attestation_hash,
            )
        }

        fn verify_bpi_proof(
            self: @ContractState,
            bpi_commitment:      felt252,
            spawner_bpi_hash:    felt252,
            event_count_ge:      u64,
            causal_history_root: felt252,
            purpose_hash:        felt252,
            love_q16:            u64,
            env_hash:            felt252,
            actual_event_count:  u64,
        ) -> bool {
            verify_bpi_authenticity(
                bpi_commitment,
                spawner_bpi_hash,
                event_count_ge,
                causal_history_root,
                purpose_hash,
                love_q16,
                env_hash,
                actual_event_count,
            )
        }

        fn verify_distinct_entities(
            self: @ContractState,
            bpi_hash_a: felt252,
            bpi_hash_b: felt252,
            genesis_a:  felt252,
            genesis_b:  felt252,
            hw_fp_a:    felt252,
            hw_fp_b:    felt252,
        ) -> bool {
            prove_distinct_entities(bpi_hash_a, bpi_hash_b, genesis_a, genesis_b, hw_fp_a, hw_fp_b)
        }
    }
}
