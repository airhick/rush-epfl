import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { Redis } from 'ioredis';

/*
 * Copie de la base hors du serveur. Sur l'offre gratuite de Render, le disque
 * repart de zéro à chaque veille et à chaque déploiement : on garde donc une
 * copie compressée de toute la base SQLite (comptes, sessions, soldes,
 * commandes, messages, trajets, abonnements aux notifications…) dans un
 * Key Value Render (Redis), refaite quelques secondes après chaque écriture et
 * à l'arrêt du serveur, puis restaurée au démarrage avant d'ouvrir la base.
 */

/** Ce que le démarrage a trouvé, pour le serveur qui démarre ensuite. */
export const boot: { store: SnapshotStore | null; restored: RestoreResult } = { store: null, restored: 'kept' };

export const LATEST_KEY = 'rush:db:latest';
export const BACKUP_KEY = 'rush:db:backup';

export interface SnapshotStore {
  get(key: string): Promise<Buffer | null>;
  set(key: string, value: Buffer): Promise<void>;
  close(): Promise<void>;
}

export function redisStore(url: string): SnapshotStore {
  const redis = new Redis(url, { connectTimeout: 8000, maxRetriesPerRequest: 3, lazyConnect: false });
  let lastError = 0;
  redis.on('error', (err) => {
    // Une coupure réseau se répète en boucle : un message par minute suffit.
    if (Date.now() - lastError > 60_000) console.warn(`[copie] Key Value injoignable : ${err.message}`);
    lastError = Date.now();
  });
  return {
    get: (key) => redis.getBuffer(key),
    set: async (key, value) => {
      await redis.set(key, value);
    },
    close: async () => {
      await redis.quit().catch(() => undefined);
    },
  };
}

/** La copie s'ouvre et SQLite la trouve saine. */
function check(path: string): boolean {
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    const ok = (db.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check === 'ok';
    db.close();
    return ok;
  } catch {
    return false;
  }
}

export type RestoreResult = 'restored' | 'backup' | 'empty' | 'kept' | 'error';

/**
 * Au démarrage, avant d'ouvrir la base : si le disque est vide, on repart de la
 * dernière copie (ou de la copie de secours si la dernière est abîmée).
 * Une base déjà présente sur le disque (redémarrage du même serveur) est gardée.
 */
export async function restore(store: SnapshotStore, dbPath: string): Promise<RestoreResult> {
  if (dbPath === ':memory:') return 'kept';
  if (existsSync(dbPath) && statSync(dbPath).size > 0) return 'kept';
  mkdirSync(dirname(dbPath), { recursive: true });
  for (const key of [LATEST_KEY, BACKUP_KEY]) {
    let packed: Buffer | null;
    try {
      packed = await store.get(key);
    } catch (err) {
      console.error(`[copie] lecture impossible (${(err as Error).message}) : démarrage sans restaurer.`);
      return 'error';
    }
    if (!packed) continue;
    const tmp = join(dirname(dbPath), `.restore-${randomUUID()}.db`);
    try {
      writeFileSync(tmp, gunzipSync(packed));
      if (!check(tmp)) throw new Error('copie abîmée');
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
      renameSync(tmp, dbPath);
      return key === LATEST_KEY ? 'restored' : 'backup';
    } catch (err) {
      console.error(`[copie] ${key} inutilisable : ${(err as Error).message}`);
      rmSync(tmp, { force: true });
    }
  }
  return 'empty';
}

/**
 * Surveille la base et en pousse une copie compressée dès qu'elle a changé,
 * au plus une fois toutes les `everyMs`. La copie de secours est rafraîchie
 * moins souvent : si la dernière copie venait à être abîmée, on perd au pire
 * quelques minutes.
 */
export class Snapshotter {
  private savedChanges = -1;
  private lastBackup = 0;
  private saving: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** Restauration ratée (Key Value injoignable) : ne jamais écraser une bonne copie par une base vide. */
  private blocked: boolean;

  constructor(
    private db: DatabaseSync,
    private store: SnapshotStore,
    private opts: { everyMs?: number; backupEveryMs?: number; restored: RestoreResult },
  ) {
    this.blocked = opts.restored === 'error';
    if (this.blocked) console.error('[copie] copies suspendues jusqu’au prochain démarrage réussi, pour ne pas écraser la dernière copie.');
  }

  private changes(): number {
    return (this.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  }

  start() {
    this.timer = setInterval(() => void this.saveIfChanged(), this.opts.everyMs ?? 3000);
    this.timer.unref();
    return this;
  }

  async saveIfChanged(): Promise<boolean> {
    if (this.blocked || this.changes() === this.savedChanges) return false;
    await this.save();
    return true;
  }

  async save(): Promise<void> {
    if (this.blocked) return;
    if (this.saving) return this.saving;
    this.saving = (async () => {
      const changes = this.changes();
      const tmp = join(tmpdir(), `rush-copie-${randomUUID()}.db`);
      try {
        // VACUUM INTO : copie cohérente et compacte, même pendant les écritures en WAL.
        this.db.exec(`VACUUM INTO '${tmp}'`);
        const packed = gzipSync(readFileSync(tmp));
        await this.store.set(LATEST_KEY, packed);
        if (Date.now() - this.lastBackup > (this.opts.backupEveryMs ?? 30 * 60_000)) {
          await this.store.set(BACKUP_KEY, packed);
          this.lastBackup = Date.now();
        }
        this.savedChanges = changes;
      } catch (err) {
        console.error(`[copie] échec : ${(err as Error).message}`);
      } finally {
        rmSync(tmp, { force: true });
        this.saving = null;
      }
    })();
    return this.saving;
  }

  /** À l'arrêt du serveur : dernière copie si quelque chose a changé. */
  async flush() {
    if (this.timer) clearInterval(this.timer);
    await this.saving;
    await this.saveIfChanged();
  }
}
