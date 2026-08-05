/**
 * Local SQLite persistence for non-secret application state.
 * Secrets (Freshdesk and AI provider API keys) must never be written here.
 *
 * Uses Node's built-in node:sqlite (DatabaseSync) to avoid native addon rebuilds.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { ChatHistoryMessage, RecentTicket } from '@fth/protocol';

import { MIGRATIONS } from './migrations.js';

export type AppDatabase = {
  db: DatabaseSync;
  getSetting: (key: string) => string | null;
  setSetting: (key: string, value: string) => void;
  deleteSetting: (key: string) => void;
  listRecentTickets: (limit?: number) => RecentTicket[];
  upsertRecentTicket: (ticket: RecentTicket) => void;
  getContextRevision: (ticketKey: string) => number;
  bumpContextRevision: (ticketKey: string) => number;
  appendChatMessage: (message: ChatHistoryMessage) => void;
  listChatMessages: (ticketKey: string, limit?: number) => ChatHistoryMessage[];
  clearChatMessages: (ticketKey: string) => number;
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
    deleteSetting(key) {
      db.prepare('DELETE FROM settings WHERE key = ?').run(key);
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
      // Atomic bump binds each AI request to the exact sanitizer preview the user reviewed.
      db.prepare(
        `INSERT INTO context_revisions (ticket_key, revision, updated_at)
         VALUES (?, 1, ?)
         ON CONFLICT(ticket_key) DO UPDATE SET
           revision = revision + 1,
           updated_at = excluded.updated_at`,
      ).run(ticketKey, new Date().toISOString());
      return this.getContextRevision(ticketKey);
    },
    appendChatMessage(message) {
      db.prepare(
        `INSERT INTO chat_messages
           (id, ticket_key, role, text, provider_id, model_id, connection_kind, cli_adapter_id,
            context_revision, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        message.id,
        message.ticketKey,
        message.role,
        message.text,
        message.providerId,
        message.modelId,
        message.connectionKind ?? 'api-key',
        message.cliAdapterId ?? null,
        message.contextRevision,
        message.createdAt,
      );
    },
    listChatMessages(ticketKey, limit = 200) {
      const safeLimit = Math.min(Math.max(limit, 1), 500);
      const rows = db
        .prepare(
          `SELECT id, ticket_key, role, text, provider_id, model_id, connection_kind, cli_adapter_id,
                  context_revision, created_at
         FROM (
           SELECT rowid AS message_order, id, ticket_key, role, text,
                  provider_id, model_id, connection_kind, cli_adapter_id,
                  context_revision, created_at
           FROM chat_messages WHERE ticket_key = ?
           ORDER BY rowid DESC LIMIT ?
         ) ORDER BY message_order ASC`,
        )
        .all(ticketKey, safeLimit) as Array<{
        id: string;
        ticket_key: string;
        role: 'user' | 'assistant';
        text: string;
        provider_id: ChatHistoryMessage['providerId'];
        model_id: string;
        connection_kind: ChatHistoryMessage['connectionKind'] | null;
        cli_adapter_id: ChatHistoryMessage['cliAdapterId'] | null;
        context_revision: number;
        created_at: string;
      }>;
      return rows.map((row) => ({
        id: row.id,
        ticketKey: row.ticket_key,
        role: row.role,
        text: row.text,
        providerId: row.provider_id,
        modelId: row.model_id,
        connectionKind: row.connection_kind ?? 'api-key',
        ...(row.cli_adapter_id ? { cliAdapterId: row.cli_adapter_id } : {}),
        contextRevision: row.context_revision,
        createdAt: row.created_at,
      }));
    },
    clearChatMessages(ticketKey) {
      return Number(
        db.prepare('DELETE FROM chat_messages WHERE ticket_key = ?').run(ticketKey).changes,
      );
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
