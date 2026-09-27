import { all, one, run, transaction } from '../db';
import { HttpError } from '../http';
import { sendTo } from '../realtime';
import { record } from './ledger';
import { balanceOf, createUser, getUser, isAdmin, isTestUser, type UserRow } from './users';
import { animateBots, fundBots, postBotRequest } from '../demo/bots';

/*
 * Mode test : l'équipe Rush teste le vrai parcours (recharge, demande, suivi,
 * livraison, retrait) avec de l'argent fictif. Chaque membre a deux comptes
 * de test (demandeur, rusher) ; les comptes de test ne voient que des
 * commandes de test, les vrais comptes ne les voient jamais, et un paiement
 * de l'environnement de test Stripe ne crédite qu'un compte de test.
 * Des rushers de test simulés peuvent livrer tout seuls pour dérouler le
 * parcours sans deuxième téléphone.
 */

export type TestRole = 'buyer' | 'rusher';

export const TEST_CREDIT_CENTS = 2000;
/** Assez pour tester, pas de quoi faire croire à un vrai solde. */
const TEST_BALANCE_MAX_CENTS = 50_000;

const TEST_BOTS = [
  ['Tessa', 'Rusher-test', 'SV'],
  ['Théo', 'Rusher-test', 'IN'],
  ['Zoé', 'Rusher-test', 'ME'],
] as const;

/** Rushers de test simulés, créés au premier besoin. */
export function testBots(): UserRow[] {
  const existing = all<UserRow>('SELECT * FROM users WHERE is_bot = 1 AND is_test = 1');
  if (existing.length >= TEST_BOTS.length) return existing;
  return TEST_BOTS.map(([first, last, section]) => {
    const email = `${first.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}.rusher-test@test.invalid`;
    return existing.find((b) => b.email === email) ?? createUser(email, { first, last, section, bot: true, test: true });
  });
}

/** Le compte de test (demandeur ou rusher) d'un membre de l'équipe, créé au premier passage. */
export function testAccount(ownerId: string, role: TestRole): UserRow {
  const owner = getUser(ownerId);
  if (!owner || !isAdmin(owner)) throw new HttpError(403, 'Réservé à l’équipe Rush.');
  if (owner.is_test) throw new HttpError(409, 'Tu es déjà en mode test.');
  return transaction(() => {
    const link = one<{ user_id: string }>('SELECT user_id FROM test_accounts WHERE owner_id = ? AND role = ?', ownerId, role);
    if (link) return getUser(link.user_id)!;
    const user = createUser(`test-${role}-${ownerId.slice(0, 8)}@test.invalid`, {
      first: owner.first_name,
      last: role === 'buyer' ? 'Test' : 'Rusher-test',
      section: owner.section ?? undefined,
      test: true,
    });
    run('INSERT INTO test_accounts (owner_id, role, user_id) VALUES (?, ?, ?)', ownerId, role, user.id);
    return user;
  });
}

/** Le membre de l'équipe derrière un compte de test. */
export function ownerOf(testUserId: string): string | null {
  return one<{ owner_id: string }>('SELECT owner_id FROM test_accounts WHERE user_id = ?', testUserId)?.owner_id ?? null;
}

function requireTestAccount(userId: string) {
  if (!isTestUser(userId) || !ownerOf(userId)) throw new HttpError(403, 'Seulement en mode test.');
}

/** Solde fictif, sans passer par Stripe. */
export function creditTest(userId: string, cents = TEST_CREDIT_CENTS) {
  requireTestAccount(userId);
  if (balanceOf(userId) + cents > TEST_BALANCE_MAX_CENTS) throw new HttpError(409, 'Solde de test déjà bien rempli.');
  record(userId, 'topup', cents, 'Recharge · Solde fictif (mode test)');
  sendTo(userId, { type: 'wallet.updated' });
}

/** Rusher de test automatique : réglage commun aux deux comptes de test du membre. */
export function setAutoRusher(userId: string, on: boolean) {
  requireTestAccount(userId);
  run('UPDATE test_accounts SET auto_rusher = ? WHERE owner_id = ?', on ? 1 : 0, ownerOf(userId));
}

/** Une demande de test publiée par un rusher simulé : de quoi tester le côté rusher seul. */
export function sampleOrder(userId: string) {
  requireTestAccount(userId);
  const bots = testBots();
  fundBots(bots);
  const order = postBotRequest(bots);
  if (!order) throw new HttpError(409, 'Aucun spot n’est ouvert en ce moment : réessaie pendant les heures d’ouverture.');
  return order;
}

/** Repart d'un monde test vide : commandes, messages, soldes, retraits et recharges de test effacés. */
export function resetTest(userId: string) {
  requireTestAccount(userId);
  transaction(() => {
    const testUsers = 'SELECT id FROM users WHERE is_test = 1';
    const testOrders = `SELECT id FROM orders WHERE requester_id IN (${testUsers}) OR courier_id IN (${testUsers})`;
    run(`DELETE FROM reads WHERE order_id IN (${testOrders})`);
    run(`DELETE FROM messages WHERE order_id IN (${testOrders})`);
    run(`DELETE FROM transactions WHERE user_id IN (${testUsers})`);
    run(`DELETE FROM orders WHERE id IN (${testOrders})`);
    run(`DELETE FROM withdrawals WHERE user_id IN (${testUsers})`);
    run(`DELETE FROM topups WHERE user_id IN (${testUsers})`);
    run(`DELETE FROM presence WHERE user_id IN (${testUsers})`);
  });
  for (const u of all<{ id: string }>('SELECT id FROM users WHERE is_test = 1 AND is_bot = 0')) sendTo(u.id, { type: 'wallet.updated' });
}

/* Les rushers de test livrent les demandes de test, si le membre a laissé le rusher automatique activé. */
let animated = false;
export function startTestRushers() {
  if (animated) return;
  animated = true;
  animateBots(testBots, (row) => {
    if (!isTestUser(row.requester_id) || getUser(row.requester_id)?.is_bot) return false;
    const auto = one<{ auto_rusher: number }>('SELECT auto_rusher FROM test_accounts WHERE user_id = ?', row.requester_id);
    return auto?.auto_rusher === 1;
  });
}
