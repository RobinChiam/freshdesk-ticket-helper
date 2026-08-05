/**
 * Ordered SQLite migrations for non-secret local state.
 * Never add columns intended for API keys or other credentials.
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
  {
    id: 2,
    name: 'persistent_chat_history',
    sql: `
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY NOT NULL,
        ticket_key TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        text TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        context_revision INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_ticket_created
        ON chat_messages (ticket_key, created_at DESC);
    `,
  },
  {
    id: 3,
    name: 'chat_connection_metadata',
    sql: `
      -- Connection transport metadata for reproducibility; never store OAuth tokens/session IDs.
      ALTER TABLE chat_messages ADD COLUMN connection_kind TEXT NOT NULL DEFAULT 'api-key';
      ALTER TABLE chat_messages ADD COLUMN cli_adapter_id TEXT;
    `,
  },
];
