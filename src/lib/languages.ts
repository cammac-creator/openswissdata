/** Langues acceptées par le moteur M2M100 ; les libellés restent en français. */
export const LANGUAGE_CODES = 'fr en de it es pt nl ar zh ja ko ru uk pl ro cs sk sv da no fi el tr hi bn ta vi th id ms he fa ur sw af sq am ast az ba be bg br bs ca ceb cy et ff fy ga gd gl gu ha hr ht hu hy ig ilo is jv ka kk km kn lb lg ln lo lt lv mg mk ml mn mr my ne ns oc or pa ps sd si sl so sr ss su tl tn uz wo xh yi yo zu'.split(' ');
const labels:Record<string,string> = {ba:'bachkir',ff:'peul',ns:'sotho du Nord',ss:'swati'};
const names = new Intl.DisplayNames(['fr'], { type: 'language' });
export const languageName = (code: string | null | undefined) => code && LANGUAGE_CODES.includes(code) ? labels[code] ?? names.of(code)! : 'À confirmer';
export const isLanguage = (code: unknown): code is string => typeof code === 'string' && LANGUAGE_CODES.includes(code);
