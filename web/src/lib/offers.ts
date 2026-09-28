/**
 * Prix publics des achats de fichiers, en francs suisses : la seule source des pages Atlas.
 * Les montants facturés restent ceux des prix Stripe ; un test vérifie la concordance
 * avec le référentiel serveur (src/db/seed.ts). Changer un prix est une décision de
 * Claude-Alain, jamais un choix de mise en page. Les offres MCP fermées ne sont pas ici.
 */
export type FileProductId = 'tares' | 'classifications' | 'finma';

export const FILE_OFFERS: Readonly<Record<FileProductId, { readonly price: number; readonly renewal: number }>> = {
  tares: { price: 299, renewal: 120 },
  classifications: { price: 399, renewal: 160 },
  finma: { price: 299, renewal: 120 },
};

/** Le bundle livre les trois fichiers, avec Classifications Standard. */
export const BUNDLE_OFFER = {
  price: 797,
  products: ['tares', 'classifications', 'finma'] as const satisfies readonly FileProductId[],
};

/** Total des trois achats séparés, économie et pourcentage arrondi, toujours calculés. */
export const SEPARATE_TOTAL = BUNDLE_OFFER.products.reduce((total, id) => total + FILE_OFFERS[id].price, 0);
export const BUNDLE_SAVING = SEPARATE_TOTAL - BUNDLE_OFFER.price;
export const BUNDLE_SAVING_PERCENT = Math.round((BUNDLE_SAVING / SEPARATE_TOTAL) * 100);
