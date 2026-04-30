/**
 * Generate the default Open Graph image (1200×630) for openswissdata.com.
 *
 * Uses sharp's text + composite features to build a static branded card with
 * the project name, tagline, and the 3 dataset names. No third-party API.
 *
 * Run once before launch:
 *   node scripts/generate-og-image.mjs
 *
 * Output: web/public/og-default.png
 */

import sharp from "sharp";
import { writeFileSync } from "node:fs";

const W = 1200;
const H = 630;

const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FBFBF8" />
      <stop offset="100%" stop-color="#F4F4F0" />
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#DC1F2D" />
      <stop offset="100%" stop-color="#9B0D14" />
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)" />
  <rect x="0" y="0" width="${W}" height="6" fill="url(#accent)" />

  <!-- Swiss cross corner mark -->
  <g transform="translate(60, 60)">
    <rect x="0" y="0" width="48" height="48" fill="#DC1F2D" rx="4" />
    <rect x="20" y="10" width="8" height="28" fill="#FFFFFF" />
    <rect x="10" y="20" width="28" height="8" fill="#FFFFFF" />
  </g>

  <!-- Eyebrow -->
  <text x="60" y="170" font-family="ui-monospace, 'SF Mono', monospace" font-size="16" font-weight="600" fill="#8A8D95" letter-spacing="2">
    OPENSWISSDATA · DONNÉES FÉDÉRALES SUISSES
  </text>

  <!-- Headline -->
  <text x="60" y="270" font-family="-apple-system, system-ui, sans-serif" font-size="72" font-weight="700" fill="#0A0A0C" letter-spacing="-1">
    Données réglementaires
  </text>
  <text x="60" y="350" font-family="-apple-system, system-ui, sans-serif" font-size="72" font-weight="700" fill="#DC1F2D" letter-spacing="-1">
    suisses, normalisées.
  </text>

  <!-- Tagline -->
  <text x="60" y="420" font-family="-apple-system, system-ui, sans-serif" font-size="26" font-weight="500" fill="#4A4D55">
    TARES douanes · NOGA/NACE/ISIC · Registre FINMA
  </text>

  <!-- Footer features -->
  <text x="60" y="540" font-family="ui-monospace, 'SF Mono', monospace" font-size="16" font-weight="500" fill="#0F766E">
    Multi-format · Signé Ed25519 · Mises à jour quotidiennes · MCP server
  </text>

  <!-- URL -->
  <text x="60" y="580" font-family="ui-monospace, 'SF Mono', monospace" font-size="14" font-weight="600" fill="#8A8D95">
    openswissdata.com
  </text>

  <!-- Right corner: signature mark -->
  <g transform="translate(${W - 220}, ${H - 80})">
    <text font-family="ui-monospace, 'SF Mono', monospace" font-size="11" fill="#8A8D95">
      <tspan x="0" y="0">SIGNED Ed25519</tspan>
      <tspan x="0" y="16">RFC-3161 TIMESTAMP</tspan>
      <tspan x="0" y="32">PROVENANCE VERIFIED</tspan>
    </text>
  </g>
</svg>
`.trim();

async function main() {
  const png = await sharp(Buffer.from(svg))
    .png({ quality: 90, compressionLevel: 9 })
    .toBuffer();
  writeFileSync("./web/public/og-default.png", png);
  console.log(`[og-image] wrote web/public/og-default.png (${png.length} bytes, ${W}×${H})`);
}

main().catch((err) => {
  console.error("[og-image] FATAL", err);
  process.exit(1);
});
