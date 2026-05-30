//! Core AkashicIndex implementation — TimescaleDB + Redis.
//!
//! Uses runtime sqlx queries (no compile-time DB required).
//! Deploy against TimescaleDB with schema from schema.rs.

use axiom_core::types::{UniversalBehavioralHash, BPI, UBEType, GpsTimestampNs};
use anyhow::Result;
use sqlx::PgPool;
use std::sync::Arc;

/// TimescaleDB row for akashic_events table.
#[derive(Debug, sqlx::FromRow)]
pub struct AkashicEventRow {
    pub entity_bpi:       Vec<u8>,
    pub event_type:       i16,
    pub event_subtype:    i16,
    pub prior_hash:       Vec<u8>,
    pub causal_context:   Vec<u8>,
    pub gps_timestamp:    i64,
    pub device_timestamp: i64,
    pub environment_hash: Vec<u8>,
    pub event_payload:    Vec<u8>,
    pub entropy_proof:    Vec<u8>,
    pub validator_sig:    Vec<u8>,
    pub self_hash:        Vec<u8>,
    pub bc_at_event:      f32,
    pub depth_at_event:   f64,
}

impl From<AkashicEventRow> for UniversalBehavioralHash {
    fn from(row: AkashicEventRow) -> Self {
        let mut entity_bpi       = [0u8; 32];
        let mut prior_hash       = [0u8; 32];
        let mut causal_context   = [0u8; 32];
        let mut environment_hash = [0u8; 32];
        let mut entropy_proof    = [0u8; 32];
        let mut validator_sig    = [0u8; 32];
        let mut self_hash        = [0u8; 32];

        let copy = |dst: &mut [u8; 32], src: &[u8]| {
            let n = src.len().min(32);
            dst[..n].copy_from_slice(&src[..n]);
        };
        copy(&mut entity_bpi,       &row.entity_bpi);
        copy(&mut prior_hash,       &row.prior_hash);
        copy(&mut causal_context,   &row.causal_context);
        copy(&mut environment_hash, &row.environment_hash);
        copy(&mut entropy_proof,    &row.entropy_proof);
        copy(&mut validator_sig,    &row.validator_sig);
        copy(&mut self_hash,        &row.self_hash);

        UniversalBehavioralHash {
            entity_bpi,
            event_type: UBEType::from_u8(row.event_type as u8).unwrap_or(UBEType::Execute),
            event_subtype: row.event_subtype as u8,
            prior_hash,
            causal_context,
            gps_timestamp:    row.gps_timestamp as u64,
            device_timestamp: row.device_timestamp as u64,
            environment_hash,
            event_payload: row.event_payload,
            entropy_proof,
            validator_sig,
            self_hash,
            bc_at_event:    row.bc_at_event,
            depth_at_event: row.depth_at_event,
        }
    }
}

/// The Living Akashic Index — the ground truth of all AXIOM behavior.
pub struct AkashicIndex {
    pool:  Arc<PgPool>,
    redis: Option<redis::Client>,
}

impl AkashicIndex {
    /// Connect to TimescaleDB and optionally Redis.
    pub async fn connect(database_url: &str, redis_url: Option<&str>) -> Result<Self> {
        let pool = PgPool::connect(database_url).await?;
        let redis = if let Some(url) = redis_url {
            Some(redis::Client::open(url)?)
        } else {
            None
        };
        Ok(Self { pool: Arc::new(pool), redis })
    }

