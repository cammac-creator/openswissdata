import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { checkReadiness } from "../../src/lib/readiness.js";

let db: Database.Database, root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "osd-readiness-"));
  db = new Database(":memory:");
  db.exec(readFileSync(new URL("../../src/db/schema.sql", import.meta.url), "utf8"));
  for (const id of ["tares", "classifications", "finma"]) {
    db.prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,current_version,created_at) VALUES(?,?,?,0,'fictif','2026.09.25',0)").run(id,id,id);
    db.prepare("INSERT INTO versions(dataset_id,version,r2_key,sha256,size_bytes,released_at) VALUES(?,'2026.09.25',?,?,123,0)").run(id,id+'/2026.09.25/dataset.zip','a'.repeat(64));
  }
  mkdirSync(join(root,"_astro")); writeFileSync(join(root,"_astro/style.hash.css"),'body { color: black; }');
  writeFileSync(join(root,"_astro/script.hash.js"),'void 0;');
  for (const page of ['index.html','de/index.html','en/index.html','admin/index.html','datasets/finma/index.html','datasets/tares/index.html','datasets/classifications/index.html']) {
    mkdirSync(dirname(join(root,page)),{recursive:true});
    writeFileSync(join(root,page),'<html lang="fr"><head><link href="/_astro/style.hash.css" rel="stylesheet"></head><body>Page fictive de contrôle<script src="/_astro/script.hash.js"></script></body></html>');
  }
});
afterEach(() => {db.close();rmSync(root,{recursive:true,force:true});});
describe('Démarrage représentatif du service',()=>{
  it('accepte une base préparée et les pages avec leurs ressources sans réseau',()=>{
    expect(checkReadiness(()=>db,root)).toEqual({ready:true,checks:{database:true,frontend:true}});
  });
  it('refuse un volume vide même si le schéma a été créé',()=>{
    db.exec('DELETE FROM versions; DELETE FROM datasets');
    expect(checkReadiness(()=>db,root)).toEqual({ready:false,checks:{database:false,frontend:true}});
  });
  it('refuse une référence vendue manquante ou invalide',()=>{
    db.exec("UPDATE datasets SET current_version='absent' WHERE id='finma'");
    expect(checkReadiness(()=>db,root).ready).toBe(false);
  });
  it('refuse une migration essentielle absente',()=>{
    db.exec('DROP TABLE order_deliveries');
    expect(checkReadiness(()=>db,root).checks.database).toBe(false);
  });
  it('refuse une page client manquante malgré un accueil présent',()=>{
    rmSync(join(root,'admin/index.html'));
    expect(checkReadiness(()=>db,root)).toEqual({ready:false,checks:{database:true,frontend:false}});
  });
  it('refuse les ressources absentes qui rendraient les pages inutilisables',()=>{
    rmSync(join(root,'_astro/script.hash.js'));
    expect(checkReadiness(()=>db,root).ready).toBe(false);
  });
  it('refuse une page tronquée',()=>{
    writeFileSync(join(root,'index.html'),'<html>'+'.'.repeat(200));
    expect(checkReadiness(()=>db,root).checks.frontend).toBe(false);
  });
  it('ne révèle aucun chemin ni message interne en cas de panne',()=>{
    const result=checkReadiness(()=>{throw new Error('/volume/prive.sqlite mot-de-passe');},root);
    expect(result).toEqual({ready:false,checks:{database:false,frontend:true}});
    expect(JSON.stringify(result)).not.toContain('prive');
  });
});
