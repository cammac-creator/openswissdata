# Fiches publiques — référence du 25 septembre 2026

Les URLs existantes restent stables. Les fiches NOGA utilisent les mêmes correspondances sourcées que le MCP, depuis `classification_links.csv` et `classification_sources.csv`. Les identités documentées et les approximations sont distinguées ; deux approximations ne sont pas chaînées. Exemple : NOGA 18.11 → NACE 2.1 exact ; → NACE 2 approché ; aucun résultat ISIC déduit de deux approximations.

Les 1 845 lignes NOGA et leurs huit champs utilisés dans les pages ont été comparés à l’archive signée 2026.09.25 : zéro différence. Les anciennes tables de correspondance et les anciens libellés NACE ne sont plus lus par ces pages. Les exemples d’activités auparavant déduits de mots-clés sont retirés. L’accès anonyme à `cross_walk` ne donne pas accès aux outils de classification protégés.

Les fiches FINMA restent issues du fichier historique `web/src/data/finma.json`. Une publication quotidienne du produit téléchargeable ne les reconstruit pas avec de nouvelles lignes. Les pages et leurs métadonnées l’indiquent explicitement et renvoient à la FINMA pour vérifier le statut actuel. Ne pas interpréter la présence dans cette copie comme une autorisation actuelle. L’automatisation de la mise à jour de cet annuaire reste un chantier distinct, avec gestion des changements d’URL et des sorties de registre.

Les résultats des recherches NOGA et FINMA utilisent des nœuds DOM et `textContent` ; leurs liens sont limités aux chemins de fiches attendus. Une erreur HTTP est affichée comme une indisponibilité, sans conclure à une absence de résultat. Les données JSON-LD échappent `<` pour empêcher la fermeture d’une balise script par une donnée. Les textes juridiques conservent leur numéro de version ; aucune date de modification n’est inventée à chaque construction. Le contenu juridique lui-même reste à revoir.


## Parcours de l’annuaire FINMA — 26 septembre 2026

Les trois pages d’index proposent la recherche dans la copie historique, un échantillon CSV du produit publié et la fiche produit dans la langue courante. Leurs titres et descriptions mentionnent ce parcours Excel/CSV sans attribuer la fraîcheur du produit à l’annuaire. Aucun prix supplémentaire ni nouvelle promesse de couverture. Les CTA d’achat restent sur la fiche détaillée, avec ses conditions existantes.

Le contenu essentiel s’affiche dès le HTML, sans animation nécessaire. Sans JavaScript, les catégories et liens produit restent utilisables ; la recherche explique sa dépendance au script. La date et les volumes du produit ne sont pas recopiés dans l’index : consulter le catalogue sur la fiche produit, avec son état indisponible explicite.

Le constat Search Console du 25 juin au 22 septembre est conservé dans l’audit privé. Les effets de cette modification doivent être comparés sur quatre semaines, avec les mêmes pages, requêtes et types de recherche. Publication ne signifie pas nouvelle indexation ni amélioration de CTR. Les étapes commerciales échantillon/Checkout et leur attribution restent un chantier distinct.
