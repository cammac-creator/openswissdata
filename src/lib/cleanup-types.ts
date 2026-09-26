export const CLEANUP_CATEGORIES = ['magic_links', 'sessions', 'download_tokens', 'mcp_oauth_codes', 'request_log', 'events', 'download_activity', 'delivery_message_references', 'bronze_dashboard', 'bronze_financial', 'cleanup_proof'] as const;
export type CleanupEntry = {
  name: typeof CLEANUP_CATEGORIES[number];
  deleted: number;
  status: 'ok' | 'not_applicable' | 'error';
  unit: 'rows' | 'references' | 'folders';
  error?: 'database_error' | 'storage_error' | 'proof_error' | 'timestamp_format';
};
export type CleanupResult = {
  ok: boolean;
  entries: CleanupEntry[];
  totalDeleted: number;
};
export type CleanupProof = CleanupResult & { checked_at: number };
