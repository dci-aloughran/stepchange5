import { beforeEach, describe, expect, it, vi } from "vitest";

// Clerk, the database and the audit log are all mocked: these tests cover
// the account-deletion flow's handling of the Clerk identity only.
const clerk = vi.hoisted(() => ({
  deleteUser: vi.fn(),
  verifyToken: vi.fn(),
  createClerkClient: vi.fn(),
}));
vi.mock("@clerk/backend", () => ({
  createClerkClient: clerk.createClerkClient,
  verifyToken: clerk.verifyToken,
}));

const audit = vi.hoisted(() => vi.fn());
vi.mock("../audit.js", () => ({ audit, track: vi.fn() }));

// Any drizzle chain resolves to [] (no rows), which is enough for a user
// with no homes or uploads.
const db = vi.hoisted(() => {
  const chain: unknown = new Proxy(() => {}, {
    get: (_t, prop) =>
      prop === "then"
        ? (resolve: (v: unknown) => void) => resolve([])
        : () => chain,
    apply: () => chain,
  });
  return { getDb: () => chain };
});
vi.mock("../../db/client.js", async () => ({
  getDb: db.getDb,
  schema: await import("../../db/schema.js"),
}));

const { deleteClerkUser, subjectHash } = await import("./clerk.js");
const { profileRoutes } = await import("../../routes/profile.js");

const USER = "user_test123";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CLERK_SECRET_KEY = "sk_test_mock";
  clerk.createClerkClient.mockReturnValue({
    users: { deleteUser: clerk.deleteUser },
  });
  clerk.verifyToken.mockResolvedValue({ sub: USER });
  clerk.deleteUser.mockResolvedValue({ id: USER });
  audit.mockResolvedValue(undefined);
});

describe("deleteClerkUser", () => {
  it("deletes the Clerk user with the server secret key", async () => {
    await expect(deleteClerkUser(USER)).resolves.toEqual({ deleted: true });
    expect(clerk.createClerkClient).toHaveBeenCalledWith({
      secretKey: "sk_test_mock",
    });
    expect(clerk.deleteUser).toHaveBeenCalledWith(USER);
    expect(audit).not.toHaveBeenCalled();
  });

  it("treats an already-deleted user as success", async () => {
    clerk.deleteUser.mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 }),
    );
    await expect(deleteClerkUser(USER)).resolves.toEqual({
      deleted: true,
      alreadyGone: true,
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it("audits a warning (without the user id) when Clerk fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    clerk.deleteUser.mockRejectedValue(
      Object.assign(new Error("boom"), { status: 500 }),
    );
    await expect(deleteClerkUser(USER)).resolves.toEqual({
      deleted: false,
      reason: "clerk_http_500",
    });
    expect(audit).toHaveBeenCalledWith("account.identity_delete_failed", {
      userId: null,
      severity: "warn",
      payload: { subjectHash: subjectHash(USER), reason: "clerk_http_500" },
    });
  });

  it("audits a warning when no secret key is configured", async () => {
    delete process.env.CLERK_SECRET_KEY;
    const res = await deleteClerkUser(USER);
    expect(res).toEqual({ deleted: false, reason: "clerk_secret_key_missing" });
    expect(clerk.deleteUser).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      "account.identity_delete_failed",
      expect.objectContaining({ severity: "warn" }),
    );
  });

  it("never throws, even if the audit write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    clerk.deleteUser.mockRejectedValue(new Error("network"));
    audit.mockRejectedValueOnce(new Error("db down"));
    await expect(deleteClerkUser(USER)).resolves.toEqual({
      deleted: false,
      reason: "error",
    });
  });
});

describe("DELETE /profile", () => {
  const del = () =>
    profileRoutes.request("/", {
      method: "DELETE",
      headers: { Authorization: "Bearer token" },
    });

  it("deletes the data, then the Clerk user", async () => {
    const res = await del();
    expect(res.status).toBe(204);
    expect(clerk.deleteUser).toHaveBeenCalledWith(USER);
    expect(audit).toHaveBeenCalledWith("account.data_deleted", {
      userId: null,
      payload: expect.objectContaining({
        subjectHash: subjectHash(USER),
        identityDeleted: true,
      }),
    });
  });

  it("still succeeds when Clerk deletion fails, and audits a warning", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    clerk.deleteUser.mockRejectedValue(
      Object.assign(new Error("unavailable"), { status: 503 }),
    );
    const res = await del();
    expect(res.status).toBe(204);
    expect(audit).toHaveBeenCalledWith(
      "account.identity_delete_failed",
      expect.objectContaining({ severity: "warn" }),
    );
    expect(audit).toHaveBeenCalledWith("account.data_deleted", {
      userId: null,
      payload: expect.objectContaining({ identityDeleted: false }),
    });
  });
});
