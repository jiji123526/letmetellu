export type InitChannelRow = Record<string, unknown>;

export interface InitChannelControlProjection {
  projection_owner_uid?: string | null;
  owner_name?: string | null;
  owner_channel_count?: number;
  reports_owner_id?: string | null;
}

export function mergeInitChannelProjection(
  channel: InitChannelRow,
  projection: InitChannelControlProjection | null,
): InitChannelRow {
  const canonicalOwnerUid = typeof channel.owner_uid === "string"
    ? channel.owner_uid
    : "";
  const projectedOwnerUid = typeof projection?.projection_owner_uid === "string"
    ? projection.projection_owner_uid
    : "";
  const ownerMatches = Boolean(
    canonicalOwnerUid && canonicalOwnerUid === projectedOwnerUid,
  );

  return {
    ...channel,
    owner_name: ownerMatches ? projection?.owner_name ?? null : null,
    owner_channel_count: ownerMatches
      ? Math.max(0, Math.min(Number(projection?.owner_channel_count) || 0, 2))
      : 0,
    reports_owner_id: projection?.reports_owner_id ?? null,
  };
}
