// Copie de sûreté de l’or : déléguer au serveur pour chiffrer, relire et restaurer.
// Les identifiants des clients et la base ne transitent pas dans le runner.
if (process.argv.includes("--dry-run")) {
 console.log("Sauvegarde prévue : snapshot SQLite, chiffrement AES-256-GCM, R2 existant et restauration de contrôle.");
} else {
 const base=(process.env.BASE_URL ?? "https://www.openswissdata.com").replace(/\/$/,"");
 const secret=process.env.ADMIN_SECRET;
 if (!secret) throw new Error("ADMIN_SECRET manquant");
 const response=await fetch(`${base}/api/admin/backup-to-r2`,{method:"POST",headers:{"x-admin-secret":secret},signal:AbortSignal.timeout(240000)});
 if (!response.ok) throw new Error(`Sauvegarde : HTTP ${response.status}`);
 const proof=await response.json();
 if (!proof.encrypted || proof.restore_check!=="ok") throw new Error("Preuve de restauration absente");
 console.log(JSON.stringify(proof));
}
export {};
