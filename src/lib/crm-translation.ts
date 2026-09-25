import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export type TranslationEvent = { type:'chunk'; text:string; completed:number; total:number } | { type:'done'; peak_memory_mb?:number } | { type:'error'; error:string };
let busy = false;
export const translationBusy = () => busy;

/** Un seul processus isolé, mémoire libérée à la fin, aucun texte conservé ou journalisé. */
export async function translateMessage(text:string, language:string, signal:AbortSignal, emit:(event:TranslationEvent)=>Promise<void>):Promise<void> {
  if (busy) throw new Error('translation_busy');
  busy = true;
  try {
    await new Promise<void>((resolve, reject) => {
      const source = import.meta.url.endsWith('.ts');
      const child = fork(fileURLToPath(new URL(source ? './translation-worker.ts' : './translation-worker.js', import.meta.url)), [], {
        execArgv: source ? ['--import', 'tsx'] : [],
        // Aucun identifiant applicatif ne passe au processus de traduction.
        env: { PATH:process.env.PATH, TMPDIR:process.env.TMPDIR, LANG:'fr_CH.UTF-8' },
        stdio:['ignore','ignore','ignore','ipc'],
      });
      let finished = false, delivered = Promise.resolve();
      const stop = (error?: Error) => {
        if (finished) return;
        finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort); child.kill('SIGKILL');
        if (error) reject(error); else delivered.then(resolve, reject);
      };
      const abort = () => stop(new Error('translation_cancelled'));
      const timer = setTimeout(() => stop(new Error('translation_timeout')), 180_000);
      signal.addEventListener('abort', abort, {once:true});
      child.on('message', (event:TranslationEvent) => {
        if (finished) return;
        if (event.type === 'error') { stop(new Error(event.error === 'translation_truncated' ? 'translation_truncated' : 'translation_failed')); return; }
        delivered = delivered.then(() => new Promise<void>((resolveWrite, rejectWrite) => {
          const deadline = setTimeout(() => rejectWrite(new Error('translation_cancelled')), 5000);
          emit(event).then(resolveWrite, rejectWrite).finally(() => clearTimeout(deadline));
        }));
        delivered.catch(() => stop(new Error('translation_cancelled')));
        if (event.type === 'done') stop();
      });
      child.once('error', () => stop(new Error('translation_failed')));
      child.once('exit', () => { if (!finished) stop(new Error('translation_failed')); });
      if (signal.aborted) abort(); else child.send({ text, language });
    });
  } finally { busy = false; }
}
