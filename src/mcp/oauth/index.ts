/**
 * Aggregated OAuth router.
 *
 * Mounts:
 *   POST /oauth/register
 *   GET  /oauth/authorize
 *   POST /oauth/authorize/decision
 *   POST /oauth/token
 *   POST /oauth/revoke
 */

import { Hono } from "hono";
import { registerRoute } from "./register.js";
import { authorizeRoute } from "./authorize.js";
import { tokenRoute } from "./token.js";
import { revokeRoute } from "./revoke.js";

export const oauthRouter = new Hono();
oauthRouter.route("/", registerRoute);
oauthRouter.route("/", authorizeRoute);
oauthRouter.route("/", tokenRoute);
oauthRouter.route("/", revokeRoute);

export { oauthVerify, isToolAllowed, type MCPAuthContext, type MCPAuthVar } from "./verify.js";
export { TOOL_SCOPE, SCOPES, TIER_QUOTA, type Scope, type Tier } from "./scopes.js";
