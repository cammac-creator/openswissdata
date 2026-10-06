import { describe, expect, it } from "vitest";
import { extractAuthservId, TRUSTED_AUTHSERV_IDS } from "../../src/lib/mail-watch.js";

describe("authentification des réponses : verrous de la relecture ciblée du 06.10", () => {
  it("la liste des serveurs de confiance reste vide tant que l'analyse n'est pas durcie", () => {
    // Remplir cette liste rend la classification « humaine » automatique possible : à faire seulement
    // après le durcissement de l'analyse (guillemets échappés, header.d entre guillemets ou en commentaire)
    // et la vérification sur une vraie réponse reçue par Infomaniak. Ce test doit alors être réécrit.
    expect(TRUSTED_AUTHSERV_IDS.size).toBe(0);
  });
  it.each([
    ["mx.infomaniak.com; dkim=pass header.d=seco.admin.ch", "mx.infomaniak.com"],
    ["jean.dupont@exemple.ch; dkim=pass", null],
    ["é@ü; dkim=pass", null],
    ['"quoted; dkim=pass', null],
    ["localhost; dkim=pass", null],
  ])("le nom de serveur noté n'est jamais qu'un nom d'hôte : %s", (raw, attendu) => {
    expect(extractAuthservId(raw)).toBe(attendu);
  });
});
