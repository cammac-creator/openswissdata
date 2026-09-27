/** Lecture anonyme, bornée, compatible avec les navigateurs sans AbortSignal.timeout. */
export async function readPublicCatalogue(id: 'finma' | 'tares' | 'classifications'): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const deadline = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`/api/catalog/${id}`, {cache:'no-store', credentials:'omit', signal:controller.signal});
    if (!response.ok) throw new Error('Catalogue indisponible');
    const data: unknown = await response.json();
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('Catalogue incomplet');
    return data as Record<string, unknown>;
  } finally {
    clearTimeout(deadline);
  }
}