    /// Append a UBH record to the Akashic Index (APPEND-ONLY — Invariant I1).
    pub async fn append(&self, ubh: &UniversalBehavioralHash) -> Result<()> {
        if !ubh.verify_self_hash() {
            anyhow::bail!("UBH self_hash verification failed — event rejected");
        }

        sqlx::query(
            r#"INSERT INTO akashic_events (
                entity_bpi, event_type, event_subtype,
                prior_hash, causal_context,
                gps_timestamp, device_timestamp,
                environment_hash, event_payload,
                entropy_proof, validator_sig, self_hash,
                bc_at_event, depth_at_event
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)"#,
        )
        .bind(ubh.entity_bpi.as_slice())
        .bind(ubh.event_type as i16)
        .bind(ubh.event_subtype as i16)
        .bind(ubh.prior_hash.as_slice())
        .bind(ubh.causal_context.as_slice())
        .bind(ubh.gps_timestamp as i64)
        .bind(ubh.device_timestamp as i64)
        .bind(ubh.environment_hash.as_slice())
        .bind(ubh.event_payload.as_slice())
        .bind(ubh.entropy_proof.as_slice())
        .bind(ubh.validator_sig.as_slice())
        .bind(ubh.self_hash.as_slice())
        .bind(ubh.bc_at_event)
        .bind(ubh.depth_at_event)
        .execute(self.pool.as_ref())
        .await?;

