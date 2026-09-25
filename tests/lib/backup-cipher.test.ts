import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync, createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import { backupKey, encryptBackup, decryptBackup } from "../../src/lib/backup-cipher.js";
describe("Sauvegarde chiffrée et restaurable", () => {
 it("restaure une base et refuse une clé incorrecte ou une copie altérée", () => {
  const db=new Database(":memory:"); db.exec("CREATE TABLE exemple(id INTEGER); INSERT INTO exemple VALUES(42)");
  const key=randomBytes(32); const archive=encryptBackup(db.serialize(),key); db.close();
  expect(archive.includes(Buffer.from("SQLite format"))).toBe(false);
  const restored=new Database(decryptBackup(archive,key)); expect(restored.pragma("quick_check",{simple:true})).toBe("ok"); expect(restored.prepare("SELECT id FROM exemple").get()).toEqual({id:42}); restored.close();
  expect(() => decryptBackup(archive,randomBytes(32))).toThrow(); archive[archive.length-1]^=1; expect(() => decryptBackup(archive,key)).toThrow();
 });
 it("restaure une sauvegarde issue d’une vraie base WAL", async () => {
  const dir=mkdtempSync(join(tmpdir(),"osd-backup-wal-"));
  const db=new Database(join(dir,"source.sqlite"));
  try {
   db.pragma("journal_mode=WAL"); db.exec("CREATE TABLE exemple(id INTEGER); INSERT INTO exemple VALUES(42)");
   const snapshot=join(dir,"snapshot.sqlite"), gzip=join(dir,"snapshot.gz"), restored=join(dir,"restored.sqlite");
   await db.backup(snapshot);
   await pipeline(createReadStream(snapshot),createGzip(),createWriteStream(gzip));
   const key=randomBytes(32);const encrypted=encryptBackup(readFileSync(gzip),key);
   await pipeline(Readable.from([decryptBackup(encrypted,key)]),createGunzip(),createWriteStream(restored));
   const check=new Database(restored,{readonly:true,fileMustExist:true});
   expect(check.pragma("quick_check",{simple:true})).toBe("ok");expect(check.prepare("SELECT id FROM exemple").get()).toEqual({id:42});check.close();
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
 });
 it("refuse une configuration absente ou tronquée", () => { expect(() => backupKey("abc")).toThrow(); });
});
