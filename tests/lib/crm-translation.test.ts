import {EventEmitter} from 'node:events';
import {describe,it,expect,vi,afterEach} from 'vitest';
const mock=vi.hoisted(()=>({fork:vi.fn()}));
vi.mock('node:child_process',()=>({fork:mock.fork}));
import {translateMessage,translationBusy} from '../../src/lib/crm-translation.js';
const child=()=>{const process=Object.assign(new EventEmitter(),{send:vi.fn(),kill:vi.fn()});mock.fork.mockReturnValue(process);return process};
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks()});
describe('Annulation et limites de la traduction',()=>{
 it('libère immédiatement le processus et le verrou même si une écriture ne se termine jamais',async()=>{
  const first=child(),abort=new AbortController();const work=translateMessage('Texte fictif','en',abort.signal,()=>new Promise<void>(()=>{}));
  const failure=expect(work).rejects.toThrow('translation_cancelled');
  first.emit('message',{type:'chunk',text:'Bonjour',completed:1,total:2});await Promise.resolve();abort.abort();await failure;
  expect(first.kill).toHaveBeenCalledWith('SIGKILL');expect(translationBusy()).toBe(false);
  const second=child();const next=translateMessage('Encore un texte','de',new AbortController().signal,async()=>{});second.emit('message',{type:'done'});await next;expect(translationBusy()).toBe(false);
 });
 it('refuse un second processus concurrent et arrête un calcul trop long',async()=>{
  vi.useFakeTimers();const process=child(),work=translateMessage('Texte fictif','en',new AbortController().signal,async()=>{});const failure=expect(work).rejects.toThrow('translation_timeout');
  await expect(translateMessage('Autre','en',new AbortController().signal,async()=>{})).rejects.toThrow('translation_busy');
  await vi.advanceTimersByTimeAsync(180000);await failure;expect(process.kill).toHaveBeenCalled();expect(translationBusy()).toBe(false);
 });
 it('borne aussi une écriture bloquée après la fin du modèle',async()=>{
  vi.useFakeTimers();const process=child();const work=translateMessage('Texte fictif','en',new AbortController().signal,()=>new Promise<void>(()=>{}));const failure=expect(work).rejects.toThrow();
  process.emit('message',{type:'done'});await vi.advanceTimersByTimeAsync(5001);await failure;expect(translationBusy()).toBe(false);
 });
});
