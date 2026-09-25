import {describe,it,expect,vi,afterEach} from 'vitest';
const mocks=vi.hoisted(()=>({init:vi.fn(),captureException:vi.fn(),close:vi.fn()}));
vi.mock('@sentry/node',()=>mocks);
import {initSentry} from '../../src/lib/sentry.js';
describe('Confidentialité des rapports d’erreur',()=>{
 afterEach(()=>{delete process.env.SENTRY_DSN});
 it('retire la requête, les cookies, le mot de passe, les liens et les traces du compte',()=>{
  process.env.SENTRY_DSN='https://public@example.test/1';initSentry();
  const config=mocks.init.mock.calls[0][0];
  const event=config.beforeSend({request:{headers:{cookie:'osd_session=SECRET_SESSION'},data:{pass:'SECRET_PASSWORD'},url:'https://example.test/?token=SECRET_LINK'},user:{email:'private@example.test'},breadcrumbs:[{data:{url:'SECRET_BREADCRUMB'}}],transaction:'GET /api/download/SECRET_TOKEN',extra:{path:'/api/admin/crm/customers/:id',method:'PATCH',headers:{cookie:'SECRET_SESSION'},body:'SECRET_PASSWORD'},message:'Erreur'});
  const wire=JSON.stringify(event);expect(wire).not.toContain('SECRET_');expect(wire).not.toContain('private@example.test');expect(event.extra).toEqual({path:'/api/admin/crm/customers/:id',method:'PATCH'});
 });
});
