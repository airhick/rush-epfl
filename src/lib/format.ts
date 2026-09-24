const TZ = 'Europe/Zurich';

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'à l’instant';
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hier' : `il y a ${d} j`;
}

export function clock(iso: string | Date): string {
  return new Intl.DateTimeFormat('fr-CH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function dayKey(d: Date) {
  return new Intl.DateTimeFormat('fr-CH', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (dayKey(d) === dayKey(now)) return 'Aujourd’hui';
  if (dayKey(d) === dayKey(new Date(now.getTime() - 86_400_000))) return 'Hier';
  const label = new Intl.DateTimeFormat('fr-CH', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  return label[0].toUpperCase() + label.slice(1);
}

/** « 12:31 » aujourd'hui, « hier » ou « lun. 21 sept. » au-delà. */
export function shortDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (dayKey(d) === dayKey(now)) return clock(d);
  if (dayKey(d) === dayKey(new Date(now.getTime() - 86_400_000))) return 'Hier';
  return new Intl.DateTimeFormat('fr-CH', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

export function groupByDay<T>(items: T[], getIso: (t: T) => string): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = dayLabel(getIso(item));
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n > 1 ? many : one}`;
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}
