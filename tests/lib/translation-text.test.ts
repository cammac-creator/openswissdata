import {describe,it,expect} from 'vitest';
import {protectTerms} from '../../src/lib/translation-text.js';
describe('Précision des termes traduits',()=>{
 it('préserve les sigles, identifiants et montants malgré un changement d’ordre',()=>{const p=protectTerms('LEI 549300ABC123 and CHF 299.50');expect(p.restore('Le prix est ZXQ2XZ ZXQ3XZ et le ZXQ0XZ est ZXQ1XZ')).toBe('Le prix est CHF 299.50 et le LEI est 549300ABC123')});
 it('isole les sigles des mots composés allemands sans capturer le tiret',()=>{const p=protectTerms('LEI-Identifikatoren und CSV-Datei');expect(p.text).toBe('ZXQ0XZ Identifikatoren und ZXQ1XZ Datei');expect(p.restore('identifiants ZXQ0XZ et fichier ZXQ1XZ')).toBe('identifiants LEI et fichier CSV')});
 it('refuse une traduction qui perd ou duplique un identifiant',()=>{const p=protectTerms('LEI and CSV');expect(()=>p.restore('IEL et ZXQ1XZ')).toThrow('term_not_preserved');expect(()=>p.restore('ZXQ0XZ ZXQ0XZ ZXQ1XZ')).toThrow('term_not_preserved')});
 it('ne permet pas à un marqueur fourni dans un message de changer un montant',()=>{expect(()=>protectTerms('Use ZXQ0XZ instead')).toThrow('reserved_marker')});
});
