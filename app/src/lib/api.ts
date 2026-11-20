import type { AppType } from "@stepchange/server";
import { hc } from "hono/client";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:8787";

export const api = hc<AppType>(SERVER_URL);
