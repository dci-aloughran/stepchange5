"use client";

import type { HomeListItem, UserProfile } from "@stepchange/shared";
import { useEffect, useState } from "react";
import { readJson, useServer } from "@/lib/server";
import { pickHomeId } from "./status";

export type CurrentHome =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "no_home" }
  | { kind: "error"; message: string }
  | { kind: "ready"; homeId: string; homeName: string };

export function useCurrentHome(): CurrentHome {
  const { client, isLoaded, isSignedIn } = useServer();
  const [state, setState] = useState<CurrentHome>({ kind: "loading" });

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setState({ kind: "signed_out" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [profile, homes] = await Promise.all([
          readJson<UserProfile>(await client.profile.me.$get()),
          readJson<HomeListItem[]>(await client.homes.$get()),
        ]);
        if (cancelled) return;
        const id = pickHomeId(profile.journeyState?.homeId, homes);
        const home = homes.find((h) => h.id === id);
        setState(
          id && home
            ? { kind: "ready", homeId: id, homeName: home.name }
            : { kind: "no_home" },
        );
      } catch (e) {
        if (!cancelled) {
          setState({
            kind: "error",
            message:
              e instanceof Error ? e.message : "Couldn't load your home plan.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, isLoaded, isSignedIn]);

  return state;
}
