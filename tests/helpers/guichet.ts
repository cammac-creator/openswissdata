// Guichets factices pour les essais (aucun réseau) : celui qui dit toujours oui garde les essais d'avant
// le branchement du guichet (10.11.2026) inchangés ; celui qui enregistre sert aux essais du contrat.
import type { GuichetClient, GuichetIssue, SanteBody } from "../../src/lib/guichet.js";

export type GuichetRecord = {
  demandes: Array<{ boite: string; domaine: string }>;
  issues: Array<{ id: string; issue: GuichetIssue }>;
  santes: SanteBody[];
};

/** Guichet qui accorde chaque demande et reçoit tout. */
export function guichetOui(): GuichetClient {
  let n = 0;
  return {
    configured: () => true,
    demande: async () => ({ ok: true, id: `g-essai-${++n}` }),
    issue: async () => true,
    sante: async () => 200,
  };
}

/** Guichet qui enregistre ce qu'on lui demande ; `answer` décide de chaque demande (oui par défaut). */
export function guichetEnregistre(
  answer: (index: number, demande: { boite: string; domaine: string }) => Awaited<ReturnType<GuichetClient["demande"]>> = (index) => ({
    ok: true,
    id: `g-essai-${index + 1}`,
  }),
): GuichetClient & { record: GuichetRecord } {
  const record: GuichetRecord = { demandes: [], issues: [], santes: [] };
  return {
    record,
    configured: () => true,
    demande: async (boite, domaine) => {
      record.demandes.push({ boite, domaine });
      return answer(record.demandes.length - 1, { boite, domaine });
    },
    issue: async (id, issue) => {
      record.issues.push({ id, issue });
      return true;
    },
    sante: async (body) => {
      record.santes.push(body);
      return 200;
    },
  };
}
