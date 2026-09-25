// Copie de sûreté de l'or : chiffrer avant toute sortie vers R2.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
const MAGIC = Buffer.from("OSDBAK01");
export function backupKey(value = process.env.OSD_BACKUP_KEY): Buffer {
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) throw new Error("backup_key_missing_or_invalid");
  return Buffer.from(value, "hex");
}
export function encryptBackup(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MAGIC);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}
export function decryptBackup(bytes: Buffer, key: Buffer): Buffer {
  if (bytes.length < 36 || !bytes.subarray(0, 8).equals(MAGIC)) throw new Error("backup_format_invalid");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(8, 20));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(bytes.subarray(20, 36));
  return Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()]);
}
