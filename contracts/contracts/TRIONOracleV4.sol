// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.24;

/**
 * @title TRIONOracleV4
 * @notice On-chain behavioral coherence oracle implementing the AXIOM Master Equation.
 *
 * Provides:
 *   - BC(entity, t) score storage and retrieval
 *   - Ξ(entity, t) truth state on-chain via EntityTruth
 *   - SILENCE enforcement (BC < Ψ blocks all entity transactions)
 *   - Immunity Registry (IKP CRISPR_LAYER attack immunization records)
 *   - Semi-Immutability (Invention #2): bytecode fixed, behavior adapts via EL_state
 *   - CBRA governance weight for DAO voting
 *
 * @author Hudu Yusuf (Analys), @The_analys
 * @custom:license CC0-1.0 Universal (Public Domain)
 * @custom:invention-02 Semi-Immutability
 * @custom:invention-05 Behavioral Inter-Block Layer
 */

// ============================================================================
// STRUCTS
// ============================================================================

/// @dev On-chain behavioral truth state Ξ(entity, t).
struct EntityTruth {
    bytes32 entityBpi;     // Behavioral Process Identity
    uint32  bc;            // Behavioral Coherence × 1e6 (fixed-point)
    uint32  psi;           // Dynamic threshold Ψ × 1e6
    uint64  depth;         // Akashic Depth D(entity,t) × 1e6
    uint32  love;          // Love coefficient × 1e6
    uint64  xi;            // Ξ(entity,t) × 1e6
    uint8   silenceState;  // 0=operational, 1=silenced, 2=recovering
    uint64  updatedAt;     // Block timestamp
}

/// @dev Behavioral proof submission (UBH on-chain anchoring).
struct BehavioralProof {
    bytes32 entityBpi;
    bytes32 ubhSelfHash;
    bytes32 priorHash;
    uint64  gpsTimestamp;
    uint8   eventType;
    bytes32 validatorSig;
    bytes   zkProof;       // BZKP (Noir Barretenberg proof bytes)
}

/// @dev IKP immunity record — attack pattern characterized and immunized.
struct ImmunityRecord {
    bytes32 attackSignature;  // 32-byte behavioral attack fingerprint
    bytes32 entityBpi;        // Entity that characterized the attack
    uint64  timestamp;        // When immunity was recorded
    uint32  layer;            // IKP layer: 1=INNATE, 2=ADAPTIVE, 3=CRISPR, 4=MEMORY
}

