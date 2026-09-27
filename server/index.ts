import { env } from './env';
import { boot, redisStore, restore } from './snapshot';

/*
 * Démarrage en deux temps : d'abord récupérer la copie de la base (si un Key
 * Value est configuré), ensuite seulement ouvrir la base et lancer le serveur.
 */
if (env.snapshotUrl) {
  boot.store = redisStore(env.snapshotUrl);
  boot.restored = await restore(boot.store, env.dbPath);
  const messages = {
    restored: 'base restaurée depuis la dernière copie',
    backup: 'dernière copie abîmée : base restaurée depuis la copie de secours',
    empty: 'aucune copie encore : nouvelle base',
    kept: 'base déjà sur le disque, gardée',
    error: 'Key Value injoignable : nouvelle base, copies suspendues',
  };
  console.log(`  Copie de la base : ${messages[boot.restored]}.`);
}

await import('./main');
