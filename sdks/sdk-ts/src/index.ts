/**
 * @openswissdata/sdk — Official TypeScript SDK for openswissdata.com
 *
 * Quickstart:
 * ```ts
 * import { Client } from "@openswissdata/sdk";
 *
 * const client = new Client({ apiKey: process.env.OPENSWISSDATA_API_KEY });
 *
 * const r = await client.tares.lookup({ hs8: "84620010" });
 * console.log(r.designation, r.duty_mfn.value);
 * console.log(r.disclaimer); // ALWAYS surface non-official notices to users
 * ```
 */

import { Client as BaseClient, type ClientOptions } from "./client.js";
import { TaresAPI } from "./tares.js";
import { ClassificationsAPI } from "./classifications.js";
import { FinmaAPI } from "./finma.js";

/**
 * High-level openswissdata client.
 *
 * Wraps the live MCP JSON-RPC endpoint and exposes typed surfaces for
 * each dataset family.
 */
export class Client extends BaseClient {
  public readonly tares: TaresAPI;
  public readonly classifications: ClassificationsAPI;
  public readonly finma: FinmaAPI;

  constructor(options: ClientOptions = {}) {
    super(options);
    this.tares = new TaresAPI(this);
    this.classifications = new ClassificationsAPI(this);
    this.finma = new FinmaAPI(this);
  }
}

export { TaresAPI, ClassificationsAPI, FinmaAPI };
export { DEFAULT_BASE_URL } from "./client.js";
export type { ClientOptions, RateLimitInfo } from "./client.js";

export {
  OpenSwissDataError,
  AuthError,
  RateLimitError,
  ServerError,
  NetworkError,
  ToolError,
} from "./errors.js";

export type {
  Lang,
  ClassificationScheme,
  TariffLookupInput,
  TariffLookupResult,
  TariffSemanticSearchInput,
  TariffSemanticSearchResult,
  TariffSemanticHit,
  TariffChangelogInput,
  TariffChangelogResult,
  TariffChangelogChange,
  CrossWalkInput,
  CrossWalkResult,
  CrossWalkMapping,
  ClassifyTextInput,
  ClassifyTextResult,
  ClassifyTextHit,
  KycCheckInput,
  KycCheckResult,
  KycMatch,
  KycWarning,
  FinmaSearchInput,
  FinmaSearchResult,
  FinmaSearchMatch,
  FinmaSearchWarning,
  EntityHistoryInput,
  EntityHistoryResult,
  EntityHistoryEvent,
  ServerInfo,
  JsonRpcRequest,
  JsonRpcResponse,
  ToolCallResult,
} from "./types.js";
