import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from './env';

const SCHEMA = /* sql */ `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    first_name  TEXT NOT NULL,
    last_name   TEXT NOT NULL,
    section     TEXT,
    hue         INTEGER NOT NULL,
    onboarded   INTEGER NOT NULL DEFAULT 0,
    is_bot      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );

  -- Mots de passe à part : jamais lus avec un SELECT * sur users.
  CREATE TABLE IF NOT EXISTS credentials (
    user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash  TEXT NOT NULL,
    updated_at     INTEGER NOT NULL
  );
  -- Ancienne connexion par code e-mail.
  DROP TABLE IF EXISTS login_codes;

  -- Comptes reliés à une connexion externe (EPFL / Entra ID), par identifiant immuable.
  CREATE TABLE IF NOT EXISTS identities (
    provider    TEXT NOT NULL,
    subject     TEXT NOT NULL,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sciper      TEXT,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (provider, subject)
  );
  CREATE INDEX IF NOT EXISTS identities_user ON identities(user_id);

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id                   TEXT PRIMARY KEY,
    requester_id         TEXT NOT NULL REFERENCES users(id),
    courier_id           TEXT REFERENCES users(id),
    spot_id              TEXT NOT NULL,
    items_json           TEXT NOT NULL,
    items_cents          INTEGER NOT NULL,
    margin_cents         INTEGER NOT NULL,
    tip_cents            INTEGER NOT NULL,
    suggested_tip_cents  INTEGER NOT NULL,
    hold_cents           INTEGER NOT NULL,
    actual_items_cents   INTEGER,
    dropoff_lat          REAL NOT NULL,
    dropoff_lng          REAL NOT NULL,
    dropoff_label        TEXT NOT NULL,
    dropoff_note         TEXT NOT NULL DEFAULT '',
    status               TEXT NOT NULL,
    courier_lat          REAL,
    courier_lng          REAL,
    courier_loc_at       TEXT,
    created_at           TEXT NOT NULL,
    accepted_at          TEXT,
    picked_up_at         TEXT,
    delivered_at         TEXT,
    completed_at         TEXT,
    cancelled_at         TEXT,
    cancel_reason        TEXT,
    -- Note attribuée par le demandeur au rusher, et inversement.
    rating_for_courier   INTEGER,
    rating_for_requester INTEGER
  );
  CREATE INDEX IF NOT EXISTS orders_status    ON orders(status);
  CREATE INDEX IF NOT EXISTS orders_requester ON orders(requester_id);
  CREATE INDEX IF NOT EXISTS orders_courier   ON orders(courier_id);

  -- Registre append-only : le solde est toujours la somme des écritures.
  CREATE TABLE IF NOT EXISTS transactions (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id),
    kind          TEXT NOT NULL,
    amount_cents  INTEGER NOT NULL,
    label         TEXT NOT NULL,
    order_id      TEXT,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tx_user ON transactions(user_id, created_at);

  -- Recharges Stripe, une ligne par session de paiement : un webhook rejoué ne crédite pas deux fois.
  CREATE TABLE IF NOT EXISTS topups (
    session_id      TEXT PRIMARY KEY,
    user_id         TEXT REFERENCES users(id),
    amount_cents    INTEGER NOT NULL,
    currency        TEXT NOT NULL,
    email           TEXT,
    payment_intent  TEXT,
    -- credited : ajouté au solde ; unmatched : aucun compte trouvé, à traiter par l'équipe.
    status          TEXT NOT NULL,
    created_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id),
    amount_cents  INTEGER NOT NULL,
    twint_phone   TEXT NOT NULL,
    status        TEXT NOT NULL,
    note          TEXT,
    created_at    TEXT NOT NULL,
    processed_at  TEXT,
    processed_by  TEXT REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS withdrawals_status ON withdrawals(status, created_at);
  CREATE INDEX IF NOT EXISTS withdrawals_user   ON withdrawals(user_id, created_at);

  CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    order_id    TEXT NOT NULL REFERENCES orders(id),
    sender_id   TEXT,
    body        TEXT NOT NULL,
    kind        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_order ON messages(order_id, created_at);

  CREATE TABLE IF NOT EXISTS reads (
    order_id      TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    last_read_at  TEXT NOT NULL,
    PRIMARY KEY (order_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS presence (
    user_id     TEXT PRIMARY KEY REFERENCES users(id),
    available   INTEGER NOT NULL,
    spot_id     TEXT,
    dest_lat    REAL,
    dest_lng    REAL,
    dest_label  TEXT,
    updated_at  TEXT NOT NULL,
    -- Trajet déclaré : { stops, path } en JSON.
    route_json  TEXT
  );
`;

function open(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  // Bases créées avant le trajet déclaré.
  const presenceCols = db.prepare('PRAGMA table_info(presence)').all() as { name: string }[];
  if (!presenceCols.some((c) => c.name === 'route_json')) db.exec('ALTER TABLE presence ADD COLUMN route_json TEXT');
  return db;
}

export const db = open(env.dbPath);

type Param = string | number | null;

export function one<T>(sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: Param[]) {
  return db.prepare(sql).run(...params);
}

let depth = 0;

/**
 * Exécute `fn` dans une transaction. DatabaseSync est synchrone : aucune
 * autre requête ne peut s'intercaler, ce qui rend les opérations sur le
 * solde atomiques. Les appels imbriqués réutilisent la transaction courante.
 */
export function transaction<T>(fn: () => T): T {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}

export const nowIso = () => new Date().toISOString();
