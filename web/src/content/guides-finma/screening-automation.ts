/**
 * Guide 3 : automatiser le contrôle FINMA d’une liste de contreparties.
 * Les exemples de code sont exécutés par tests/web/guides-finma.test.ts contre une archive construite
 * au format réellement livré (etl/finma/bundle.ts) : le SQL de chaque langue doit donner les mêmes résultats.
 * Noms et IDE des exemples fictifs ; les IDE ont un chiffre de contrôle invalide et ne désignent aucune entreprise.
 */
import type { GuideDefinition } from '../../lib/guides';

/** Même fichier d’exemple dans les trois langues : les identifiants de code restent en anglais. */
export const COUNTERPARTIES_CSV = `reference,name,uid
C-001,Exemple Banque SA,CHE-123.456.789
C-002,Exemple Gestion Sàrl,CHE987654321 TVA
C-003,Exemple Conseil AG,`;

const SHELL_LOAD = `sqlite3 check.db < finma_registry.sql
sqlite3 check.db < finma_warnings.sql
sqlite3 -header -column check.db < checks.sql`;

const MCP_CALL = `claude mcp add --transport http openswissdata https://mcp.openswissdata.com/jsonrpc

curl -s https://mcp.openswissdata.com/jsonrpc \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"kyc_check","arguments":{"name":"Exemple Banque"}}}'`;

const JQ_LOOKUP = `jq '.[] | select(.uid == "CHE-123.456.789") | {name, licence_type, lei}' finma_registry.json`;

const CHECKSUMS = `shasum -a 256 -c checksums.sha256    # macOS
sha256sum -c checksums.sha256        # Linux`;

function checksSql(c: { intro: string; key: string; q1: string; q2: string; q3: string }, label: 'licence_type' | 'licence_type_fr' | 'licence_type_de'): string {
  return `-- ${c.intro}
DROP TABLE IF EXISTS counterparties;
.import --csv counterparties.csv counterparties

-- ${c.key}
CREATE TEMP VIEW counterparty_uid AS
SELECT *, substr(upper(replace(replace(replace(uid, '-', ''), '.', ''), ' ', '')), 1, 12) AS uid_key
FROM counterparties WHERE trim(uid) <> '';

CREATE TEMP VIEW registry_uid AS
SELECT *, substr(upper(replace(replace(replace(uid, '-', ''), '.', ''), ' ', '')), 1, 12) AS uid_key
FROM finma_registry WHERE uid <> '';

-- ${c.q1}
SELECT c.reference, c.name, min(r.name) AS finma_name,
       group_concat(r.${label}, ' ; ') AS authorisations
FROM counterparty_uid c
JOIN registry_uid r ON r.uid_key = c.uid_key
GROUP BY c.reference, c.name;

-- ${c.q2}
SELECT reference, name FROM counterparties
WHERE reference NOT IN (
  SELECT c.reference FROM counterparty_uid c
  JOIN registry_uid r ON r.uid_key = c.uid_key
);

-- ${c.q3}
SELECT c.reference, c.name, w.name AS warning_name, w.date_added, w.source_url
FROM counterparties c
JOIN finma_warnings w
  ON instr(lower(w.name), lower(c.name)) > 0
  OR instr(lower(c.name), lower(w.name)) > 0;`;
}

function candidatesPython(c: { forms: string; short: string }): string {
  return `import csv
import re
import unicodedata

# ${c.forms}
LEGAL_FORMS = {"ag", "sa", "sarl", "gmbh", "ltd", "sagl", "kg", "snc", "scs"}

def fold(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return " ".join(w for w in re.findall(r"[a-z0-9]+", text) if w not in LEGAL_FORMS)

with open("finma_warnings.csv", encoding="utf-8-sig", newline="") as f:
    warnings = [(fold(row["name"]), row) for row in csv.DictReader(f)]

with open("counterparties.csv", encoding="utf-8-sig", newline="") as f:
    for row in csv.DictReader(f):
        key = fold(row["name"])
        if len(key) < 4:
            continue  # ${c.short}
        for folded, warning in warnings:
            if len(folded) >= 4 and (key in folded or folded in key):
                print(row["reference"], row["name"], "->", warning["name"], warning["source_url"])`;
}

