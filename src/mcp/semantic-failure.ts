const lastFailures = new Map<string, number>();

/** Diagnostic fermé : ni texte recherché, ni message fournisseur, au plus une fois/minute/outil. */
export function reportSemanticFailure(tool: 'classify_text' | 'tariff_semantic_search'): void {
  try {
    const now = Date.now(), last = lastFailures.get(tool);
    if (last !== undefined && now >= last && now - last < 60_000) return;
    lastFailures.set(tool, now);
    console.warn(`[mcp] recherche sémantique indisponible : ${tool}`);
  } catch { /* Le diagnostic facultatif ne doit pas altérer la réponse fermée. */ }
}
