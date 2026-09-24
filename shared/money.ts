/** Tous les montants circulent en centimes (entiers) pour éviter les erreurs d'arrondi. */

export function formatCHF(cents: number, opts: { sign?: boolean; bare?: boolean } = {}): string {
  const abs = Math.abs(cents);
  const value = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  const sign = cents < 0 ? '−' : opts.sign && cents > 0 ? '+' : '';
  return opts.bare ? `${sign}${value}` : `${sign}CHF ${value}`;
}

/** Arrondi au multiple de `step` centimes le plus proche. */
export function roundTo(cents: number, step: number): number {
  return Math.round(cents / step) * step;
}

export function ceilTo(cents: number, step: number): number {
  return Math.ceil(cents / step) * step;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
