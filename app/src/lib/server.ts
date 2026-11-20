"use client";

import { useAuth } from "@clerk/nextjs";
import type { AppType } from "@stepchange/server";
import { hc } from "hono/client";
import { useMemo } from "react";

export const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown = null,
  ) {
    super(message);
  }
}

// Typed Hono RPC client for browser use; every request carries the current
// Clerk session token.
export function useServer() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const client = useMemo(
    () =>
      hc<AppType>(SERVER_URL, {
        headers: async (): Promise<Record<string, string>> => {
          const token = await getToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    [getToken],
  );
  return { client, getToken, isLoaded, isSignedIn: Boolean(isSignedIn) };
}

// Parse a server response, throwing ApiError with the server's message.
export async function readJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (body as { error?: string } | null)?.error ??
      `Request failed (${res.status})`;
    throw new ApiError(message, res.status, body);
  }
  return body as T;
}
