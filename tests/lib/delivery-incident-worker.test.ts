import {afterEach,describe,expect,it,vi} from 'vitest';
import {startDeliveryIncidentWorker} from '../../src/lib/delivery-incident-worker.js';
describe('Relève indépendante du registre de livraison',()=>{
 afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()});
 it('attend le démarrage, contrôle chaque minute et s’arrête sans relance',()=>{
  vi.useFakeTimers();const scan=vi.fn(),stop=startDeliveryIncidentWorker({scan});expect(scan).not.toHaveBeenCalled();vi.advanceTimersByTime(29999);expect(scan).not.toHaveBeenCalled();vi.advanceTimersByTime(1);expect(scan).toHaveBeenCalledTimes(1);vi.advanceTimersByTime(60000);expect(scan).toHaveBeenCalledTimes(2);stop();vi.advanceTimersByTime(600000);expect(scan).toHaveBeenCalledTimes(2);
 });
 it('une erreur ne tue pas la relève et reste générique',()=>{
  vi.useFakeTimers();const log=vi.spyOn(console,'error').mockImplementation(()=>{}),scan=vi.fn().mockImplementationOnce(()=>{throw new Error('secret@example.test')});const stop=startDeliveryIncidentWorker({scan});vi.advanceTimersByTime(90000);expect(scan).toHaveBeenCalledTimes(2);expect(log).toHaveBeenCalledOnce();expect(JSON.stringify(log.mock.calls)).not.toContain('secret');stop();
 });
});
