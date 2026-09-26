export const EVENT_KINDS = ['api_request', 'custom', 'conversion'] as const;
type EventKind = typeof EVENT_KINDS[number];

export type TrackArgs = {
  kind: EventKind;
  origin: 'server' | 'client';
  name?: string | null;
  status?: number | null;
  duration_ms?: number | null;
  customer_id?: number | null;
  visitor_hash?: string | null;
  country?: string | null;
  referer?: string | null;
  ua_class?: string | null;
  meta_json?: string | null;
};
