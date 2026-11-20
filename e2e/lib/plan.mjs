// Helpers for the plan end-to-end test: seed a home through the API as the
// signed-in test user.
import { APP, SERVER } from "./session.mjs";

export function apiClient(session) {
  return async function api(method, path, body) {
    const token = await session.token();
    if (!token) throw new Error("No Clerk session token");
    const res = await fetch(`${SERVER}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: APP,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) {
      throw new Error(
        `${method} ${path} → ${res.status} ${text.slice(0, 300)}`,
      );
    }
    return json;
  };
}

// Home with a reviewed 4.6 × 3.8 m living room (user-confirmed), a door on
// the south wall, a £6,000 budget and a confirmed 150 cm turning need.
export async function seedPlanHome(api) {
  const home = await api("POST", "/homes", {
    name: "E2E Plan Home",
    journeyType: "homeowner",
  });
  await api("PATCH", "/profile/me", { journeyState: { homeId: home.id } });
  await api("PUT", "/profile/household", { budgetTotalPence: 600000 });
  await api("POST", "/profile/accessibility", {
    scope: "home",
    needType: "turning_area",
    params: { diameterCm: 150 },
    confirmed: true,
  });
  const room = await api("POST", `/homes/${home.id}/rooms`, {
    name: "Living room",
    roomType: "living_room",
    selected: true,
    widthCm: 460,
    lengthCm: 380,
    dimensionStatus: "user_confirmed",
  });
  await api("POST", `/homes/${home.id}/rooms/${room.id}/features`, {
    type: "door",
    wall: "south",
    offsetCm: 40,
    widthCm: 85,
  });
  // Adding a feature clears the review, so review last (FP-004).
  const reviewed = await api(
    "POST",
    `/homes/${home.id}/rooms/${room.id}/review`,
  );
  return { home, room: reviewed };
}
