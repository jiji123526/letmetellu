import type { Env } from "../types.ts";
import {
  type CanaryShardId,
  resolveCanaryProjectionSource,
} from "./channel-projection-dispatcher.ts";

interface VerificationJobRow {
  stage: string;
  status: string;
  message_snapshot_created_at: string | null;
  message_snapshot_id: string | null;
}

interface CountRow {
  count: number;
}

interface DerivedCountsRow {
  message_count: number;
  destination_actor_count: number;
  actor_orphan_count: number;
  gallery_expected_count: number;
  gallery_actual_count: number;
  gallery_mismatch_count: number;
  gallery_orphan_count: number;
  link_expected_count: number;
  link_actual_count: number;
  link_mismatch_count: number;
  link_orphan_count: number;
  fts_missing_count: number;
}

export interface CanaryMessageDerivedVerificationResult {
  shardId: CanaryShardId;
  channelId: string;
  stage: string;
  ready: boolean;
  blockers: string[];
  counts: {
    messages: number;
    sourceMessageActors: number;
    destinationMessageActors: number;
    actorOrphans: number;
    galleryExpected: number;
    galleryActual: number;
    galleryMismatches: number;
    galleryOrphans: number;
    linksExpected: number;
    linksActual: number;
    linkMismatches: number;
    linkOrphans: number;
    ftsMissing: number;
  };
}

