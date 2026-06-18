import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendDownloadEmail,
  sendMagicLinkEmail,
  renderMcpCredentialsEmail,
  renderMagicLinkEmail,
  renderDownloadEmail,
} from "../../src/lib/email.js";

describe("lib/email graceful degradation", () => {
  const origFetch = global.fetch;
  let fetchMock: any;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ id: "email_123" }),
      text: async () => "",
    });
    // @ts-expect-error override
    global.fetch = fetchMock;
  });

  afterEach(() => {
    // @ts-expect-error restore
    global.fetch = origFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.RESEND_REPLY_TO;
  });

  it("returns sent:false when RESEND_API_KEY is missing", async () => {
    delete process.env.RESEND_API_KEY;
    const r = await sendDownloadEmail({
      to: "a@b.com", datasetName: "TARES", downloadUrl: "https://x", accountUrl: "https://y", version: "1",
    });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("no_api_key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns sent:false when RESEND_API_KEY is placeholder", async () => {
    process.env.RESEND_API_KEY = "re_xxx";
    const r = await sendMagicLinkEmail({ to: "a@b.com", magicUrl: "https://x" });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("no_api_key");
  });

  it("sends via Resend API when key is set", async () => {
    process.env.RESEND_API_KEY = "re_real_abc";
    process.env.RESEND_FROM_EMAIL = "noreply@openswissdata.com";
    process.env.RESEND_REPLY_TO = "contact@openswissdata.com";
    const r = await sendDownloadEmail({
      to: "alice@example.com", datasetName: "TARES", downloadUrl: "https://dl/x", accountUrl: "https://acc", version: "2026.04.22",
    });
    expect(r.sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer re_real_abc");
    const body = JSON.parse(opts.body);
    expect(body.from).toBe("noreply@openswissdata.com");
    expect(body.reply_to).toBe("contact@openswissdata.com");
    expect(body.to).toEqual(["alice@example.com"]);
    expect(body.subject).toContain("TARES");
    expect(body.html).toContain("2026.04.22");
  });

  it("defaults from to noreply@ and reply_to to contact@ when env vars are unset", async () => {
    process.env.RESEND_API_KEY = "re_real_abc";
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.RESEND_REPLY_TO;
    await sendMagicLinkEmail({ to: "x@y.com", magicUrl: "https://link" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.from).toBe("noreply@openswissdata.com");
    expect(body.reply_to).toBe("contact@openswissdata.com");
  });

  it("escapes HTML in dataset name (XSS guard)", async () => {
    process.env.RESEND_API_KEY = "re_real_abc";
    await sendDownloadEmail({
      to: "a@b.com",
      datasetName: "<script>alert(1)</script>",
      downloadUrl: "https://dl",
      accountUrl: "https://acc",
      version: "1",
    });
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.html).not.toContain("<script>alert(1)</script>");
    expect(body.html).toContain("&lt;script&gt;");
  });

  it("returns sent:false on Resend HTTP error", async () => {
    process.env.RESEND_API_KEY = "re_real_abc";
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 422,
      text: async () => "invalid from address",
    });
    const r = await sendMagicLinkEmail({ to: "a@b.com", magicUrl: "https://x" });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("resend_error");
  });
});

describe("lib/email renderers (content + i18n)", () => {
  const CREDS = {
    to: "client@exemple.com",
    clientId: "osd_iTxq7UMSw8wNkK7sv2Axig",
    clientSecret: "osdsec_TOPSECRETvalue123",
    tier: "standalone" as const,
    authorizationEndpoint: "https://mcp.openswissdata.com/oauth/authorize",
    tokenEndpoint: "https://mcp.openswissdata.com/oauth/token",
  };

  it("credentials email delivers the secret + id + tier (the critical payload)", () => {
    const { subject, html } = renderMcpCredentialsEmail({ ...CREDS, locale: "fr" });
    expect(html).toContain("osdsec_TOPSECRETvalue123");
    expect(html).toContain("osd_iTxq7UMSw8wNkK7sv2Axig");
    expect(html).toContain("standalone");
    expect(html).toContain("abonnement MCP est actif");
    expect(subject).toContain("standalone");
  });

  it("credentials email is localized (DE heading)", () => {
    const { html } = renderMcpCredentialsEmail({ ...CREDS, locale: "de" });
    expect(html).toContain("MCP-Abonnement ist aktiv");
    expect(html).toContain('lang="de"');
  });

  it("upgrade variant (no secret) never leaks a secret value", () => {
    const { html } = renderMcpCredentialsEmail({ ...CREDS, clientSecret: undefined, locale: "fr" });
    expect(html).not.toContain("osdsec_");
    expect(html).toContain("osd_iTxq7UMSw8wNkK7sv2Axig"); // id still shown
    expect(html).toContain("Mise à niveau");
  });

  it("magic-link renderer carries the URL + localized heading", () => {
    const fr = renderMagicLinkEmail({ to: "a@b.com", magicUrl: "https://osd/verify?t=xyz", locale: "fr" });
    expect(fr.html).toContain("https://osd/verify?t=xyz");
    expect(fr.html).toContain("Votre lien de connexion");
    const en = renderMagicLinkEmail({ to: "a@b.com", magicUrl: "https://osd/verify?t=xyz", locale: "en" });
    expect(en.html).toContain("Your sign-in link");
  });

  it("download renderer carries name + version + url", () => {
    const { html, subject } = renderDownloadEmail({
      to: "a@b.com", datasetName: "TARES", downloadUrl: "https://dl/zip", accountUrl: "https://acc", version: "2026.06.18", locale: "fr",
    });
    expect(html).toContain("TARES");
    expect(html).toContain("2026.06.18");
    expect(html).toContain("https://dl/zip");
    expect(subject).toContain("TARES");
  });

  it("brand logo is decorative (alt empty) — no duplicated wordmark when images are blocked", () => {
    const { html } = renderMagicLinkEmail({ to: "a@b.com", magicUrl: "https://x", locale: "fr" });
    expect(html).toContain('alt=""');
    expect(html).not.toContain('alt="openswissdata"');
  });
});
