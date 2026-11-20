// Synthetic listing content for tests (made-up data).
// A synthetic listing screenshot (made-up data) that deliberately omits the
// floor area and address so we can check nothing is invented.
export async function listingScreenshot() {
  const sharp = (await import("sharp")).default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="780" height="1400">
    <rect width="780" height="1400" fill="#fff"/>
    <rect width="780" height="90" fill="#00deb6"/><text x="30" y="58" font-family="Arial" font-size="34" fill="#262637">rightmove</text>
    <rect x="30" y="120" width="720" height="420" fill="#8a9a8c"/><text x="300" y="340" font-family="Arial" font-size="28" fill="#fff">[photo 1 of 18]</text>
    <g font-family="Arial" fill="#262637">
      <text x="30" y="600" font-size="22">Guide Price</text>
      <text x="30" y="650" font-size="44" font-weight="bold">£325,000</text>
      <text x="30" y="710" font-size="28">3 bedroom semi-detached house for sale</text>
      <text x="30" y="760" font-size="24">PROPERTY TYPE: Semi-Detached</text>
      <text x="30" y="795" font-size="24">BEDROOMS: ×3    BATHROOMS: ×2</text>
      <text x="30" y="830" font-size="24">TENURE: Freehold</text>
      <text x="30" y="880" font-size="28" font-weight="bold">Key features</text>
      <text x="40" y="920" font-size="24">• South-facing rear garden</text>
      <text x="40" y="955" font-size="24">• Off-street parking for two cars</text>
      <text x="40" y="990" font-size="24">• Close to primary schools</text>
      <text x="30" y="1060" font-size="28" font-weight="bold">Property description</text>
      <text x="30" y="1100" font-size="22">Living Room 4.60m x 3.80m. Kitchen/Diner 5.10m x 3.00m.</text>
      <text x="30" y="1135" font-size="22">Bedroom One 3.60m x 3.20m. Bedroom Two 3.10m x 2.70m.</text>
      <text x="30" y="1170" font-size="22">Bedroom Three 2.40m x 2.10m. Bathroom.</text>
      <text x="30" y="1240" font-size="22">Marketed by Example Estates, Sheffield</text>
    </g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