export async function verifyCanaryMessageDerivedState(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
}): Promise<CanaryMessageDerivedVerificationResult> {
  const destination = resolveCanaryProjectionSource(
    input.env,
    input.shardId,
  ).database;
  const job = await destination.prepare(`
    SELECT
      stage,
      status,
      message_snapshot_created_at,
      message_snapshot_id
    FROM canary_channel_copy_jobs
    WHERE channel_id = ?
  `).bind(input.channelId).first<VerificationJobRow>();
  if (!job) throw new Error("canary_copy_job_missing");

  const emptyCounts = {
    messages: 0,
    sourceMessageActors: 0,
    destinationMessageActors: 0,
    actorOrphans: 0,
    galleryExpected: 0,
    galleryActual: 0,
    galleryMismatches: 0,
    galleryOrphans: 0,
    linksExpected: 0,
    linksActual: 0,
    linkMismatches: 0,
    linkOrphans: 0,
    ftsMissing: 0,
  };
  if (
    job.status !== "active"
    || (job.stage !== "message_links_rebuilt" && job.stage !== "delta_links_rebuilt")
    || !job.message_snapshot_id
    || job.message_snapshot_created_at === null
  ) {
    return {
      shardId: input.shardId,
      channelId: input.channelId,
      stage: job.stage,
      ready: false,
      blockers: ["message_dependent_stage_incomplete"],
      counts: emptyCounts,
    };
  }

  const [sourceActorRow, derived] = await Promise.all([
    input.env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM message_actor_identities AS actor
      INNER JOIN messages AS message
        ON message.id = actor.record_id
      WHERE actor.record_type = 'message'
        AND actor.channel_id = ?
        AND message.channel_id IN (?, ?)
        AND (
          COALESCE(message.created_at, '') < ?
          OR (COALESCE(message.created_at, '') = ? AND message.id <= ?)
        )
    `).bind(
      input.channelId,
      input.channelId,
      `${input.channelId}_live`,
      job.message_snapshot_created_at,
      job.message_snapshot_created_at,
      job.message_snapshot_id,
    ).first<CountRow>(),
    destination.prepare(`
      SELECT
        (SELECT COUNT(*) FROM messages
          WHERE channel_id IN (?, ?)) AS message_count,
        (SELECT COUNT(*) FROM message_actor_identities
          WHERE record_type = 'message' AND channel_id = ?)
          AS destination_actor_count,
        (SELECT COUNT(*)
          FROM message_actor_identities AS actor
          LEFT JOIN messages AS message ON message.id = actor.record_id
          WHERE actor.record_type = 'message'
            AND actor.channel_id = ?
            AND message.id IS NULL) AS actor_orphan_count,
        (SELECT COUNT(*) FROM messages
          WHERE channel_id IN (?, ?)
            AND deleted = 0 AND gallery_id IS NOT NULL AND image IS NOT NULL)
          AS gallery_expected_count,
        (SELECT COUNT(*) FROM gallery WHERE channel_id IN (?, ?))
          AS gallery_actual_count,
        (SELECT COUNT(*)
          FROM messages AS message
          LEFT JOIN gallery ON gallery.message_id = message.id
          WHERE message.channel_id IN (?, ?)
            AND message.deleted = 0
            AND message.gallery_id IS NOT NULL
            AND message.image IS NOT NULL
            AND (
              gallery.message_id IS NULL
              OR gallery.id != message.gallery_id
              OR gallery.channel_id != message.channel_id
              OR gallery.image != message.image
            )) AS gallery_mismatch_count,
        (SELECT COUNT(*)
          FROM gallery
          LEFT JOIN messages AS message ON message.id = gallery.message_id
          WHERE gallery.channel_id IN (?, ?)
            AND (
              message.id IS NULL
              OR message.deleted != 0
              OR message.gallery_id IS NULL
              OR message.image IS NULL
              OR gallery.id != message.gallery_id
              OR gallery.channel_id != message.channel_id
              OR gallery.image != message.image
            )) AS gallery_orphan_count,
        (SELECT COUNT(*) FROM messages
          WHERE channel_id IN (?, ?)
            AND deleted = 0
            AND (
              instr(text, 'http://') > 0
              OR instr(text, 'https://') > 0
              OR instr(text, 'www.') > 0
            )) AS link_expected_count,
        (SELECT COUNT(*) FROM message_links WHERE channel_id IN (?, ?))
          AS link_actual_count,
        (SELECT COUNT(*)
          FROM messages AS message
          LEFT JOIN message_links AS link ON link.message_id = message.id
          WHERE message.channel_id IN (?, ?)
            AND message.deleted = 0
            AND (
              instr(message.text, 'http://') > 0
              OR instr(message.text, 'https://') > 0
              OR instr(message.text, 'www.') > 0
            )
            AND (
              link.message_id IS NULL
              OR link.channel_id != message.channel_id
              OR link.created_at != message.created_at
            )) AS link_mismatch_count,
        (SELECT COUNT(*)
          FROM message_links AS link
          LEFT JOIN messages AS message ON message.id = link.message_id
          WHERE link.channel_id IN (?, ?)
            AND (
              message.id IS NULL
              OR message.deleted != 0
              OR NOT (
                instr(COALESCE(message.text, ''), 'http://') > 0
                OR instr(COALESCE(message.text, ''), 'https://') > 0
                OR instr(COALESCE(message.text, ''), 'www.') > 0
              )
              OR link.channel_id != message.channel_id
              OR link.created_at != message.created_at
            )) AS link_orphan_count,
        (SELECT COUNT(*)
          FROM messages AS message
          LEFT JOIN messages_fts AS fts ON fts.rowid = message.rowid
          WHERE message.channel_id IN (?, ?) AND fts.rowid IS NULL)
          AS fts_missing_count
    `).bind(
      input.channelId, `${input.channelId}_live`,
      input.channelId,
      input.channelId,
      input.channelId, `${input.channelId}_live`,
      input.channelId, `${input.channelId}_live`,
      input.channelId, `${input.channelId}_live`,
      input.channelId, `${input.channelId}_live`,
      input.channelId, `${input.channelId}_live`,
      input.channelId, `${input.channelId}_live`,
      input.channelId, `${input.channelId}_live`,
      input.channelId, `${input.channelId}_live`,
      input.channelId, `${input.channelId}_live`,
    ).first<DerivedCountsRow>(),
  ]);
  if (!derived) throw new Error("canary_derived_counts_missing");

  const sourceActorCount = Number(sourceActorRow?.count || 0);
  const blockers: string[] = [];
  if (sourceActorCount !== Number(derived.destination_actor_count)) {
    blockers.push("message_actor_count_mismatch");
  }
  if (Number(derived.actor_orphan_count) !== 0) {
    blockers.push("message_actor_orphaned");
  }
  if (
    Number(derived.gallery_expected_count) !== Number(derived.gallery_actual_count)
    || Number(derived.gallery_mismatch_count) !== 0
    || Number(derived.gallery_orphan_count) !== 0
  ) {
    blockers.push("gallery_derived_mismatch");
  }
  if (
    Number(derived.link_expected_count) !== Number(derived.link_actual_count)
    || Number(derived.link_mismatch_count) !== 0
    || Number(derived.link_orphan_count) !== 0
  ) {
    blockers.push("message_links_derived_mismatch");
  }
  if (Number(derived.fts_missing_count) !== 0) {
    blockers.push("messages_fts_missing");
  }

  return {
    shardId: input.shardId,
    channelId: input.channelId,
    stage: job.stage,
    ready: blockers.length === 0,
    blockers,
    counts: {
      messages: Number(derived.message_count),
      sourceMessageActors: sourceActorCount,
      destinationMessageActors: Number(derived.destination_actor_count),
      actorOrphans: Number(derived.actor_orphan_count),
      galleryExpected: Number(derived.gallery_expected_count),
      galleryActual: Number(derived.gallery_actual_count),
      galleryMismatches: Number(derived.gallery_mismatch_count),
      galleryOrphans: Number(derived.gallery_orphan_count),
      linksExpected: Number(derived.link_expected_count),
      linksActual: Number(derived.link_actual_count),
      linkMismatches: Number(derived.link_mismatch_count),
      linkOrphans: Number(derived.link_orphan_count),
      ftsMissing: Number(derived.fts_missing_count),
    },
  };
}