export const screeningAutomation: GuideDefinition = {
  schemaType: 'TechArticle',
  order: 3,
  fr: {
    title: "Automatiser le contrôle FINMA de vos contreparties",
    description: "Rapprocher une liste de contreparties du registre FINMA et de la liste d’alerte : IDE, LEI puis nom, mises à jour, requêtes SQL testées et accès MCP gratuit.",
    short: "Automatiser le contrôle",
    summary: "Rapprocher une liste entière par IDE, par LEI puis par nom, avec des requêtes testées et la trace de chaque version.",
    h1: "Automatiser le contrôle FINMA",
    accent: "de vos contreparties.",
    lede: "Vérifier trois noms à la main prend quelques minutes. Pour des centaines de contreparties revues périodiquement, il faut une méthode reproductible : rapprocher d’abord par identifiant, traiter les noms comme des pistes, et garder la trace de la version utilisée. Ce guide la décrit avec le fichier FINMA d’OpenSwissData et des exemples testés.",
    sections: [
      {
        id: "principe", title: "Le principe",
        blocks: [
          { type: "path", label: "Le parcours d’un contrôle automatisé", steps: [
            { title: "Vos contreparties", text: "Nom, IDE et LEI lorsque vous les connaissez." },
            { title: "Normaliser", text: "IDE ramené à « CHE » et neuf chiffres, LEI en majuscules." },
            { title: "Rapprocher par identifiant", text: "IDE exact, puis LEI exact : des correspondances sûres." },
            { title: "Rapprocher par nom", text: "Des candidats à examiner, jamais des verdicts." },
            { title: "Examiner et tracer", text: "Une personne tranche ; la version du fichier et la décision sont conservées." },
          ] },
          { type: "p", text: "Le rapprochement par identifiant donne des correspondances sûres. Le rapprochement par nom ne produit que des candidats : il oriente l’examen humain, il ne conclut pas." },
        ],
      },
      {
        id: "donnees", title: "Les fichiers à rapprocher",
        blocks: [
          { type: "p", text: "L’archive FINMA d’OpenSwissData contient notamment :" },
          { type: "table", caption: "Contenu utile de l’archive", head: ["Fichier", "Contenu", "À savoir"], rows: [
            ["`finma_registry.csv`, `.json`, `.sql`, `.parquet`", "Une ligne par autorisation de la liste des UID publiée par la FINMA.", "Une entreprise titulaire de plusieurs autorisations figure sur plusieurs lignes."],
            ["`finma_<catégorie>.csv`", "Les mêmes lignes, un fichier par catégorie non vide.", "Catégories regroupées par OpenSwissData (champ `entity_type`)."],
            ["`finma_warnings.csv`, `.json`, `.sql`, `.parquet`", "La liste d’alerte, séparée du registre.", "Nom, date, filtre du registre du commerce et lien de détail seulement."],
            ["`finma.xlsx`", "Registre et avertissements dans deux feuilles.", "Une troisième feuille rappelle les règles de lecture."],
            ["`changelog_90d.csv`, `.json`", "Les changements observés entre les versions disponibles.", "Dates d’observation, pas dates de décision de la FINMA."],
            ["`quality.json`, `checksums.sha256`, `provenance.json`", "Couverture des champs, interruptions de collecte, empreintes et signature.", "À conserver avec le résultat du contrôle."],
          ] },
          { type: "h3", text: "Les champs du registre utiles au rapprochement" },
          { type: "table", caption: "Champs de finma_registry", head: ["Champ", "Contenu"], rows: [
            ["`uid`", "L’IDE tel que publié par la FINMA, au format `CHE-123.456.789` ; vide pour certaines lignes."],
            ["`name`, `city`", "Le nom et la localité publiés par la FINMA."],
            ["`licence_type`, `licence_type_fr`, `licence_type_de`, `licence_type_it`", "Le type d’autorisation, libellé par la FINMA en anglais, français, allemand et italien."],
            ["`entity_type`", "Un regroupement fait par OpenSwissData ; un libellé non classé tombe dans `other`. Pour un filtre précis, utilisez `licence_type`."],
            ["`lei`, `lei_registration_status`", "Le LEI, seulement lorsque l’IDE correspond exactement à un seul LEI chez la GLEIF, et le statut de cet enregistrement LEI."],
            ["`address`, `canton`", "Repris de la GLEIF lorsqu’un LEI a été rattaché ; sinon vides."],
            ["`licence_date`, `status`", "Vides : la liste de la FINMA ne les fournit pas."],
            ["`is_warning_listed`", "Vide : aucun lien avec la liste d’alerte n’est déduit d’une ressemblance de noms."],
          ] },
          { type: "p", text: "Dans les fichiers CSV et SQL, une valeur absente est une chaîne vide ; dans le JSON, la clé est absente ou vaut `null` ; dans le Parquet, la valeur est nulle. En SQL, testez donc `uid <> ''` plutôt que `uid IS NOT NULL`." },
        ],
      },
      {
        id: "frequence", title: "Fréquence de mise à jour",
        blocks: [
          { type: "p", text: "Côté FINMA, les listes sont « mises à jour régulièrement », et chaque liste affiche sa date de dernière modification.[^finma-autorises] Pour la liste d’alerte, la FINMA ne garantit ni l’exhaustivité ni une mise à jour complète.[^finma-liste-alerte]" },
          { type: "p", text: "Côté OpenSwissData, la collecte FINMA est planifiée chaque jour. Une collecte peut être bloquée si ses contrôles échouent ; les interruptions sont signalées dans `quality.json`, et la version réellement disponible est affichée sur la [fiche produit](@/datasets/finma/)." },
          { type: "p", text: "La fréquence de votre propre contrôle relève de votre politique de risque : par exemple avant chaque entrée en relation, puis à intervalles réguliers. Le fichier `changelog_90d` aide à cibler les contreparties concernées par un changement observé." },
        ],
      },
      {
        id: "ordre", title: "Rapprocher dans le bon ordre",
        blocks: [
          { type: "h3", text: "1. L’IDE d’abord" },
          { type: "p", text: "L’OFS admet deux graphies de l’IDE, avec ou sans tirets et points, et l’ajout RC ou TVA ne fait pas partie du numéro.[^ofs-uid] Ramenez les deux côtés à une forme compacte, « CHE » suivi des neuf chiffres : une égalité exacte sur cette forme est un rapprochement sûr." },
          { type: "h3", text: "2. Le LEI ensuite" },
          { type: "p", text: "Si votre contrepartie a un LEI, comparez-le au champ `lei`, en majuscules. Le fichier n’attribue un LEI que lorsque l’IDE correspond exactement à un seul LEI chez la GLEIF : un LEI absent du fichier ne signifie pas que l’entité n’en a pas." },
          { type: "h3", text: "3. Le nom en dernier, avec prudence" },
          { type: "p", text: "Pour les contreparties sans identifiant, et pour toute la liste d’alerte, qui ne contient pas d’IDE, le nom est le seul point de rencontre. Normalisez les deux côtés (casse, accents, formes juridiques), cherchez les noms contenus l’un dans l’autre, puis soumettez chaque candidat à un examen humain." },
          { type: "callout", tone: "warn", title: "Une correspondance de nom n’est pas une identité", text: "Pour la liste d’alerte en particulier, un candidat n’établit rien sur votre contrepartie : comparez siège, adresse et site internet sur la page de détail de la FINMA avant toute conclusion. Voir le [guide sur la liste d’alerte](@/guides/finma-warning-list/)." },
        ],
      },
      {
        id: "sqlite", title: "Exemple : SQLite en ligne de commande",
        blocks: [
          { type: "p", text: "Les fichiers `.sql` de l’archive créent chacun une table, aux colonnes de type texte, et l’alimentent. Placez dans le dossier de l’archive décompressée un fichier `counterparties.csv` :" },
          { type: "code", label: "counterparties.csv", language: "csv", code: COUNTERPARTIES_CSV },
          { type: "p", text: "Les noms et les IDE de cet exemple sont fictifs. Chargez ensuite les deux tables, puis lancez les contrôles décrits dans `checks.sql` :" },
          { type: "code", label: "Terminal : charger et contrôler", language: "sh", code: SHELL_LOAD },
          { type: "code", label: "checks.sql", language: "sql", code: checksSql({ intro: "Vos contreparties : un fichier CSV avec les colonnes reference, name et uid", key: "IDE ramené à « CHE » suivi de neuf chiffres, des deux côtés", q1: "1. Correspondances par IDE, autorisations regroupées", q2: "2. À examiner : pas d’IDE, ou IDE absent de la liste", q3: "3. Candidats de la liste d’alerte, à examiner : un nom contenu dans l’autre" }, "licence_type_fr") },
          { type: "p", text: "La première requête regroupe les autorisations d’une même entreprise. La deuxième liste les contreparties à examiner, faute d’IDE ou de correspondance : ce ne sont pas des contreparties « non autorisées ». La troisième ne produit que des candidats ; la fonction `lower()` de SQLite ne traite que les lettres ASCII, si bien que les accents restent distinctifs." },
          { type: "h3", text: "Avec le JSON" },
          { type: "p", text: "Pour retrouver toutes les autorisations d’un IDE avec `jq` :" },
          { type: "code", label: "Terminal : jq", language: "sh", code: JQ_LOOKUP },
        ],
      },
      {
        id: "python", title: "Exemple : préparer les noms en Python",
        blocks: [
          { type: "p", text: "Pour comparer des noms sans tenir compte des accents ni des formes juridiques, une normalisation simple suffit à produire des candidats plus robustes :" },
          { type: "code", label: "candidates.py", language: "python", code: candidatesPython({ forms: "Formes juridiques courantes, retirées avant la comparaison (liste indicative)", short: "nom trop court pour une recherche utile" }) },
          { type: "p", text: "La liste des formes juridiques est indicative : adaptez-la à vos contreparties. Chaque ligne affichée reste un candidat à examiner." },
        ],
      },
      {
        id: "trace", title: "Garder la trace de chaque contrôle",
        blocks: [
          { type: "p", text: "Pour pouvoir expliquer un résultat plus tard, conservez avec lui :" },
          { type: "list", items: [
            "la version du fichier, qui figure dans le nom de l’archive et dans `quality.json` ;",
            "le fichier `checksums.sha256` et le résultat de sa vérification ;",
            "la date du contrôle, les correspondances retenues et les décisions prises sur les candidats.",
          ] },
          { type: "code", label: "Dans le dossier de l’archive décompressée", language: "sh", code: CHECKSUMS },
          { type: "p", text: "Les dates de `changelog_90d` sont des dates d’observation entre deux versions, pas des dates de décision de la FINMA." },
        ],
      },
      {
        id: "mcp", title: "Pour une question ponctuelle : kyc_check",
        blocks: [
          { type: "p", text: "Le serveur MCP d’OpenSwissData propose l’outil `kyc_check`, sans compte ni clé, dans la limite de 100 appels par heure et par adresse IP. Il cherche un nom dans le registre et dans la liste d’alerte, sans tenir compte de la casse ni des accents, et renvoie les résultats les plus proches avec leur nombre total. Une réponse vide n’est pas un certificat de conformité." },
          { type: "code", label: "Claude Code, ou tout client HTTP", language: "sh", code: MCP_CALL },
          { type: "p", text: "L’achat du fichier n’ouvre aucun accès MCP payant, et les nouveaux abonnements Pro sont fermés pour le moment. Détails et autres clients : [page du serveur MCP](@/mcp/#install)." },
        ],
      },
      {
        id: "limites", title: "Limites",
        blocks: [
          { type: "list", items: [
            "Le fichier suit la liste des UID d’entreprises autorisées publiée par la FINMA. Il ne couvre ni le registre des intermédiaires d’assurance, ni les membres des OAR, ni les placements collectifs : consultez ces sources directement.[^finma-autorises]",
            "Les dates d’autorisation et les statuts détaillés ne figurent pas dans la liste de la FINMA : les champs correspondants restent vides.",
            "Un rapprochement par nom produit des faux positifs et peut manquer une variante : il reste un tri avant examen.",
            "Une ligne du fichier reflète la liste de la FINMA à la date de collecte ; pour une décision, la source officielle fait foi.",
          ] },
        ],
      },
    ],
  },
  de: {
    title: "Die FINMA-Prüfung Ihrer Gegenparteien automatisieren",
    description: "Gegenparteien mit dem FINMA-Register und der Warnliste abgleichen: UID, LEI, dann Name, Aktualisierung, getestete SQL-Abfragen und kostenloser MCP-Zugang.",
    short: "Prüfung automatisieren",
    summary: "Eine ganze Liste über UID, LEI und zuletzt Name abgleichen, mit getesteten Abfragen und einer Spur jeder Version.",
    h1: "Die FINMA-Prüfung",
    accent: "Ihrer Gegenparteien automatisieren.",
    lede: "Drei Namen von Hand zu prüfen dauert wenige Minuten. Für Hunderte von Gegenparteien, die regelmässig überprüft werden, braucht es ein wiederholbares Vorgehen: zuerst über Kennungen abgleichen, Namen als Hinweise behandeln und die verwendete Version festhalten. Dieser Leitfaden beschreibt es mit der FINMA-Datei von OpenSwissData und getesteten Beispielen.",
    sections: [
      {
        id: "principe", title: "Das Prinzip",
        blocks: [
          { type: "path", label: "Ablauf einer automatisierten Prüfung", steps: [
            { title: "Ihre Gegenparteien", text: "Name, UID und LEI, soweit bekannt." },
            { title: "Normalisieren", text: "UID auf «CHE» und neun Ziffern bringen, LEI in Grossbuchstaben." },
            { title: "Über Kennungen abgleichen", text: "Exakte UID, dann exakter LEI: sichere Übereinstimmungen." },
            { title: "Über Namen abgleichen", text: "Kandidaten zur Prüfung, nie Urteile." },
            { title: "Prüfen und festhalten", text: "Eine Person entscheidet; Dateiversion und Entscheid werden aufbewahrt." },
          ] },
          { type: "p", text: "Der Abgleich über Kennungen liefert sichere Übereinstimmungen. Der Abgleich über Namen liefert nur Kandidaten: Er lenkt die menschliche Prüfung, er entscheidet nicht." },
        ],
      },
      {
        id: "donnees", title: "Die abzugleichenden Dateien",
        blocks: [
          { type: "p", text: "Das FINMA-Archiv von OpenSwissData enthält unter anderem:" },
          { type: "table", caption: "Nützlicher Inhalt des Archivs", head: ["Datei", "Inhalt", "Gut zu wissen"], rows: [
            ["`finma_registry.csv`, `.json`, `.sql`, `.parquet`", "Eine Zeile je Bewilligung aus der von der FINMA veröffentlichten UID-Liste.", "Ein Unternehmen mit mehreren Bewilligungen erscheint auf mehreren Zeilen."],
            ["`finma_<kategorie>.csv`", "Dieselben Zeilen, eine Datei je nicht leerer Kategorie.", "Kategorien von OpenSwissData gruppiert (Feld `entity_type`)."],
            ["`finma_warnings.csv`, `.json`, `.sql`, `.parquet`", "Die Warnliste, getrennt vom Register.", "Nur Name, Datum, Handelsregister-Filter und Link zur Detailseite."],
            ["`finma.xlsx`", "Register und Warnungen in zwei Tabellenblättern.", "Ein drittes Blatt erinnert an die Leseregeln."],
            ["`changelog_90d.csv`, `.json`", "Beobachtete Änderungen zwischen den verfügbaren Versionen.", "Beobachtungsdaten, keine Entscheiddaten der FINMA."],
            ["`quality.json`, `checksums.sha256`, `provenance.json`", "Abdeckung der Felder, Erhebungslücken, Prüfsummen und Signatur.", "Zusammen mit dem Prüfergebnis aufbewahren."],
          ] },
          { type: "h3", text: "Die Registerfelder für den Abgleich" },
          { type: "table", caption: "Felder von finma_registry", head: ["Feld", "Inhalt"], rows: [
            ["`uid`", "Die UID, wie von der FINMA veröffentlicht, im Format `CHE-123.456.789`; bei einigen Zeilen leer."],
            ["`name`, `city`", "Name und Ort gemäss FINMA."],
            ["`licence_type`, `licence_type_fr`, `licence_type_de`, `licence_type_it`", "Die Bewilligungsart, von der FINMA auf Englisch, Französisch, Deutsch und Italienisch bezeichnet."],
            ["`entity_type`", "Eine Gruppierung durch OpenSwissData; eine nicht zugeordnete Bezeichnung landet in `other`. Für einen genauen Filter verwenden Sie `licence_type`."],
            ["`lei`, `lei_registration_status`", "Der LEI, nur wenn die UID genau einem LEI bei der GLEIF entspricht, und der Status dieser LEI-Registrierung."],
            ["`address`, `canton`", "Von der GLEIF übernommen, wenn ein LEI zugeordnet wurde; sonst leer."],
            ["`licence_date`, `status`", "Leer: Die Liste der FINMA enthält diese Angaben nicht."],
            ["`is_warning_listed`", "Leer: Aus einer Namensähnlichkeit wird keine Verbindung zur Warnliste abgeleitet."],
          ] },
          { type: "p", text: "In CSV und SQL ist ein fehlender Wert eine leere Zeichenkette; im JSON fehlt der Schlüssel oder er ist `null`; im Parquet ist der Wert null. Prüfen Sie in SQL deshalb `uid <> ''` statt `uid IS NOT NULL`." },
        ],
      },
      {
        id: "frequence", title: "Aktualisierung",
        blocks: [
          { type: "p", text: "Aufseiten der FINMA werden die Listen «regelmässig aktualisiert», und jede Liste zeigt das Datum ihrer letzten Änderung.[^finma-autorises] Die Warnliste ist weder abschliessend noch tagesaktuell.[^finma-liste-alerte]" },
          { type: "p", text: "Bei OpenSwissData ist die FINMA-Erhebung täglich geplant. Eine Erhebung kann gestoppt werden, wenn ihre Kontrollen fehlschlagen; Lücken werden in `quality.json` ausgewiesen, und die tatsächlich verfügbare Version steht auf der [Produktseite](@/datasets/finma/)." },
          { type: "p", text: "Wie oft Sie selbst prüfen, ist eine Frage Ihrer Risikopolitik: zum Beispiel vor jeder neuen Geschäftsbeziehung und danach in regelmässigen Abständen. Die Datei `changelog_90d` hilft, die von einer beobachteten Änderung betroffenen Gegenparteien gezielt zu prüfen." },
        ],
      },
      {
        id: "ordre", title: "In der richtigen Reihenfolge abgleichen",
        blocks: [
          { type: "h3", text: "1. Zuerst die UID" },
          { type: "p", text: "Das BFS lässt beide Schreibweisen der UID zu, mit oder ohne Bindestrich und Punkte, und die Ergänzung HR oder MWST gehört nicht zur Nummer.[^ofs-uid] Bringen Sie beide Seiten auf eine kompakte Form, «CHE» gefolgt von den neun Ziffern: Eine exakte Übereinstimmung in dieser Form ist ein sicherer Abgleich." },
          { type: "h3", text: "2. Dann der LEI" },
          { type: "p", text: "Hat Ihre Gegenpartei einen LEI, vergleichen Sie ihn in Grossbuchstaben mit dem Feld `lei`. Die Datei ordnet einen LEI nur zu, wenn die UID genau einem LEI bei der GLEIF entspricht: Fehlt ein LEI in der Datei, heisst das nicht, dass die Einheit keinen hat." },
          { type: "h3", text: "3. Zuletzt der Name, mit Vorsicht" },
          { type: "p", text: "Für Gegenparteien ohne Kennung und für die ganze Warnliste, die keine UID enthält, bleibt nur der Name. Normalisieren Sie beide Seiten (Gross- und Kleinschreibung, Akzente, Rechtsformen), suchen Sie Namen, die im anderen enthalten sind, und legen Sie jeden Kandidaten einer menschlichen Prüfung vor." },
          { type: "callout", tone: "warn", title: "Eine Namensübereinstimmung ist keine Identität", text: "Gerade bei der Warnliste belegt ein Kandidat nichts über Ihre Gegenpartei: Vergleichen Sie Sitz, Adresse und Website auf der Detailseite der FINMA, bevor Sie etwas folgern. Siehe den [Leitfaden zur Warnliste](@/guides/finma-warning-list/)." },
        ],
      },
      {
        id: "sqlite", title: "Beispiel: SQLite in der Kommandozeile",
        blocks: [
          { type: "p", text: "Die `.sql`-Dateien des Archivs legen je eine Tabelle mit Textspalten an und füllen sie. Legen Sie in den Ordner des entpackten Archivs eine Datei `counterparties.csv`:" },
          { type: "code", label: "counterparties.csv", language: "csv", code: COUNTERPARTIES_CSV },
          { type: "p", text: "Namen und UID dieses Beispiels sind fiktiv. Laden Sie danach die beiden Tabellen und starten Sie die Prüfungen aus `checks.sql`:" },
          { type: "code", label: "Terminal: laden und prüfen", language: "sh", code: SHELL_LOAD },
          { type: "code", label: "checks.sql", language: "sql", code: checksSql({ intro: "Ihre Gegenparteien: eine CSV-Datei mit den Spalten reference, name und uid", key: "UID auf «CHE» und neun Ziffern gebracht, auf beiden Seiten", q1: "1. Übereinstimmungen über die UID, Bewilligungen zusammengefasst", q2: "2. Zu prüfen: keine UID oder UID nicht in der Liste", q3: "3. Kandidaten der Warnliste, zu prüfen: ein Name im anderen enthalten" }, "licence_type_de") },
          { type: "p", text: "Die erste Abfrage fasst die Bewilligungen eines Unternehmens zusammen. Die zweite listet die zu prüfenden Gegenparteien ohne UID oder ohne Übereinstimmung auf: Das sind keine «nicht bewilligten» Gegenparteien. Die dritte liefert nur Kandidaten; die SQLite-Funktion `lower()` behandelt nur ASCII-Buchstaben, Akzente bleiben also unterscheidend." },
          { type: "h3", text: "Mit dem JSON" },
          { type: "p", text: "Alle Bewilligungen einer UID mit `jq` finden:" },
          { type: "code", label: "Terminal: jq", language: "sh", code: JQ_LOOKUP },
        ],
      },
      {
        id: "python", title: "Beispiel: Namen in Python aufbereiten",
        blocks: [
          { type: "p", text: "Um Namen ohne Akzente und Rechtsformen zu vergleichen, genügt eine einfache Normalisierung für robustere Kandidaten:" },
          { type: "code", label: "candidates.py", language: "python", code: candidatesPython({ forms: "Häufige Rechtsformen, vor dem Vergleich entfernt (Liste als Beispiel)", short: "Name zu kurz für eine sinnvolle Suche" }) },
          { type: "p", text: "Die Liste der Rechtsformen ist ein Beispiel: Passen Sie sie an Ihre Gegenparteien an. Jede ausgegebene Zeile bleibt ein zu prüfender Kandidat." },
        ],
      },
      {
        id: "trace", title: "Jede Prüfung nachvollziehbar halten",
        blocks: [
          { type: "p", text: "Damit sich ein Ergebnis später erklären lässt, bewahren Sie zusammen mit ihm auf:" },
          { type: "list", items: [
            "die Version der Datei, die im Namen des Archivs und in `quality.json` steht;",
            "die Datei `checksums.sha256` und das Ergebnis ihrer Prüfung;",
            "das Datum der Prüfung, die bestätigten Übereinstimmungen und die Entscheide zu den Kandidaten.",
          ] },
          { type: "code", label: "Im Ordner des entpackten Archivs", language: "sh", code: CHECKSUMS },
          { type: "p", text: "Die Daten in `changelog_90d` sind Beobachtungsdaten zwischen zwei Versionen, keine Entscheiddaten der FINMA." },
        ],
      },
      {
        id: "mcp", title: "Für eine einzelne Frage: kyc_check",
        blocks: [
          { type: "p", text: "Der MCP-Server von OpenSwissData bietet das Werkzeug `kyc_check` ohne Konto und ohne Schlüssel an, mit bis zu 100 Aufrufen pro Stunde und IP-Adresse. Es sucht einen Namen im Register und in der Warnliste, unabhängig von Gross- und Kleinschreibung und Akzenten, und liefert die nächsten Treffer mit ihrer Gesamtzahl. Eine leere Antwort ist keine Konformitätsbescheinigung." },
          { type: "code", label: "Claude Code oder jeder HTTP-Client", language: "sh", code: MCP_CALL },
          { type: "p", text: "Der Kauf der Datei eröffnet keinen kostenpflichtigen MCP-Zugang, und neue Pro-Abonnements sind derzeit geschlossen. Details und weitere Clients: [Seite des MCP-Servers](@/mcp/#install)." },
        ],
      },
      {
        id: "limites", title: "Grenzen",
        blocks: [
          { type: "list", items: [
            "Die Datei folgt der von der FINMA veröffentlichten UID-Liste bewilligter Unternehmen. Sie umfasst weder das Register der Versicherungsvermittler noch die SRO-Mitglieder oder die kollektiven Kapitalanlagen: Konsultieren Sie diese Quellen direkt.[^finma-autorises]",
            "Bewilligungsdaten und detaillierte Status sind in der Liste der FINMA nicht enthalten: Die entsprechenden Felder bleiben leer.",
            "Ein Abgleich über Namen erzeugt Fehltreffer und kann eine Variante übersehen: Er bleibt eine Vorauswahl vor der Prüfung.",
            "Eine Zeile der Datei spiegelt die Liste der FINMA zum Zeitpunkt der Erhebung; für einen Entscheid ist die offizielle Quelle massgebend.",
          ] },
        ],
      },
    ],
  },
  en: {
    title: "Automating FINMA checks on your counterparties",
    description: "Match a list of counterparties against the FINMA registry and warning list: UID, LEI, then name, update frequency, tested SQL queries and free MCP access.",
    short: "Automating the check",
    summary: "Match a whole list by UID, then LEI, then name, with tested queries and a record of every version.",
    h1: "Automating FINMA checks",
    accent: "on your counterparties.",
    lede: "Checking three names by hand takes a few minutes. For hundreds of counterparties reviewed periodically, you need a repeatable method: match by identifier first, treat names as leads, and keep a record of the version used. This guide describes that method with the OpenSwissData FINMA file and tested examples.",
    sections: [
      {
        id: "principe", title: "The principle",
        blocks: [
          { type: "path", label: "How an automated check unfolds", steps: [
            { title: "Your counterparties", text: "Name, UID and LEI when you have them." },
            { title: "Normalise", text: "UID reduced to “CHE” and nine digits, LEI in upper case." },
            { title: "Match by identifier", text: "Exact UID, then exact LEI: reliable matches." },
            { title: "Match by name", text: "Candidates to review, never verdicts." },
            { title: "Review and record", text: "A person decides; the file version and the decision are kept." },
          ] },
          { type: "p", text: "Matching by identifier gives reliable matches. Matching by name only produces candidates: it guides the human review, it does not conclude." },
        ],
      },
      {
        id: "donnees", title: "The files to match",
        blocks: [
          { type: "p", text: "The OpenSwissData FINMA archive contains, among other files:" },
          { type: "table", caption: "Useful contents of the archive", head: ["File", "Contents", "Good to know"], rows: [
            ["`finma_registry.csv`, `.json`, `.sql`, `.parquet`", "One row per authorisation in the UID list published by FINMA.", "A company holding several authorisations appears on several rows."],
            ["`finma_<category>.csv`", "The same rows, one file per non-empty category.", "Categories grouped by OpenSwissData (field `entity_type`)."],
            ["`finma_warnings.csv`, `.json`, `.sql`, `.parquet`", "The warning list, separate from the registry.", "Name, date, commercial register filter and detail link only."],
            ["`finma.xlsx`", "Registry and warnings in two sheets.", "A third sheet recalls the reading rules."],
            ["`changelog_90d.csv`, `.json`", "Changes observed between the available versions.", "Observation dates, not FINMA decision dates."],
            ["`quality.json`, `checksums.sha256`, `provenance.json`", "Field coverage, collection gaps, checksums and signature.", "Keep them with the result of the check."],
          ] },
          { type: "h3", text: "Registry fields used for matching" },
          { type: "table", caption: "Fields of finma_registry", head: ["Field", "Contents"], rows: [
            ["`uid`", "The UID as published by FINMA, formatted `CHE-123.456.789`; empty for some rows."],
            ["`name`, `city`", "The name and city published by FINMA."],
            ["`licence_type`, `licence_type_fr`, `licence_type_de`, `licence_type_it`", "The authorisation type, labelled by FINMA in English, French, German and Italian."],
            ["`entity_type`", "A grouping made by OpenSwissData; an unmapped label falls into `other`. For a precise filter, use `licence_type`."],
            ["`lei`, `lei_registration_status`", "The LEI, only when the UID matches exactly one LEI at GLEIF, and the status of that LEI registration."],
            ["`address`, `canton`", "Taken from GLEIF when an LEI has been attached; otherwise empty."],
            ["`licence_date`, `status`", "Empty: FINMA’s list does not provide them."],
            ["`is_warning_listed`", "Empty: no link to the warning list is inferred from similar names."],
          ] },
          { type: "p", text: "In the CSV and SQL files, a missing value is an empty string; in the JSON, the key is missing or `null`; in Parquet, the value is null. In SQL, test `uid <> ''` rather than `uid IS NOT NULL`." },
        ],
      },
      {
        id: "frequence", title: "Update frequency",
        blocks: [
          { type: "p", text: "On FINMA’s side, the lists are “regularly updated”, and each list shows its date of last modification.[^finma-autorises] The warning list is neither exhaustive nor updated on a daily basis.[^finma-liste-alerte]" },
          { type: "p", text: "On the OpenSwissData side, FINMA collection is scheduled daily. A collection can be blocked if its checks fail; gaps are reported in `quality.json`, and the version actually available is shown on the [product page](@/datasets/finma/)." },
          { type: "p", text: "How often you run your own check is a matter for your risk policy: for example before each new relationship, then at regular intervals. The `changelog_90d` file helps you target the counterparties affected by an observed change." },
        ],
      },
      {
        id: "ordre", title: "Matching in the right order",
        blocks: [
          { type: "h3", text: "1. The UID first" },
          { type: "p", text: "The FSO allows two ways of writing the UID, with or without hyphens and full stops, and the HR or MWST suffix is not part of the number.[^ofs-uid] Reduce both sides to a compact form, “CHE” followed by the nine digits: an exact match on that form is a reliable match." },
          { type: "h3", text: "2. Then the LEI" },
          { type: "p", text: "If your counterparty has an LEI, compare it in upper case with the `lei` field. The file only attaches an LEI when the UID matches exactly one LEI at GLEIF: an LEI missing from the file does not mean the entity has none." },
          { type: "h3", text: "3. The name last, with care" },
          { type: "p", text: "For counterparties without an identifier, and for the whole warning list, which carries no UID, the name is the only common ground. Normalise both sides (case, accents, legal forms), look for names contained in one another, and put every candidate to a human review." },
          { type: "callout", tone: "warn", title: "A name match is not an identity", text: "For the warning list in particular, a candidate establishes nothing about your counterparty: compare domicile, address and website on FINMA’s detail page before drawing any conclusion. See the [guide to the warning list](@/guides/finma-warning-list/)." },
        ],
      },
      {
        id: "sqlite", title: "Example: SQLite on the command line",
        blocks: [
          { type: "p", text: "The archive’s `.sql` files each create a table with text columns and fill it. Put a `counterparties.csv` file in the folder of the unzipped archive:" },
          { type: "code", label: "counterparties.csv", language: "csv", code: COUNTERPARTIES_CSV },
          { type: "p", text: "The names and UIDs in this example are fictitious. Then load both tables and run the checks in `checks.sql`:" },
          { type: "code", label: "Terminal: load and check", language: "sh", code: SHELL_LOAD },
          { type: "code", label: "checks.sql", language: "sql", code: checksSql({ intro: "Your counterparties: a CSV file with the columns reference, name and uid", key: "UID reduced to \"CHE\" followed by nine digits, on both sides", q1: "1. Matches by UID, authorisations grouped", q2: "2. To review: no UID, or UID not in the list", q3: "3. Warning list candidates to review: one name contained in the other" }, "licence_type") },
          { type: "p", text: "The first query groups the authorisations of one company. The second lists the counterparties to review, because they have no UID or no match: they are not “unauthorised” counterparties. The third only produces candidates; SQLite’s `lower()` function only handles ASCII letters, so accents remain distinctive." },
          { type: "h3", text: "With the JSON" },
          { type: "p", text: "To find every authorisation of a UID with `jq`:" },
          { type: "code", label: "Terminal: jq", language: "sh", code: JQ_LOOKUP },
        ],
      },
      {
        id: "python", title: "Example: preparing names in Python",
        blocks: [
          { type: "p", text: "To compare names regardless of accents and legal forms, a simple normalisation is enough to produce sturdier candidates:" },
          { type: "code", label: "candidates.py", language: "python", code: candidatesPython({ forms: "Common legal forms, removed before comparing (illustrative list)", short: "name too short for a useful search" }) },
          { type: "p", text: "The list of legal forms is illustrative: adapt it to your counterparties. Every line printed remains a candidate to review." },
        ],
      },
      {
        id: "trace", title: "Keeping a record of every check",
        blocks: [
          { type: "p", text: "To be able to explain a result later, keep with it:" },
          { type: "list", items: [
            "the file version, which appears in the archive name and in `quality.json`;",
            "the `checksums.sha256` file and the result of its verification;",
            "the date of the check, the matches accepted and the decisions taken on candidates.",
          ] },
          { type: "code", label: "In the folder of the unzipped archive", language: "sh", code: CHECKSUMS },
          { type: "p", text: "The dates in `changelog_90d` are observation dates between two versions, not FINMA decision dates." },
        ],
      },
      {
        id: "mcp", title: "For a one-off question: kyc_check",
        blocks: [
          { type: "p", text: "The OpenSwissData MCP server offers the `kyc_check` tool without an account or key, within 100 calls per hour per IP address. It searches a name in the registry and in the warning list, ignoring case and accents, and returns the closest results with their total count. An empty answer is not a compliance certificate." },
          { type: "code", label: "Claude Code, or any HTTP client", language: "sh", code: MCP_CALL },
          { type: "p", text: "Buying the file does not open any paid MCP access, and new Pro subscriptions are closed for now. Details and other clients: [MCP server page](@/mcp/#install)." },
        ],
      },
      {
        id: "limites", title: "Limits",
        blocks: [
          { type: "list", items: [
            "The file follows FINMA’s list of UIDs for authorised companies. It covers neither the register for insurance intermediaries, nor SRO members, nor collective investment schemes: consult those sources directly.[^finma-autorises]",
            "Authorisation dates and detailed statuses are not in FINMA’s list: the corresponding fields stay empty.",
            "Matching by name produces false positives and can miss a variant: it remains a triage before review.",
            "A row in the file reflects FINMA’s list on the collection date; for any decision, the official source prevails.",
          ] },
        ],
      },
    ],
  },
};
