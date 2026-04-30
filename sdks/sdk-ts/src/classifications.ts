/**
 * Classifications (NOGA / NACE / ISIC) surface.
 *
 * Backed by 2 MCP tools:
 *   - cross_walk     → translate a code from one scheme to another
 *   - classify_text  → free-text → top-K NOGA 2025 (or NACE 2.1 best-effort)
 */

import type { Client } from "./client.js";
import type {
  ClassifyTextInput,
  ClassifyTextResult,
  CrossWalkInput,
  CrossWalkResult,
} from "./types.js";

export class ClassificationsAPI {
  constructor(private readonly client: Client) {}

  /**
   * Translate an industry classification code from one scheme to another.
   *
   * Supported schemes: `NOGA_2008`, `NOGA_2025`, `NACE_2.0`, `NACE_2.1`,
   * `ISIC_4`. NAICS is not yet shipped.
   *
   * @example
   * ```ts
   * const r = await client.classifications.crossWalk({
   *   code: "62.01",
   *   source: "NACE_2.0",
   *   target: "NOGA_2025",
   * });
   * for (const m of r.mappings) console.log(m.target_code, m.mapping_type);
   * ```
   */
  public crossWalk(input: CrossWalkInput): Promise<CrossWalkResult> {
    return this.client.callTool<CrossWalkResult>("cross_walk", input);
  }

  /**
   * Classify free-text business description into top-K NOGA 2025 codes.
   *
   * @example
   * ```ts
   * const r = await client.classifications.classifyText({
   *   text: "vente de café en grain et torréfaction",
   *   top_k: 3,
   * });
   * for (const h of r.hits) console.log(h.score, h.code, h.label_fr);
   * ```
   */
  public classifyText(input: ClassifyTextInput): Promise<ClassifyTextResult> {
    return this.client.callTool<ClassifyTextResult>("classify_text", input);
  }
}
