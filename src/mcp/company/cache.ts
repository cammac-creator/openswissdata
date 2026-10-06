/**
 * Cache borné à durée de vie (TTL), utilisé par `lindas.ts` et `gleif.ts` pour éviter de
 * réinterroger le registre du commerce ou GLEIF à chaque appel du même IDE (tâche osd.fiche, tâche 3).
 *
 * Horloge injectée (`now`), jamais `Date.now` lu directement : un test fige le temps, le
 * fait avancer, puis vérifie l'expiration sans dépendre de l'horloge réelle.
 *
 * `set` clone la valeur (`structuredClone`) et la fige entièrement (`Object.freeze`
 * récursif) avant de la stocker : `get` rend ensuite cette même valeur figée à tous les
 * appelants. Un appelant qui tente de la modifier échoue (ou ne modifie qu'une copie hors
 * du cache en mode non strict) ; la mutation ne peut jamais atteindre l'entrée interne.
 */

interface Entry<V> {
  value: V;
  expiresAt: number;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export class TtlCache<V> {
  private readonly max: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly store = new Map<string, Entry<V>>();

  constructor(opts: { max: number; ttlMs: number; now: () => number }) {
    this.max = opts.max;
    this.ttlMs = opts.ttlMs;
    this.now = opts.now;
  }

  get(k: string): V | undefined {
    const entry = this.store.get(k);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(k);
      return undefined;
    }
    return entry.value;
  }

  set(k: string, v: V): void {
    // Borne le nombre d'entrées : au-delà de `max`, la plus ancienne (ordre d'insertion
    // du Map) part en premier. Une mise à jour d'une clé déjà présente ne compte pas comme
    // un ajout.
    if (!this.store.has(k) && this.store.size >= this.max) {
      const plusAncienne = this.store.keys().next().value;
      if (plusAncienne !== undefined) this.store.delete(plusAncienne);
    }
    this.store.set(k, { value: deepFreeze(structuredClone(v)), expiresAt: this.now() + this.ttlMs });
  }
}
