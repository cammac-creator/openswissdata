/** JSON intégré à une balise script : empêcher la fermeture de la balise par une donnée. */
export function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
