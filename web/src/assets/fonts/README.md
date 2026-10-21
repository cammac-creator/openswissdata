# Polices locales

Le site sert ses polices depuis son propre domaine. Aucun appel à Google Fonts n’est requis dans le navigateur. Les fichiers WOFF2 sont des copies intactes des distributions officielles ; Astro ajoute leur empreinte au nom servi et le serveur leur applique son cache immuable.

- **Geist et Geist Mono** : Vercel, version 1.7.2, commit `a73329da8fc62afc917f796555202e4997f79b7c`, variables de 100 à 900.
- Caveat, Fredoka et Inter ne servaient qu'à une page privée retirée du site le 21.10.2026 : fichiers et licences retirés avec elle. Les sources et empreintes exactes des polices restantes figurent dans `provenance.json`.
- **Licences** : SIL Open Font License 1.1, copies originales distribuées dans `web/public/fonts/licenses/`. Les fichiers restent inchangés ; aucune police dérivée n’est créée.

Les gabarits importent `styles/fonts-geist.css`. Ne pas ajouter de `<link>` distant pour une police. La politique de sécurité n’autorise que les polices du site (et les URI de données).

Une mise à jour est volontaire : conserver d’abord les réponses officielles dans un bronze daté et immuable, remplacer les ressources et leurs licences depuis ce bronze, recalculer `provenance.json`, puis vérifier les accents français/allemands, le mobile et les requêtes réseau. Le build ne télécharge pas de police.
