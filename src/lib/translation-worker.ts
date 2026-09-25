import { pipeline, env } from '@huggingface/transformers';
import { translationModelPath } from './translation-model.js';
import { protectTerms } from './translation-text.js';
import { isLanguage } from './languages.js';

// Les poids font partie de la construction. Lecture locale uniquement, ni réseau ni télémétrie.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useFSCache = false;
process.once('message', async (input: { text:string; language:string }) => {
  try {
    if (!input || !isLanguage(input.language) || typeof input.text !== 'string' || input.text.length > 5000) throw new Error('invalid_input');
    const translator = await pipeline('translation', translationModelPath(input.language), { local_files_only:true, dtype:'q8', device:'cpu', session_options:{intraOpNumThreads:2, interOpNumThreads:1, logSeverityLevel:3} });
    const paragraphs = input.text.split('\n');
    const chunkSize = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(input.text) ? 100 : 350;
    const chunks: string[] = [];
    // Une phrase à la fois : évite les omissions fréquentes des longs paragraphes.
    for (const paragraph of paragraphs) {
      const sentences = [...new Intl.Segmenter(input.language, { granularity:'sentence' }).segment(paragraph)].map(s => s.segment);
      for (const sentence of sentences) {
        let rest = sentence.trim();
        while (rest.length > chunkSize) {
          const boundary = rest.lastIndexOf(' ', chunkSize);
          const end = boundary > chunkSize / 2 ? boundary : chunkSize;
          chunks.push(rest.slice(0, end)); rest = rest.slice(end).trim();
        }
        if (rest) chunks.push(rest);
      }
      chunks.push('\n');
    }
    const total = chunks.filter(s => s !== '\n').length;
    let completed = 0;
    for (const chunk of chunks) {
      if (chunk === '\n') { process.send?.({ type:'chunk', text:'\n', completed, total }); continue; }
      const options = { src_lang:input.language, tgt_lang:'fr', max_new_tokens:256, num_beams:1 };
      const protectedChunk = protectTerms(chunk);
      const result = await translator(protectedChunk.text, options as unknown as Parameters<typeof translator>[1]) as Array<{translation_text:string}>;
      const text = result[0]?.translation_text?.trim();
      if (!text) throw new Error('empty_translation');
      if (translator.tokenizer(text).input_ids.data.length >= 250) throw new Error('translation_truncated');
      process.send?.({ type:'chunk', text:protectedChunk.restore(text) + ' ', completed:++completed, total });
    }
    await translator.dispose();
    process.send?.({ type:'done', peak_memory_mb:Math.ceil(process.resourceUsage().maxRSS / 1024) }, () => process.disconnect());
  } catch (error) { process.send?.({ type:'error', error:error instanceof Error && error.message === 'translation_truncated' ? 'translation_truncated' : 'translation_failed' }, () => process.disconnect()); }
});
