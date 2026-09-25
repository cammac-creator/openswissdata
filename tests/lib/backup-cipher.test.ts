import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
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
 it("refuse une configuration absente ou tronquée", () => { expect(() => backupKey("abc")).toThrow(); });
});
