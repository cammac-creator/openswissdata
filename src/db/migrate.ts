/** Initialise la base choisie et les migrations idempotentes de l’application. */
import { getDb, closeDb } from "../lib/db.js";

try {
  getDb();
  console.log("Schéma et migrations idempotentes appliqués à la base configurée.");
} finally {
  closeDb();
}
