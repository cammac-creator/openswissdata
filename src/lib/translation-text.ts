/** Les identifiants, sigles et nombres restent identiques à la source. */
export function protectTerms(text:string) {
  const terms:string[] = [];
  // Le marqueur est réservé : on refuse de le confondre avec un texte fourni.
  if (/ZXQ\d+XZ/i.test(text)) throw new Error('reserved_marker');
  const protectedText = text.replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+|\b(?=[A-Z0-9_-]*[A-Z])[A-Z0-9][A-Z0-9_-]{1,39}\b|\d+(?:[.,’']\d+)*/g, term => `ZXQ${terms.push(term)-1}XZ`);
  return { text:protectedText, restore(translated:string) {
    let result=translated;
    for (let index=0;index<terms.length;index++) {
      const pattern=new RegExp(`ZXQ\\s*${index}\\s*XZ`,'gi');
      const matches=result.match(pattern);
      if (matches?.length!==1) throw new Error('term_not_preserved');
      result=result.replace(pattern,()=>terms[index]);
    }
    if (/ZXQ\d+XZ/i.test(result)) throw new Error('unexpected_marker');
    return result;
  } };
}
