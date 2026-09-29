/** Tarifs : le serveur renvoie ici ?checkout=closed quand une souscription fermée est demandée. */
const banner = document.querySelector<HTMLElement>('[data-closed-banner]');
if (banner && new URLSearchParams(window.location.search).get('checkout') === 'closed') banner.hidden = false;

export {};
