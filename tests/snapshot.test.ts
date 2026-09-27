import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { BACKUP_KEY, LATEST_KEY, restore, Snapshotter, type SnapshotStore } from '../server/snapshot';

/** Key Value en mémoire, comme Redis. */
function memoryStore(fail = false): SnapshotStore & { data: Map<string, Buffer>; writes: number } {
  const data = new Map<string, Buffer>();
  const store = {
    data,
    writes: 0,
    get: async (k: string) => {
      if (fail) throw new Error('injoignable');
      return data.get(k) ?? null;
    },
    set: async (k: string, v: Buffer) => {
      store.writes++;
      data.set(k, v);
    },
    close: async () => undefined,
  };
  return store;
}

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'rush-copie-test-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function freshDb(path: string) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); CREATE TABLE transactions (id TEXT, amount INTEGER)');
  return db;
}

describe('copie de la base dans le Key Value', () => {
  it('copie après une écriture, pas quand rien n’a changé, et restaure tout sur un disque vide', async () => {
    const store = memoryStore();
    const db = freshDb(join(tmp(), 'rush.db'));
    const snaps = new Snapshotter(db, store, { restored: 'empty' });

    db.prepare('INSERT INTO users VALUES (?, ?)').run('u1', 'lea@epfl.ch');
    db.prepare('INSERT INTO transactions VALUES (?, ?)').run('t1', 3000);
    expect(await snaps.saveIfChanged()).toBe(true);
    expect(await snaps.saveIfChanged()).toBe(false);
    expect(store.data.has(LATEST_KEY)).toBe(true);
    // La copie de secours est faite dès la première fois.
    expect(store.data.has(BACKUP_KEY)).toBe(true);

    // Nouveau serveur, disque vide : tout revient.
    const path = join(tmp(), 'data', 'rush.db');
    expect(await restore(store, path)).toBe('restored');
    const restored = new DatabaseSync(path);
    expect(restored.prepare('SELECT email FROM users').all()).toEqual([{ email: 'lea@epfl.ch' }]);
    expect(restored.prepare('SELECT SUM(amount) AS s FROM transactions').get()).toEqual({ s: 3000 });
  });

  it('garde une base déjà sur le disque et part d’une base vide sans copie', async () => {
    const dir = tmp();
    const existing = join(dir, 'rush.db');
    writeFileSync(existing, 'déjà là');
    expect(await restore(memoryStore(), existing)).toBe('kept');
    expect(await restore(memoryStore(), join(dir, 'autre.db'))).toBe('empty');
  });

  it('se rabat sur la copie de secours si la dernière est abîmée', async () => {
    const store = memoryStore();
    const db = freshDb(join(tmp(), 'rush.db'));
    db.prepare('INSERT INTO users VALUES (?, ?)').run('u1', 'lea@epfl.ch');
    await new Snapshotter(db, store, { restored: 'empty' }).save();
    store.data.set(LATEST_KEY, gzipSync(Buffer.from('pas une base SQLite')));
    const path = join(tmp(), 'rush.db');
    expect(await restore(store, path)).toBe('backup');
    expect(new DatabaseSync(path).prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
  });

  it('n’écrase jamais la copie si elle n’a pas pu être lue au démarrage', async () => {
    const store = memoryStore(true);
    const path = join(tmp(), 'rush.db');
    expect(await restore(store, path)).toBe('error');
    const db = freshDb(path);
    const snaps = new Snapshotter(db, store, { restored: 'error' });
    db.prepare('INSERT INTO users VALUES (?, ?)').run('u2', 'vide@epfl.ch');
    await snaps.save();
    expect(await snaps.saveIfChanged()).toBe(false);
    expect(store.writes).toBe(0);
  });
});
