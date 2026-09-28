/**
 * Index lexical par trigrammes de caractères (BM25), construit en mémoire à partir des textes livrés.
 *
 * Complète la recherche sémantique : un mot rare de la requête (« lithium-ion », « Paletten »,
 * « whisky ») doit peser, même quand le modèle le noie dans un texte long. Les trigrammes tolèrent
 * pluriels, accords et mots composés allemands (« Holzpaletten » partage « pal », « ale »… avec
 * « Paletten aus Holz ») sans racinisation propre à une langue. Mots vides FR/DE/EN/IT retirés.
 *
 * Mémoire : identifiants de documents sur 16 ou 32 bits et poids BM25 précalculés par occurrence.
 */

const STOPWORDS = new Set(
  (
    "de du des la le les l d et ou en a au aux pour par avec sans sur un une dont y compris meme " +
    "the of and or for with without in on to an by " +
    "der die das dem den und oder fur mit ohne aus von zu im am auf ein eine einer eines " +
    "di e o per con senza da del della dei degli delle il lo gli i uno"
  ).split(" "),
);

const K1 = 1.2;
const B = 0.75;

/** Minuscules, accents retirés, mots de deux lettres ou plus hors mots vides. */
export function lexicalWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Trigrammes des mots, bornés par une espace de chaque côté (« café » → « ca », « caf », « afe », « fe »). */
export function trigrams(text: string): string[] {
  const out: string[] = [];
  for (const word of lexicalWords(text)) {
    const padded = ` ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.push(padded.slice(i, i + 3));
  }
  return out;
}

export interface LexicalHit {
  doc: number;
  score: number;
}

export class TrigramIndex {
  readonly size: number;
  private readonly idf: Float32Array;
  private readonly offsets: Uint32Array;
  private readonly docs: Uint16Array | Uint32Array;
  private readonly weights: Float32Array;
  private readonly ids = new Map<string, number>();

  constructor(texts: readonly string[]) {
    this.size = texts.length;
    const perDoc: Map<number, number>[] = [];
    const lengths = new Float64Array(texts.length);
    const df: number[] = [];
    texts.forEach((text, doc) => {
      const counts = new Map<number, number>();
      for (const gram of trigrams(text)) {
        let id = this.ids.get(gram);
        if (id === undefined) {
          id = this.ids.size;
          this.ids.set(gram, id);
          df.push(0);
        }
        counts.set(id, (counts.get(id) ?? 0) + 1);
        lengths[doc]++;
      }
      for (const id of counts.keys()) df[id]++;
      perDoc.push(counts);
    });
    const average = lengths.reduce((a, b) => a + b, 0) / Math.max(1, texts.length);
    this.idf = Float32Array.from(df, (n) => Math.log(1 + (texts.length - n + 0.5) / (n + 0.5)));
    this.offsets = new Uint32Array(df.length + 1);
    for (let id = 0; id < df.length; id++) this.offsets[id + 1] = this.offsets[id] + df[id];
    const total = this.offsets[df.length];
    this.docs = texts.length <= 0xffff ? new Uint16Array(total) : new Uint32Array(total);
    this.weights = new Float32Array(total);
    const cursor = this.offsets.slice(0, df.length);
    perDoc.forEach((counts, doc) => {
      const norm = K1 * (1 - B + (B * lengths[doc]) / (average || 1));
      for (const [id, tf] of counts) {
        const at = cursor[id]++;
        this.docs[at] = doc;
        this.weights[at] = (tf * (K1 + 1)) / (tf + norm);
      }
    });
  }

  /** Documents partageant au moins un trigramme avec la requête, du plus pertinent au moins pertinent. */
  search(query: string): LexicalHit[] {
    const scores = new Float32Array(this.size);
    const touched: number[] = [];
    for (const gram of new Set(trigrams(query))) {
      const id = this.ids.get(gram);
      if (id === undefined) continue;
      const idf = this.idf[id];
      for (let at = this.offsets[id]; at < this.offsets[id + 1]; at++) {
        const doc = this.docs[at];
        if (scores[doc] === 0) touched.push(doc);
        scores[doc] += idf * this.weights[at];
      }
    }
    return touched.map((doc) => ({ doc, score: scores[doc] })).sort((a, b) => b.score - a.score || a.doc - b.doc);
  }
}
