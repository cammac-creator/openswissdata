import { dirname, join, resolve } from 'node:path';

export function resolveDatabasePath(path = process.env.DATABASE_PATH ?? './data/openswissdata.sqlite'): string {
  return path === ':memory:' ? path : resolve(path);
}
export function bronzePath(compartment: 'dashboard' | 'financial', database: string): string {
  if (!database || database === ':memory:') throw new Error('database_path_required');
  return join(dirname(resolveDatabasePath(database)), 'bronze', compartment);
}