        // Write to Redis hot cache (TTL = 24 h)
        if let Some(rc) = &self.redis {
            if let Ok(mut conn) = rc.get_async_connection().await {
                let key   = format!("ubh:{}:{}", hex::encode(ubh.entity_bpi), ubh.gps_timestamp);
                let value = serde_json::to_vec(ubh)?;
                let _: () = redis::AsyncCommands::set_ex(&mut conn, key, value, 86400u64).await
                    .unwrap_or(());
            }
        }
        Ok(())
    }

    /// Get cumulative Akashic Depth D(entity, t).
    pub async fn get_depth(&self, bpi: &[u8]) -> Result<f64> {
        let row: Option<(Option<f64>,)> = sqlx::query_as(
            r#"SELECT cumulative_depth
               FROM entity_depth
               WHERE entity_bpi = $1
               ORDER BY hour DESC
               LIMIT 1"#,
        )
        .bind(bpi)
        .fetch_optional(self.pool.as_ref())
        .await?;

        Ok(row.and_then(|(d,)| d).unwrap_or(0.0))
    }

    /// Get events for an entity in a GPS-nanosecond time range.
    pub async fn get_events(
        &self,
        bpi: &[u8],
        from_ns: GpsTimestampNs,
        to_ns:   GpsTimestampNs,
    ) -> Result<Vec<UniversalBehavioralHash>> {
        let rows: Vec<AkashicEventRow> = sqlx::query_as(
            r#"SELECT entity_bpi, event_type, event_subtype,
                      prior_hash, causal_context,
                      gps_timestamp, device_timestamp,
                      environment_hash, event_payload,
                      entropy_proof, validator_sig, self_hash,
                      bc_at_event, depth_at_event
               FROM akashic_events
               WHERE entity_bpi = $1
                 AND gps_timestamp BETWEEN $2 AND $3
               ORDER BY gps_timestamp ASC"#,
        )
        .bind(bpi)
        .bind(from_ns as i64)
        .bind(to_ns   as i64)
        .fetch_all(self.pool.as_ref())
        .await?;

        Ok(rows.into_iter().map(UniversalBehavioralHash::from).collect())
    }

    /// Get latest N events (Redis hot-cache → TimescaleDB fallback).
    pub async fn get_latest_events(&self, bpi: &[u8], n: u32) -> Result<Vec<UniversalBehavioralHash>> {
        // Try Redis hot cache first
        if let Some(rc) = &self.redis {
            if let Ok(mut conn) = rc.get_async_connection().await {
                let pattern = format!("ubh:{}:*", hex::encode(bpi));
                let keys: Vec<String> = redis::AsyncCommands::keys(&mut conn, &pattern)
                    .await.unwrap_or_default();
                if !keys.is_empty() {
                    let mut sorted = keys;
                    sorted.sort();
                    let from = sorted.len().saturating_sub(n as usize);
                    let mut events = Vec::new();
                    for key in &sorted[from..] {
                        let val: Option<Vec<u8>> = redis::AsyncCommands::get(&mut conn, key)
                            .await.unwrap_or(None);
                        if let Some(bytes) = val {
                            if let Ok(ubh) = serde_json::from_slice::<UniversalBehavioralHash>(&bytes) {
                                events.push(ubh);
                            }
                        }
                    }
                    if !events.is_empty() { return Ok(events); }
                }
            }
        }

        // Fallback to TimescaleDB
        let rows: Vec<AkashicEventRow> = sqlx::query_as(
            r#"SELECT entity_bpi, event_type, event_subtype,
                      prior_hash, causal_context,
                      gps_timestamp, device_timestamp,
                      environment_hash, event_payload,
                      entropy_proof, validator_sig, self_hash,
                      bc_at_event, depth_at_event
               FROM akashic_events
               WHERE entity_bpi = $1
               ORDER BY gps_timestamp DESC
               LIMIT $2"#,
        )
        .bind(bpi)
        .bind(n as i64)
        .fetch_all(self.pool.as_ref())
        .await?;

        let mut events: Vec<UniversalBehavioralHash> = rows.into_iter()
            .map(UniversalBehavioralHash::from)
            .collect();
        events.reverse(); // chronological order
        Ok(events)
    }

    /// Get the Ξ (truth state) snapshot for an entity.
    pub async fn get_truth_state(&self, bpi: &[u8]) -> Result<Option<TruthStateRow>> {
        let row: Option<TruthStateRow> = sqlx::query_as(
            r#"SELECT entity_bpi, bc, psi, depth, love, xi, gps_timestamp
               FROM entity_truth_state
               WHERE entity_bpi = $1
               ORDER BY gps_timestamp DESC
               LIMIT 1"#,
        )
        .bind(bpi)
        .fetch_optional(self.pool.as_ref())
        .await?;

        Ok(row)
    }

    /// Compute 32-dim resonance frequency vector for RCP (L6).
    pub async fn get_resonance_vector(&self, bpi: &[u8], window_secs: i64) -> Result<[f32; 32]> {
        let cutoff = chrono::Utc::now()
            .timestamp_nanos_opt().unwrap_or(0) - window_secs * 1_000_000_000;

        let rows: Vec<(i16, Option<i64>)> = sqlx::query_as(
            r#"SELECT event_type, count(*) as cnt
               FROM akashic_events
               WHERE entity_bpi = $1
                 AND gps_timestamp > $2
               GROUP BY event_type"#,
        )
        .bind(bpi)
        .bind(cutoff)
        .fetch_all(self.pool.as_ref())
        .await?;

        let total: i64 = rows.iter().map(|(_, c)| c.unwrap_or(0)).sum();
        let total = total.max(1) as f32;

        let mut rf = [0f32; 32];
        for (etype, cnt) in rows {
            let idx = (etype as usize).saturating_sub(1).min(31);
            rf[idx] = cnt.unwrap_or(0) as f32 / total;
        }
        Ok(rf)
    }

    /// Count total events for an entity.
    pub async fn event_count(&self, bpi: &[u8]) -> Result<i64> {
        let row: (Option<i64>,) = sqlx::query_as(
            "SELECT count(*) FROM akashic_events WHERE entity_bpi = $1",
        )
        .bind(bpi)
        .fetch_one(self.pool.as_ref())
        .await?;
        Ok(row.0.unwrap_or(0))
    }

    /// Pool health check.
    pub async fn ping(&self) -> Result<()> {
        sqlx::query("SELECT 1").fetch_one(self.pool.as_ref()).await?;
        Ok(())
    }
}

/// Snapshot of entity truth state.
#[derive(Debug, sqlx::FromRow)]
pub struct TruthStateRow {
    pub entity_bpi:     Vec<u8>,
    pub bc:             f32,
    pub psi:            f32,
    pub depth:          f64,
    pub love:           f32,
    pub xi:             f64,
    pub gps_timestamp:  i64,
}
