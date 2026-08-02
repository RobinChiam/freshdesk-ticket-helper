/**
 * Ordered SQLite migrations for non-secret local state.
 * Never add columns intended for API keys or device tokens.
 */
export type Migration = {
  id: number;
  name: string;
  sql: string;
};

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recent_tickets (
        ticket_key TEXT PRIMARY KEY NOT NULL,
        ticket_id INTEGER NOT NULL,
        subject TEXT NOT NULL,
        opened_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_recent_tickets_opened_at
        ON recent_tickets (opened_at DESC);

      CREATE TABLE IF NOT EXISTS context_revisions (
        ticket_key TEXT PRIMARY KEY NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      -- Extension point for a future assigned/open ticket browser cache.
      CREATE TABLE IF NOT EXISTS ticket_browser_cache (
        ticket_key TEXT PRIMARY KEY NOT NULL,
        payload_json TEXT NOT NULL,
        cached_at TEXT NOT NULL
      );
    `,
  },
];
