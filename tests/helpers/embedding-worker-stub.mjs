// Faux processus du modèle : même protocole que src/lib/embedding-worker.ts, sans aucun poids.
process.on('message', async ({ id, text }) => {
  if (text === 'plantage') process.exit(1);
  if (text.startsWith('lent')) await new Promise(r => setTimeout(r, 300));
  if (text === 'silence') return;
  const vector = new Array(768).fill(0);
  vector[text.length % 768] = 0.1 + text.length / 1000;
  process.send({ id, vector });
});
process.on('disconnect', () => process.exit(0));
