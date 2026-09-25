import {describe,it,expect,vi,afterEach} from "vitest";
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,truncateSync,readdirSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {bronze,sourceJson,crmKey} from "../../src/lib/crm-source.js";
import {decryptBackup} from "../../src/lib/backup-cipher.js";

describe("Archivage chiffré des paiements indépendant des mails",()=>{
  let temp:string;
  afterEach(()=>{if(temp)rmSync(temp,{recursive:true,force:true});vi.unstubAllEnvs();vi.unstubAllGlobals()});
  it("continue l’archivage financier quand le compartiment des mails est plein",async()=>{
    temp=mkdtempSync(join(tmpdir(),'osd-bronze-'));vi.stubEnv('DATABASE_PATH',join(temp,'fictive.sqlite'));
    vi.stubEnv('OSD_BACKUP_KEY','a'.repeat(64));const day=new Date().toISOString().slice(0,10);
    const mail=join(temp,'bronze/dashboard',day);mkdirSync(mail,{recursive:true});
    const sparse=join(mail,'volume-fictif.enc');writeFileSync(sparse,'');truncateSync(sparse,250_000_001);
    await expect(bronze('imap-fictif',Buffer.from('message fictif'))).rejects.toThrow('crm_bronze_capacity');
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'ch_fictive',amount:10000})));
    await expect(sourceJson('stripe-financial','https://example.test/fictif')).resolves.toEqual({id:'ch_fictive',amount:10000});
    await sourceJson('stripe-financial','https://example.test/fictif');
    const finance=join(temp,'bronze/financial',day),files=readdirSync(finance);expect(files).toHaveLength(1);
    const encrypted=readFileSync(join(finance,files[0]));expect(encrypted.toString()).not.toContain('ch_fictive');
    expect(JSON.parse(decryptBackup(encrypted,crmKey()).toString())).toEqual({id:'ch_fictive',amount:10000});
  });
});
