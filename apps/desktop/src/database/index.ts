/**
 * Local SQLite persistence for non-secret application state.
 * Secrets (API keys, device tokens) must never be written here.
 *
 * Uses Node's built-in node:sqlite (DatabaseSync) to avoid native addon rebuilds.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { RecentTicket } from '@fth/protocol';

import { MIGRATIONS } from './migrations.js';

export type AppDatabase = {
  db: DatabaseSync;
  getSetting: (key: string) => string | null;
  setSetting: (key: string, value: string) => void;
  listRecentTickets: (limit?: number) => RecentTicket[];
  upsertRecentTicket: (ticket: RecentTicket) => void;
  getContextRevision: (ticketKey: string) => number;
  bumpContextRevision: (ticketKey: string) => number;
  close: () => void;
};

/** Open (or create) the app database and apply pending migrations in a transaction. */
export function openAppDatabase(filePath: string): AppDatabase {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);

  return {
    db,
    getSetting(key) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
        { value: string } | undefined;
      return row?.value ?? null;
    },
    setSetting(key, value) {
      db.prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(key, value, new Date().toISOString());
    },
    listRecentTickets(limit = 20) {
      const rows = db
        .prepare(
          `SELECT ticket_key, ticket_id, subject, opened_at
           FROM recent_tickets
           ORDER BY opened_at DESC
           LIMIT ?`,
        )
        .all(limit) as Array<{
        ticket_key: string;
        ticket_id: number;
        subject: string;
        opened_at: string;
      }>;
      return rows.map((row) => ({
        ticketKey: row.ticket_key,
        ticketId: row.ticket_id,
        subject: row.subject,
        openedAt: row.opened_at,
      }));
    },
    upsertRecentTicket(ticket) {
      db.prepare(
        `INSERT INTO recent_tickets (ticket_key, ticket_id, subject, opened_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(ticket_key) DO UPDATE SET
           subject = excluded.subject,
           opened_at = excluded.opened_at`,
      ).run(ticket.ticketKey, ticket.ticketId, ticket.subject, ticket.openedAt);
    },
    getContextRevision(ticketKey) {
      const row = db
        .prepare('SELECT revision FROM context_revisions WHERE ticket_key = ?')
        .get(ticketKey) as { revision: number } | undefined;
      return row?.revision ?? 0;
    },
    bumpContextRevision(ticketKey) {
      // Atomic bump so each sanitizer/WSS sync gets a monotonically increasing revision.
      db.prepare(
        `INSERT INTO context_revisions (ticket_key, revision, updated_at)
         VALUES (?, 1, ?)
         ON CONFLICT(ticket_key) DO UPDATE SET
           revision = revision + 1,
           updated_at = excluded.updated_at`,
      ).run(ticketKey, new Date().toISOString());
      return this.getContextRevision(ticketKey);
    },
    close() {
      db.close();
    },
  };
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: number }>).map(
      (row) => row.id,
    ),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) {
      continue;
    }
    // Each migration is transactional so a failure leaves schema consistent.
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        migration.id,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
