/**
 * Dev preview for transactional emails — renders each email to /tmp/*.html so
 * they can be opened / screenshotted (the templates never load without this,
 * since send() only ships them to Resend). Run: npx tsx scripts/preview-emails.ts
 */
import { writeFileSync } from "node:fs";
import {
  renderMcpCredentialsEmail,
  renderMagicLinkEmail,
  renderDownloadEmail,
} from "../src/lib/email.js";

const locales = ["fr", "de"] as const;

for (const locale of locales) {
  writeFileSync(
    `/tmp/email_creds_${locale}.html`,
    renderMcpCredentialsEmail({
      to: "client@exemple.com",
      clientId: "osd_iTxq7UMSw8wNkK7sv2Axig",
      clientSecret: "osdsec_9f3b2a1c8e7d6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a",
      tier: "standalone",
      authorizationEndpoint: "https://mcp.openswissdata.com/oauth/authorize",
      tokenEndpoint: "https://mcp.openswissdata.com/oauth/token",
      locale,
    }).html,
  );
  writeFileSync(
    `/tmp/email_magic_${locale}.html`,
    renderMagicLinkEmail({
      to: "client@exemple.com",
      magicUrl: "https://www.openswissdata.com/api/auth/verify?token=AbC123",
      locale,
    }).html,
  );
  writeFileSync(
    `/tmp/email_dl_${locale}.html`,
    renderDownloadEmail({
      to: "client@exemple.com",
      datasetName: "TARES",
      downloadUrl: "https://r2.openswissdata.com/download/abc",
      accountUrl: "https://www.openswissdata.com/account",
      version: "2026.06.18",
      locale,
    }).html,
  );
}
console.log("wrote /tmp/email_{creds,magic,dl}_{fr,de}.html");
