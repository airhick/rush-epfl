/** Qui a déjà reçu quelle course en direct : on ne propose jamais deux fois la même course à la même personne. */
const offered = new Map<string, Set<string>>();

export const offeredCount = (orderId: string) => offered.get(orderId)?.size ?? 0;
export const wasOffered = (orderId: string, userId: string) => offered.get(orderId)?.has(userId) ?? false;

export function markOffered(orderId: string, userId: string) {
  let set = offered.get(orderId);
  if (!set) offered.set(orderId, (set = new Set()));
  set.add(userId);
}

/** Course prise, annulée, ou de nouveau ouverte (on la repropose alors à tout le monde). */
export function forgetOffers(orderId: string) {
  offered.delete(orderId);
}
