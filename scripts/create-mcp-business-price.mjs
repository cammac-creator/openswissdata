/**
 * Crée le produit + prix récurrent "MCP Business" (199 CHF/mois) dans Stripe.
 *
 * Utilise STRIPE_SECRET_KEY (la même clé que l'app → même mode test/live que
 * le tier Pro 49/mois existant, donc cohérent). Ne crée RIEN d'autre, ne touche
 * à aucun client ni paiement.
 *
 * Usage :
 *   node --env-file=.env scripts/create-mcp-business-price.mjs
 *
 * Puis : ajoute le price_... affiché dans .env ET sur Railway sous
 *   STRIPE_PRICE_MCP_BUSINESS=price_...
 * et demande-moi de câbler le bouton Business en self-serve.
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key || key.startsWith("sk_test_xxx")) {
  console.error("✗ STRIPE_SECRET_KEY manquante ou placeholder. Lance avec --env-file=.env.");
  process.exit(1);
}

const stripe = new Stripe(key);
const mode = key.startsWith("sk_live") ? "LIVE (argent réel)" : "TEST";

const product = await stripe.products.create({
  name: "openswissdata MCP — Business",
  description:
    "Abonnement MCP/API Business : 50 000 requêtes/mois, outils avancés (semantic search, classify, entity history), support prioritaire.",
});

const price = await stripe.prices.create({
  product: product.id,
  currency: "chf",
  unit_amount: 19900, // 199.00 CHF
  recurring: { interval: "month" },
});

console.log(`\n✓ Créé en mode ${mode}`);
console.log("  Product :", product.id);
console.log("  Price   :", price.id);
console.log("\n── À FAIRE ────────────────────────────────────────────");
console.log(`1. Ajoute cette ligne dans .env ET dans les variables Railway :`);
console.log(`     STRIPE_PRICE_MCP_BUSINESS=${price.id}`);
console.log(`2. Dis-moi « go business » : je câble le bouton Business 199`);
console.log(`   en self-serve (comme le Pro 49) sur /pricing + /mcp.`);
console.log("───────────────────────────────────────────────────────\n");
