// Helpers for the taste journey e2e test.
import { SERVER } from "./session.mjs";

async function render(svg) {
  const sharp = (await import("sharp")).default;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

// A simple "room" in warm oak, warm white and muted sage green.
export function warmOakRoomJpeg() {
  const planks = Array.from(
    { length: 12 },
    (_, i) =>
      `<rect x="${i * 70}" y="420" width="68" height="180" fill="${i % 2 ? "#b07a45" : "#c08a52"}"/>`,
  ).join("");
  return render(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
    <rect width="800" height="420" fill="#efe6d6"/>${planks}
    <rect x="520" y="60" width="200" height="260" fill="#dfe8f0" stroke="#c9b79c" stroke-width="10"/>
    <rect x="140" y="300" width="340" height="110" rx="30" fill="#8a9a7b"/>
    <rect x="160" y="250" width="300" height="70" rx="30" fill="#97a688"/>
    <circle cx="610" cy="470" r="55" fill="#a8743f"/>
    <rect x="60" y="250" width="40" height="160" fill="#7d8f6a"/>
    <circle cx="80" cy="230" r="50" fill="#6f845c"/>
    <rect x="200" y="330" width="60" height="40" rx="8" fill="#e9dcc3"/>
  </svg>`);
}

// A high-gloss black and chrome room with harsh red accents.
export function glossyChromeRoomJpeg() {
  return render(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#050505"/><stop offset="0.5" stop-color="#3a3a3a"/><stop offset="1" stop-color="#050505"/>
    </linearGradient><linearGradient id="c" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8d8d8d"/><stop offset="0.5" stop-color="#f4f4f4"/><stop offset="1" stop-color="#8d8d8d"/>
    </linearGradient></defs>
    <rect width="800" height="600" fill="url(#g)"/>
    <rect x="0" y="430" width="800" height="170" fill="#111" />
    <rect x="120" y="300" width="560" height="90" fill="#000" stroke="url(#c)" stroke-width="8"/>
    <rect x="150" y="390" width="20" height="60" fill="url(#c)"/><rect x="630" y="390" width="20" height="60" fill="url(#c)"/>
    <rect x="300" y="80" width="200" height="140" fill="#d10000"/>
    <circle cx="700" cy="120" r="40" fill="url(#c)"/>
  </svg>`);
}

export async function api(token, path, init = {}) {
  const res = await fetch(`${SERVER}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: process.env.E2E_APP ?? "http://localhost:3000",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
