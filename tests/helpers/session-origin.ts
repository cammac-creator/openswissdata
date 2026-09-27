import {beforeEach, afterEach, vi} from 'vitest';

// Contexte HTTPS des fixtures de compte ; aucune variable réelle n’est nécessaire.
beforeEach(() => { vi.stubEnv('BASE_URL', 'https://www.openswissdata.com'); });
afterEach(() => { vi.unstubAllEnvs(); });
