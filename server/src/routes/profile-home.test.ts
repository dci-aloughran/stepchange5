import { CreateRoomSchema } from "@stepchange/shared";
import { Hono } from "hono";
import { hc } from "hono/client";
import { HTTPException } from "hono/http-exception";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import type { AppType } from "../index.js";
import app from "../index.js";
import { validate } from "../lib/profile/validate.js";

describe("profile and home routes require auth", () => {
  const cases: Array<[string, string]> = [
    ["GET", "/profile/me"],
    ["PATCH", "/profile/me"],
    ["GET", "/profile/household"],
    ["GET", "/profile/persons"],
    ["GET", "/profile/accessibility"],
    ["GET", "/profile/possessions"],
    ["GET", "/profile/export"],
    ["DELETE", "/profile"],
    ["GET", "/homes"],
    ["POST", "/homes"],
    ["GET", "/homes/00000000-0000-4000-8000-000000000001/overview"],
    ["DELETE", "/homes/00000000-0000-4000-8000-000000000001"],
  ];
  it.each(cases)("%s %s -> 401", async (method, path) => {
    const res = await app.request(path, { method });
    expect(res.status).toBe(401);
  });
});

describe("validate()", () => {
  const test = new Hono()
    .post(
      "/rooms/:roomId",
      validate("param", z.object({ roomId: z.uuid() })),
      validate("json", CreateRoomSchema),
      (c) => c.json(c.req.valid("json")),
    )
    .onError((err, c) =>
      err instanceof HTTPException
        ? c.json({ error: err.message }, err.status)
        : c.json({ error: "boom" }, 500),
    );
  const post = (id: string, body: unknown) =>
    test.request(`/rooms/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("returns 404 for malformed ids", async () => {
    const res = await post("not-a-uuid", { name: "Lounge" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("returns 400 { error } for invalid bodies", async () => {
    const res = await post("00000000-0000-4000-8000-000000000001", {
      name: "Lounge",
      widthCm: -1,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^widthCm: /);
  });

  it("passes valid bodies through", async () => {
    const res = await post("00000000-0000-4000-8000-000000000001", {
      name: "Lounge",
    });
    expect(res.status).toBe(200);
  });
});

describe("RPC types", () => {
  it("exposes typed routes to the app", () => {
    const client = hc<AppType>("http://localhost");
    expectTypeOf(client.profile.me.$patch).toBeFunction();
    expectTypeOf(client.profile.household.$put).toBeFunction();
    expectTypeOf(client.profile.export.$get).toBeFunction();
    expectTypeOf(client.homes[":homeId"].overview.$get).toBeFunction();
    expectTypeOf(
      client.homes[":homeId"].rooms[":roomId"].features[":featureId"].$patch,
    ).toBeFunction();
    type Overview = Awaited<
      ReturnType<
        Awaited<
          ReturnType<(typeof client.homes)[":homeId"]["overview"]["$get"]>
        >["json"]
      >
    >;
    expectTypeOf<
      Overview["summary"]["readyForLayouts"]
    >().toEqualTypeOf<boolean>();
  });
});