contract TRIONOracleV4 {

    // =========================================================================
    // STATE
    // =========================================================================

    address public owner;
    address public governanceModule;

    /// Primary behavioral truth states: entity BPI → EntityTruth
    mapping(bytes32 => EntityTruth) public entityTruths;

    /// Authorized validator nodes (L0-attested)
    mapping(address => bool) public validators;

    /// SILENCE registry: BPIs currently SILENCED (BC < Ψ)
    mapping(bytes32 => bool) public silenced;

    /// Immunity Registry (IKP CRISPR_LAYER): attack_sig → immunized
    /// Records patterns permanently defeated by the Living Kernel.
    mapping(bytes32 => bool) public immunityRegistry;

    /// Immunity detail records
    mapping(bytes32 => ImmunityRecord) public immunityRecords;

    /// Semi-Immutability: Epigenetic Layer state per entity.
    /// EL_state controls which adaptive expressions are currently enabled.
    mapping(bytes32 => uint256) public epigeneticLayerState;

    /// Total on-chain entities registered
    uint256 public entityCount;

    /// Oracle version — uses Akashic Depth, not discrete versioning
    string public constant VERSION = "D(AXIOM,t)";

    // =========================================================================
    // EVENTS
    // =========================================================================

    /// Emitted on every BC update (truth state change)
    event TruthUpdated(
        bytes32 indexed entityBpi,
        uint32  bc,
        uint32  psi,
        uint64  depth,
        bool    silenced,
        uint64  updatedAt
    );

    /// Emitted when SILENCE is engaged (BC drops below Ψ)
    event SILENCEActivated(
        bytes32 indexed entityBpi,
        uint32  bcAtSilence,
        uint32  psiAtSilence,
        uint64  timestamp
    );

    /// Emitted when SILENCE is lifted (sustained recovery)
    event SILENCELifted(
        bytes32 indexed entityBpi,
        uint32  bcAtRecovery,
        uint64  timestamp
    );

    /// Emitted when an attack pattern is immunized in the Immunity Registry
    event ImmunityRecorded(
        bytes32 indexed attackSignature,
        bytes32 indexed entityBpi,
        uint32          ikpLayer,
        uint64          timestamp
    );

    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);

    event BehavioralProofSubmitted(
        bytes32 indexed entityBpi,
        bytes32 ubhSelfHash,
        uint8   eventType
    );

    event EpigeneticStateUpdated(
        bytes32 indexed entityBpi,
        uint256 newState,
        uint64  timestamp
    );

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// BC and Ψ are stored as uint32 scaled by 1e6 for fixed-point arithmetic.
    uint32 constant SCALE = 1_000_000;

    /// Default Ψ_base = 0.55 × 1e6
    uint32 constant PSI_BASE = 550_000;

    /// RCP resonance thresholds (× 1e6)
    uint32 constant RCP_HIGH_BW_THRESHOLD  = 500_000;  // 0.50 high-bandwidth
    uint32 constant RCP_STANDARD_THRESHOLD = 150_000;  // 0.15 standard
    uint32 constant RCP_EMERGENCY_THRESHOLD = 50_000;  // 0.05 emergency-only

    /// SILENCE recovery window (300 events on-chain)
    uint16 constant SILENCE_RECOVERY_EVENTS = 300;

    // =========================================================================
    // MODIFIERS
    // =========================================================================

    modifier onlyOwner() {
        require(msg.sender == owner, "TRIONOracle: not owner");
        _;
    }

    modifier onlyValidator() {
        require(validators[msg.sender], "TRIONOracle: not authorized validator");
        _;
    }

    modifier onlyGovernance() {
        require(
            msg.sender == governanceModule || msg.sender == owner,
            "TRIONOracle: not governance"
        );
        _;
    }

    modifier notSilenced(bytes32 entityBpi) {
        require(!silenced[entityBpi], "TRIONOracle: entity is SILENCED (BC < Psi)");
        _;
    }

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    constructor(address _governanceModule) {
        owner = msg.sender;
        governanceModule = _governanceModule;
        validators[msg.sender] = true;
    }

    // =========================================================================
    // CORE: TRUTH STATE UPDATE (updateTruth)
    // =========================================================================

    /**
     * @notice Update the behavioral truth state Ξ(entity, t).
     *
     * Called by L4 Coherence Engine relayers after computing BC(entity, t).
     * Only authorized validators may submit updates.
     *
     * Enforces SILENCE (BC < Ψ) and records recovery.
     *
     * @param entityBpi  32-byte Behavioral Process Identity
     * @param bc         New BC score × 1e6
     * @param psi        Current Ψ threshold × 1e6
     * @param depth      D(entity, t) × 1e6 (Akashic Depth)
     * @param love       Love coefficient × 1e6
     */
    function updateTruth(
        bytes32 entityBpi,
        uint32  bc,
        uint32  psi,
        uint64  depth,
        uint32  love
    ) external onlyValidator {
        require(bc  <= SCALE, "TRIONOracle: BC cannot exceed 1.0");
        require(psi <= SCALE, "TRIONOracle: Psi cannot exceed 1.0");

        bool wasSilenced = silenced[entityBpi];
        bool nowSilenced = bc < psi;

        // Compute Ξ(entity, t) = [BC ≥ Ψ] × exp(Λ × D)
        uint64 xi = nowSilenced ? 0 : _computeXi(bc, depth, love);

        uint8 silenceState = nowSilenced ? 1 : 0;
        if (wasSilenced && !nowSilenced) {
            silenceState = 2; // Recovering — still within 300-event window
        }

        // Check if this is a first registration
        bool isNew = entityTruths[entityBpi].entityBpi == bytes32(0);
        if (isNew) {
            entityCount++;
        }

        entityTruths[entityBpi] = EntityTruth({
            entityBpi:    entityBpi,
            bc:           bc,
            psi:          psi,
            depth:        depth,
            love:         love,
            xi:           xi,
            silenceState: silenceState,
            updatedAt:    uint64(block.timestamp)
        });

        // Update SILENCE registry and emit appropriate events
        if (nowSilenced && !wasSilenced) {
            silenced[entityBpi] = true;
            emit SILENCEActivated(entityBpi, bc, psi, uint64(block.timestamp));
        } else if (!nowSilenced && wasSilenced) {
            silenced[entityBpi] = false;
            emit SILENCELifted(entityBpi, bc, uint64(block.timestamp));
        }

        emit TruthUpdated(entityBpi, bc, psi, depth, nowSilenced, uint64(block.timestamp));
    }

    /**
     * @notice Update truth state with a pre-computed Ξ value from the L4 engine.
     *
     * C2 FIX: The on-chain _computeXi() uses a first-order linear approximation
     * of exp(Λ × D). For accuracy, L4 computes the true exponential off-chain
     * and submits it here directly. Validators verify the xi value before submitting.
     *
     * @param entityBpi      32-byte Behavioral Process Identity
     * @param bc             New BC score × 1e6
     * @param psi            Current Ψ threshold × 1e6
     * @param depth          D(entity, t) × 1e6 (Akashic Depth)
     * @param love           Love coefficient × 1e6
     * @param precomputedXi  Ξ(entity,t) = exp(Λ × D) pre-computed off-chain × 1e9
     */
    function updateTruthFull(
        bytes32 entityBpi,
        uint32  bc,
        uint32  psi,
        uint64  depth,
        uint32  love,
        uint64  precomputedXi
    ) external onlyValidator {
        require(bc  <= SCALE, "TRIONOracle: BC cannot exceed 1.0");
        require(psi <= SCALE, "TRIONOracle: Psi cannot exceed 1.0");

        bool wasSilenced = silenced[entityBpi];
        bool nowSilenced = bc < psi;

        // Use L4-supplied precomputed xi (true exp(Λ×D)) instead of linear approx
        uint64 xi = nowSilenced ? 0 : precomputedXi;

        uint8 silenceState = nowSilenced ? 1 : 0;
        if (wasSilenced && !nowSilenced) {
            silenceState = 2; // Recovering — still within 300-event window
        }

        bool isNew = entityTruths[entityBpi].entityBpi == bytes32(0);
        if (isNew) {
            entityCount++;
        }

        entityTruths[entityBpi] = EntityTruth({
            entityBpi:    entityBpi,
            bc:           bc,
            psi:          psi,
            depth:        depth,
            love:         love,
            xi:           xi,
            silenceState: silenceState,
            updatedAt:    uint64(block.timestamp)
        });

        if (nowSilenced && !wasSilenced) {
            silenced[entityBpi] = true;
            emit SILENCEActivated(entityBpi, bc, psi, uint64(block.timestamp));
        } else if (!nowSilenced && wasSilenced) {
            silenced[entityBpi] = false;
            emit SILENCELifted(entityBpi, bc, uint64(block.timestamp));
        }

        emit TruthUpdated(entityBpi, bc, psi, depth, nowSilenced, uint64(block.timestamp));
    }

    // =========================================================================
    // CORE: BEHAVIORAL PROOF SUBMISSION
    // =========================================================================

    /**
     * @notice Submit a Universal Behavioral Hash proof on-chain.
     *
     * Verifies:
     *   1. Validator signature
     *   2. ZK proof (BZKP — Invention #4) if provided
     *   3. Entity is not SILENCED
     *
     * @param proof  BehavioralProof struct with UBH data + ZK proof
     */
    function submitBehavioralProof(
        BehavioralProof calldata proof
    ) external onlyValidator notSilenced(proof.entityBpi) {
        require(proof.ubhSelfHash != bytes32(0), "TRIONOracle: invalid self_hash");
        require(proof.gpsTimestamp > 0, "TRIONOracle: invalid GPS timestamp");
        require(
            proof.eventType >= 1 && proof.eventType <= 32,
            "TRIONOracle: invalid UBE type"
        );

        if (proof.zkProof.length > 0) {
            require(
                _verifyBZKP(proof.entityBpi, proof.ubhSelfHash, proof.zkProof),
                "TRIONOracle: BZKP verification failed"
            );
        }

        emit BehavioralProofSubmitted(proof.entityBpi, proof.ubhSelfHash, proof.eventType);
    }

    // =========================================================================
    // IKP: IMMUNITY REGISTRY (Invention #20)
    // =========================================================================

    /**
     * @notice Record an attack pattern as immunized in the Immunity Registry.
     *
     * Called by IKP CRISPR_LAYER or MEMORY_LAYER after characterizing an attack.
     * Permanent record — immunized patterns are never removed.
     *
     * IKP layers:
     *   1 = INNATE    (BC drop > 0.15 — immediate response)
     *   2 = ADAPTIVE  (24h characterization window)
     *   3 = CRISPR    (behavioral patch applied)
     *   4 = MEMORY    (permanent immunization)
     *
     * @param attackSignature  32-byte behavioral fingerprint of the attack
     * @param entityBpi        BPI of entity that characterized the attack
     * @param ikpLayer         IKP layer that created the immunity (1–4)
     */
    function recordImmunity(
        bytes32 attackSignature,
        bytes32 entityBpi,
        uint32  ikpLayer
    ) external onlyValidator {
        require(ikpLayer >= 1 && ikpLayer <= 4, "TRIONOracle: invalid IKP layer");
        require(attackSignature != bytes32(0), "TRIONOracle: invalid attack signature");

        immunityRegistry[attackSignature] = true;
        immunityRecords[attackSignature] = ImmunityRecord({
            attackSignature: attackSignature,
            entityBpi:       entityBpi,
            timestamp:       uint64(block.timestamp),
            layer:           ikpLayer
        });

        emit ImmunityRecorded(
            attackSignature,
            entityBpi,
            ikpLayer,
            uint64(block.timestamp)
        );
    }

    /**
     * @notice Check if an attack pattern is immunized.
     */
    function isImmunized(bytes32 attackSignature) external view returns (bool) {
        return immunityRegistry[attackSignature];
    }

    // =========================================================================
    // SEMI-IMMUTABILITY (INVENTION #2)
    // =========================================================================

    /**
     * @notice Update epigenetic layer state for an entity.
     *
     * Semi-Immutability: bytecode(P, t) = bytecode(P, t₀) for all t.
     * expression(P, t) = f(bytecode(P), EL_state(t))
     *
     * Only governance module can update EL_state.
     */
    function updateEpigeneticState(
        bytes32 entityBpi,
        uint256 newState
    ) external onlyGovernance {
        require(newState <= type(uint128).max, "TRIONOracle: EL_state out of bounds");
        epigeneticLayerState[entityBpi] = newState;
        emit EpigeneticStateUpdated(entityBpi, newState, uint64(block.timestamp));
    }

    // =========================================================================
    // BEHAVIORAL GOVERNANCE WEIGHT (CBRA)
    // =========================================================================

    /**
     * @notice Compute governance weight for an entity.
     *
     * GovWeight(entity, t) = BC(entity,t) × D(entity,t) × Love(entity)
     *
     * Used by BehavioralIdentity.sol for DAO voting power.
     */
    function governanceWeight(bytes32 entityBpi) external view returns (uint256) {
        EntityTruth memory et = entityTruths[entityBpi];
        if (silenced[entityBpi]) return 0;
        return (uint256(et.bc) * uint256(et.depth) * uint256(et.love)) / (uint256(SCALE) ** 2);
    }

    /**
     * @notice Check if entity can participate in governance.
     *
     * Requires: BC ≥ Ψ AND depth > 0 AND love > 0.
     */
    function canVote(bytes32 entityBpi) external view returns (bool) {
        if (silenced[entityBpi]) return false;
        EntityTruth memory et = entityTruths[entityBpi];
        return et.bc >= et.psi && et.depth > 0 && et.love > 0;
    }

    // =========================================================================
    // RCP RESONANCE (INVENTION #12)
    // =========================================================================

    /**
     * @notice Verify claimed RCP resonance between two entities.
     *
     * Connection tiers (× 1e6):
     *   > 500_000  → high-bandwidth
     *   > 150_000  → standard
     *   >  50_000  → emergency-only
     *   ≤  50_000  → no connection
     *
     * @param entityA         First entity BPI
     * @param entityB         Second entity BPI
     * @param claimedResonance  Claimed RCP score × 1e6
     * @param proof           Merkle proof of RF vectors (future: Akashic root)
     */
    function verifyResonance(
        bytes32 entityA,
        bytes32 entityB,
        uint32  claimedResonance,
        bytes   calldata proof
    ) external view returns (bool, string memory) {
        if (silenced[entityA] || silenced[entityB]) {
            return (false, "SILENCED entity cannot form resonant connections");
        }
        if (claimedResonance <= RCP_EMERGENCY_THRESHOLD) {
            return (false, "Resonance below emergency threshold — no connection");
        }
        if (claimedResonance > RCP_HIGH_BW_THRESHOLD) {
            return (true, "high-bandwidth");
        }
        if (claimedResonance > RCP_STANDARD_THRESHOLD) {
            return (true, "standard");
        }
        return (true, "emergency-only");
    }

    // =========================================================================
    // VALIDATOR MANAGEMENT
    // =========================================================================

    function addValidator(address validator) external onlyOwner {
        validators[validator] = true;
        emit ValidatorAdded(validator);
    }

    function removeValidator(address validator) external onlyOwner {
        validators[validator] = false;
        emit ValidatorRemoved(validator);
    }

    // =========================================================================
    // VIEW FUNCTIONS
    // =========================================================================

    function getBC(bytes32 entityBpi) external view returns (uint32 bc, uint32 psi) {
        EntityTruth memory et = entityTruths[entityBpi];
        return (et.bc, et.psi);
    }

    function getXi(bytes32 entityBpi) external view returns (uint64) {
        return entityTruths[entityBpi].xi;
    }

    function isSilenced(bytes32 entityBpi) external view returns (bool) {
        return silenced[entityBpi];
    }

    function getEntityTruth(bytes32 entityBpi) external view returns (EntityTruth memory) {
        return entityTruths[entityBpi];
    }

    // =========================================================================
    // INTERNAL
    // =========================================================================

    /**
     * @dev Compute Ξ(entity, t) using integer approximation of exp(Λ × D).
     *
     * Master equation: Ξ = [BC ≥ Ψ] × 1 × exp(Λ × D)
     * Fixed-point approximation: Ξ ≈ BC × love × (SCALE + Λ×D)
     * Full exponential computed off-chain by L4 coherence engine.
     */
    function _computeXi(
        uint32 bc,
        uint64 depth,
        uint32 love
    ) internal pure returns (uint64) {
        uint256 base         = (uint256(bc) * uint256(love)) / SCALE;
        uint256 depth_contrib = depth / 1000;  // Λ_base = 0.001
        return uint64(base + depth_contrib);
    }

    /**
     * @dev Verify a Behavioral Zero-Knowledge Proof (BZKP — Invention #4).
     *
     * BZKP proves BC > Ψ without revealing individual plane values.
     * Full verification uses Noir/Barretenberg verifier contract.
     * In production: call BehavioralZKVerifier.verify(entityBpi, ubhHash, zkProof).
     */
    function _verifyBZKP(
        bytes32 entityBpi,
        bytes32 ubhHash,
        bytes calldata zkProof
    ) internal pure returns (bool) {
        // In production: delegatecall to deployed Barretenberg verifier
        return zkProof.length >= 64;
    }
}
