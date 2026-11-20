import { getDb, schema } from "../db/client.js";

export async function audit(
  type: string,
  opts: {
    userId?: string | null;
    severity?: "info" | "warn" | "critical";
    payload?: Record<string, unknown>;
  } = {},
) {
  await getDb()
    .insert(schema.auditEvents)
    .values({
      type,
      userId: opts.userId ?? null,
      severity: opts.severity ?? "info",
      payload: opts.payload ?? {},
    });
}

// OP-001..003. Callers must not put sensitive content (names, addresses,
// children's details, images) into props.
export async function track(
  name: string,
  opts: {
    userId?: string | null;
    journeyType?: "buyer" | "homeowner" | null;
    device?: string | null;
    props?: Record<string, unknown>;
  } = {},
) {
  await getDb()
    .insert(schema.analyticsEvents)
    .values({
      name,
      userId: opts.userId ?? null,
      journeyType: opts.journeyType ?? null,
      device: opts.device ?? null,
      props: opts.props ?? {},
    });
}
