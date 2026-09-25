# Lecteur TypeScript historique de fichiers

Prototype conservé pour référence, non publié et marqué `private` pour empêcher une publication accidentelle sous le nom du SDK HTTP. Pour l’API distante maintenue, voir [`sdks/sdk-ts`](../../sdks/sdk-ts/README.md).

Ce lecteur a été écrit pour le schéma de fichiers d’avril 2026. Ses correspondances larges `noga_2008` / `noga_2025` ne représentent pas le schéma par paires de septembre 2026 : ne pas utiliser `loadCrossWalks` pour les archives actuelles. La compatibilité des autres lecteurs doit être validée séparément. Aucune promesse de support des archives actuelles.

Développement local uniquement dans ce dossier : `npm install`, `npm test`, `npm run build`. Les exports peuvent être importés depuis `./dist/index.js` après compilation ; ne pas utiliser `npm install @openswissdata/sdk` pour obtenir ce prototype.
