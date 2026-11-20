// Pure planning for syncing a local list to a server collection.
//
// Rules:
// - a local item mapped to an existing server record is updated only when it
//   differs (so repeat syncs are no-ops);
// - an unmapped local item (or one whose server record has gone) is created;
// - an incomplete local item (payload null) is left alone: an existing
//   server copy is kept as it was, nothing new is created;
// - any server record not mapped to a current local item is deleted, so the
//   server ends up with exactly one record per local item.

export type CollectionPlan<S, P> = {
  creates: { localId: string; payload: P }[];
  updates: { localId: string; server: S; payload: P }[];
  deletes: string[];
  // Local id → server id for records that already exist and are kept.
  kept: Record<string, string>;
  skipped: string[];
};

export function planCollection<L extends { id: string }, S extends { id: string }, P>(
  local: L[],
  map: Record<string, string> | undefined,
  server: S[],
  toPayload: (item: L) => P | null,
  changed: (server: S, payload: P) => boolean,
): CollectionPlan<S, P> {
  const byId = new Map(server.map((s) => [s.id, s]));
  const plan: CollectionPlan<S, P> = {
    creates: [],
    updates: [],
    deletes: [],
    kept: {},
    skipped: [],
  };
  const claimed = new Set<string>();
  for (const item of local) {
    const serverId = map?.[item.id];
    const existing =
      serverId && !claimed.has(serverId) ? byId.get(serverId) : undefined;
    const payload = toPayload(item);
    if (existing) {
      claimed.add(existing.id);
      plan.kept[item.id] = existing.id;
      if (payload === null) plan.skipped.push(item.id);
      else if (changed(existing, payload)) {
        plan.updates.push({ localId: item.id, server: existing, payload });
      }
      continue;
    }
    if (payload === null) {
      plan.skipped.push(item.id);
      continue;
    }
    plan.creates.push({ localId: item.id, payload });
  }
  plan.deletes = server.filter((s) => !claimed.has(s.id)).map((s) => s.id);
  return plan;
}

// The final local → server map after a plan has run.
export function mergeIds(
  kept: Record<string, string>,
  created: Record<string, string>,
): Record<string, string> {
  return { ...kept, ...created };
}

// Rooms the user confirmed locally that the server hasn't marked reviewed.
export function roomsToReview(
  localRooms: { id: string }[],
  ids: Record<string, string>,
  serverReviewed: Record<string, boolean>,
  confirmed: (localId: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const room of localRooms) {
    const serverId = ids[room.id];
    if (!serverId || !confirmed(room.id)) continue;
    if (!serverReviewed[serverId]) out.push(serverId);
  }
  return out;
}
