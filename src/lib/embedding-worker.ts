/** Processus isolé du modèle de recherche : tué après inactivité, il rend toute sa mémoire. Aucun texte journalisé. */
import { createEmbeddingExtractor } from './embedding-model.js';

type Request = { id:number; text:string };
let extractor: ReturnType<typeof createEmbeddingExtractor> | null = null;

async function load() {
  if (!extractor) {
    const { env } = await import('@huggingface/transformers');
    env.useFSCache = false;
    extractor = createEmbeddingExtractor().catch(error => { extractor = null; throw error; });
  }
  return extractor;
}

process.on('message', async (input: Request) => {
  const id = input?.id;
  try {
    if (typeof id !== 'number' || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 10_000) throw new Error('invalid_input');
    const tensor = await (await load())(input.text, { pooling:'mean', normalize:true });
    process.send?.({ id, vector:Array.from(tensor.data as Float32Array) });
  } catch {
    process.send?.({ id, error:'embedding_failed' });
  }
});
// Le parent disparu, plus personne ne peut nous arrêter : on s'arrête seul.
process.on('disconnect', () => process.exit(0));
