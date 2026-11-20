import { verifyToken } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { getDb, schema } from "../db/client.js";
import { allowedOrigins } from "../lib/origins.js";

export type AuthEnv = {
  Variables: {
    userId: string;
  };
};

// Verifies the Clerk session JWT sent by the app as a Bearer token and
// ensures a local users row exists.
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) throw new HTTPException(401, { message: "Unauthorized" });

  let userId: string;
  try {
    const claims = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      authorizedParties: allowedOrigins(),
    });
    userId = claims.sub;
  } catch {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const db = getDb();
  const [user] = await db
    .insert(schema.users)
    .values({ id: userId })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: { updatedAt: new Date() },
    })
    .returning({ suspendedAt: schema.users.suspendedAt });
  if (user?.suspendedAt) {
    throw new HTTPException(403, { message: "Account suspended" });
  }

  c.set("userId", userId);
  await next();
});

export async function ensureUser(userId: string) {
  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return user;
}
