// Rapport d'arrêt d'un contrôle FINMA — tâche osd.S05.
// Quand la collecte s'arrête pour demander un regard humain (variation,
// source incomplète, rapprochement anormal…), elle écrit ici un petit
// rapport JSON que l'étape d'alerte du workflow (`scripts/alert-email.mjs`)
// lit pour décrire le mail au lieu d'un texte fixe. Fichier temporaire du
// job (`FINMA_CONTROL_REPORT_FILE`, défini par le workflow, hors de
// `data/`) : jamais commité, jamais publié. Aucune donnée personnelle, nom
// de client ni secret ne doit y figurer.
import { writeFileSync } from "node:fs";

export interface ControlStopOption {
  /** Ce que Claude-Alain (ou un veilleur) peut faire ensuite. */
  label: string;
  /** Niveau de la carte des actions : AUTO, RELU ou BOUTON. */
  level: "AUTO" | "RELU" | "BOUTON";
}

export interface ControlStopReport {
  /** Identifiant court et stable du contrôle qui a arrêté la collecte. */
  control: string;
  /** Valeur lue par le contrôle (jamais une donnée personnelle ou un secret). */
  observed: string;
  /** Valeur attendue ou seuil que la valeur lue n'a pas respecté. */
  expected: string;
  /** Source officielle concernée. */
  source: string;
  /** Date du contrôle (YYYY-MM-DD). */
  date: string;
  /** Ce qui reste servi pendant que l'arrêt est examiné. */
  stays_served: string;
  /** Deux ou trois suites possibles, chacune avec son niveau. */
  options: ControlStopOption[];
}

/**
 * Écrit le rapport d'arrêt si `FINMA_CONTROL_REPORT_FILE` est défini (c'est
 * le workflow qui le pointe vers un fichier temporaire du job). Une écriture
 * ratée est journalisée mais ne doit jamais changer l'arrêt lui-même : cette
 * fonction ne lève jamais d'exception.
 */
export function writeControlStopReport(report: ControlStopReport): void {
  const path = process.env.FINMA_CONTROL_REPORT_FILE;
  if (!path) return;
  try {
    writeFileSync(path, JSON.stringify({ stop: report }, null, 2));
  } catch (err) {
    console.error("[release-finma] rapport d'arrêt non écrit :", err);
  }
}
