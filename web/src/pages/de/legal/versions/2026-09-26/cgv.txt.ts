import { termsText } from "../../../../../../../src/lib/order-legal";
export function GET() { return new Response(termsText("de", "2026-09-26"), { headers: { "Content-Type": "text/plain; charset=utf-8" } }); }
