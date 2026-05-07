# Pitch presse — Inside Paradeplatz

**Destinataire** : `mail@insideparadeplatz.ch`
**Format** : Gastbeitrag (Inside P. publie sous "ipteam" et auteurs externes)
**Angle** : compliance / KYC / fiduciaires (le terrain favori de Lukas Hässig)

---

## Objet

`Solo Founder VD bringt erstes MCP Schweiz mit BAZG-Bewilligung — 299 CHF statt 6'000`

---

## Email pitch (DE — Hässig préfère l'allemand)

Sehr geehrter Herr Hässig, sehr geehrtes ipteam,

Ich melde mich, weil das Thema Inside Paradeplatz interessieren könnte: ein Solo Founder aus der Waadt hat das **erste MCP-Server in der Schweiz** veröffentlicht, für Bundesdaten (TARES Zoll, NOGA/NACE/ISIC, FINMA-Register), mit einer **schriftlichen kommerziellen BAZG-Bewilligung** (M. Michael Beer, Tarifgrundlagen, 21. April 2026) **und einer schriftlichen Bestätigung der FINMA** (Nadine Bucher, Kommunikation, 6. Mai 2026), wonach keine Einwände gegen die kommerzielle Nutzung öffentlich zugänglicher FINMA-Daten bestehen.

**Der Knackpunkt für Compliance Officers**

Heute prüfen Banken, Treuhänder und KYC-Berater die FINMA-Beaufsichtigten manuell — 10 separate XLSX-Listen, jede mit eigenem Schema, UID mal mit "CHE-" Prefix, mal ohne. openswissdata vereinheitlicht alle 9 Listen unter einem Schema (16 Spalten inkl. UID + LEI), Ed25519 signiert, RFC-3161 zeitgestempelt. **Verifikation in 30 Sekunden mit `openssl`** — bankenfähig, prüfungssicher.

**Pricing transparent (was Schweizer KMU mögen)**
- TARES (Zoll) · 299 CHF
- Klassifikationen NOGA + NACE + ISIC · 399 CHF
- FINMA Registry vereinheitlicht · 299 CHF
- Bundle · 797 CHF (200 CHF Ersparnis)
- MCP Abonnement · 49 CHF/Monat

**Warum interessant für Inside Paradeplatz**

Drei Aspekte, die Ihre Leser erwarten:

1. **Solo Founder bootstrappt** ein Compliance-Tool, das die grossen RegTechs links liegen lassen (Ticketgrösse zu klein für sie, zu spezifisch für die Schweiz).
2. **Transparenz total** : Code öffentlich auf GitHub, Verifikationsanleitung mit `openssl`, BAZG-Referenz nachprüfbar. Kein Black Box.
3. **Direkter Konkurrent für 6'000 CHF/Release Inhouse-Aufwand** — die "make or buy"-Rechnung wird zugunsten "buy" eindeutig.

**Mein Angebot**

Ich kann einen **Gastbeitrag** (signiert "Claude-Alain Martin, founder openswissdata") liefern, 700-900 Wörter, mit folgendem Vorschlag:

> *"Wie ein Solo Founder den FINMA-Registerstandard löst, den niemand löst — und warum sich Compliance Officers bei jedem Audit fragen sollten, ob sie unterschriebene Daten verwenden."*

Lieferbar binnen 24h. HD-Foto + Datenbeispiele verfügbar.

**Ressourcen**
- Site : https://www.openswissdata.com
- Provenance + Verifikation : https://www.openswissdata.com/legal/provenance
- Code : https://github.com/cammac-creator/openswissdata
- BAZG-Referenz : `BAZG-PERMISSION-2026-04-21-MICHAEL-BEER`
- FINMA-Referenz : `FINMA-PERMISSION-2026-05-06-NADINE-BUCHER`

Bei Interesse bitte einfach per E-Mail antworten — ich bereite gerne die Detailpunkte für Sie auf.

Mit freundlichen Grüssen
Claude-Alain Martin
Founder openswissdata.com
contact@openswissdata.com

---

## Note interne

Inside Paradeplatz aime :
- Les solo founders contre les gros (David vs Goliath)
- Les chiffres concrets (299 CHF vs 6 000 CHF)
- Les angles juridiques précis (LDA art. 5, art. 36 ORC)
- Les "scoops" (ici : permission BAZG écrite, jamais documentée publiquement avant)

Ne JAMAIS faire :
- Tonalité corporate / marketing
- Promesses non chiffrables
- Plus de 1 page d'email
