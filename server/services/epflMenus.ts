import { createHash } from 'node:crypto';
import { EPFL_MENU_URL, type ItemTag, type MenuItem, type MenuSection, type PriceTiers, type Spot } from '../../shared/catalog';
import type { DailyStatus, SpotMenu } from '../../shared/types';

/**
 * Offre du jour des restaurants de l'EPFL, lue en direct sur la page
 * publique de l'EPFL (un tableau rendu côté serveur, une ligne par menu,
 * avec les prix étudiant, doctorant, campus et visiteur). On ne garde que
 * ce qui est publié : aucun prix n'est complété ni estimé.
 */

export type Service = 'lunch' | 'dinner';

export interface EpflOffer {
  restaurant: string;
  service: Service;
  item: MenuItem;
}

const TTL_MS = 20 * 60_000;
const RETRY_MS = 2 * 60_000;

/* ── Lecture du HTML ──────────────────────────────────────────────────── */

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED[code.toLowerCase()] ?? m;
  });
}

const text = (html: string) =>
  decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t ]+/g, ' ')
    .trim();

const lines = (html: string) =>
  text(html)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** Retire les blocs en italique (provenance, régime, allergènes), même imbriqués. */
function stripEm(html: string): string {
  let out = html;
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(/<em>((?:(?!<\/?em>)[\s\S])*)<\/em>/g, '');
  }
  return out;
}

/** Nom de comptoir comparable : sans accents, casse ni espaces superflus. */
export const normalizeName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const TIER: Record<string, keyof PriceTiers> = { E: 'student', D: 'doctoral', C: 'campus', V: 'visitor' };

function parsePrices(cell: string): { tiers: PriceTiers; single?: number; per100g?: number } {
  const tiers: PriceTiers = {};
  let single: number | undefined;
  let per100g: number | undefined;
  for (const [, span] of cell.matchAll(/<span class="price"[^>]*>([\s\S]*?)<\/span>/g)) {
    const label = /<abbr[^>]*>\s*([A-Z])\s*<\/abbr>/.exec(span)?.[1];
    const raw = text(span);
    const amount = /(\d+(?:[.,]\d{1,2})?)/.exec(raw.replace(/^[A-Z]\s/, ''))?.[1];
    if (!amount) continue;
    const cents = Math.round(Number(amount.replace(',', '.')) * 100);
    if (!(cents > 0)) continue;
    if (/\/\s*100\s*g/i.test(raw)) per100g = cents;
    else if (label && TIER[label]) tiers[TIER[label]] = cents;
    else single = cents;
  }
  // Certaines lignes n'ont qu'un prix hors balise <span class="price">.
  if (!Object.keys(tiers).length && single === undefined && per100g === undefined) {
    const raw = text(cell);
    const amount = /(\d+(?:[.,]\d{1,2}))/.exec(raw)?.[1];
    if (amount) {
      const cents = Math.round(Number(amount.replace(',', '.')) * 100);
      if (/\/\s*100\s*g/i.test(raw)) per100g = cents;
      else if (cents > 0) single = cents;
    }
  }
  return { tiers, single, per100g };
}

const idFor = (...parts: string[]) => `e-${createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 10)}`;

export function parseOffers(html: string): EpflOffer[] {
  const offers: EpflOffer[] = [];
  const seen = new Set<string>();
  for (const [row] of html.matchAll(/<tr class="menuPage[\s\S]*?<\/tr>/g)) {
    const classes = /<tr class="([^"]*)"/.exec(row)?.[1].split(/\s+/) ?? [];
    const restaurantCell = /<td class="restaurant">([\s\S]*?)<\/td>/.exec(row)?.[1];
    const descr = /<div class="descr">([\s\S]*?)<\/div>/.exec(row)?.[1];
    const pricesCell = /<td class="prices">([\s\S]*?)<\/td>/.exec(row)?.[1] ?? '';
    if (!restaurantCell || !descr) continue;

    const restaurant = text(restaurantCell);
    const bold = /<b>([\s\S]*?)<\/b>/.exec(descr)?.[1] ?? '';
    // Hors du titre en gras : accompagnements d'un menu (« Fruits frais au choix »…), sans les mentions en italique.
    const extras = lines(stripEm(descr.replace(/<b>[\s\S]*?<\/b>/, '\n')));
    const titleLines = bold ? lines(bold) : extras.splice(0, 1);
    if (!restaurant || titleLines.length === 0) continue;

    const allergenBlock = /Allerg[\s\S]*?:([\s\S]*)/.exec(descr)?.[1] ?? '';
    const allergens = [...allergenBlock.matchAll(/<em>([^<]+)<\/em>/g)].map((m) => text(m[1])).filter(Boolean);

    const tags: ItemTag[] = [];
    if (classes.includes('vegan')) tags.push('vegan');
    else if (classes.includes('vegetarian')) tags.push('vege');

    const { tiers, single, per100g } = parsePrices(pricesCell);
    const fixed = [...Object.values(tiers), ...(single !== undefined ? [single] : [])];
    const service: Service = classes.includes('dinner') ? 'dinner' : 'lunch';
    const name = titleLines[0];
    const description = [...titleLines.slice(1), ...extras].join(', ') || undefined;

    const id = idFor(restaurant, service, name, description ?? '', JSON.stringify(tiers), String(single ?? ''), String(per100g ?? ''));
    if (seen.has(id)) continue;
    seen.add(id);

    offers.push({
      restaurant,
      service,
      item: {
        id,
        name,
        description,
        priceCents: fixed.length ? Math.max(...fixed) : 0,
        ...(Object.keys(tiers).length ? { tiers } : {}),
        ...(tags.length ? { tags } : {}),
        ...(allergens.length ? { allergens } : {}),
        ...(per100g !== undefined ? { per100gCents: per100g } : {}),
      },
    });
  }
  return offers;
}

/* ── Récupération et cache ────────────────────────────────────────────── */

/** Date du jour à Lausanne, au format de la page EPFL (AAAA-MM-JJ). */
export const zurichDate = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

interface CacheEntry {
  offers: EpflOffer[] | null;
  fetchedAt: number;
  retryAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

type Fetcher = (url: string) => Promise<string>;

let fetcher: Fetcher = async (url) => {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; RushEPFL/1.0; +https://rush-epfl.onrender.com)', accept: 'text/html' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`EPFL ${res.status}`);
  return res.text();
};

/** Pour les tests : remplace l'accès réseau. */
export function setFetcher(f: Fetcher) {
  fetcher = f;
  cache.clear();
  inflight.clear();
}

async function load(date: string): Promise<CacheEntry> {
  const previous = cache.get(date);
  try {
    const offers = parseOffers(await fetcher(`${EPFL_MENU_URL}?date=${date}`));
    const entry = { offers, fetchedAt: Date.now(), retryAt: Date.now() + TTL_MS };
    cache.set(date, entry);
    return entry;
  } catch (err) {
    console.error('[epfl-menus]', err instanceof Error ? err.message : err);
    // On garde la dernière lecture réussie du jour et on réessaie bientôt.
    const entry = { offers: previous?.offers ?? null, fetchedAt: previous?.fetchedAt ?? 0, retryAt: Date.now() + RETRY_MS };
    cache.set(date, entry);
    return entry;
  }
}

export async function offersFor(date: string): Promise<CacheEntry> {
  const hit = cache.get(date);
  if (hit && hit.retryAt > Date.now()) return hit;
  let pending = inflight.get(date);
  if (!pending) {
    pending = load(date).finally(() => inflight.delete(date));
    inflight.set(date, pending);
  }
  return pending;
}

/* ── Menu d'un spot ───────────────────────────────────────────────────── */

export function sectionsFor(spot: Spot, offers: EpflOffer[]): MenuSection[] {
  if (!spot.epfl) return [];
  const sections: MenuSection[] = [];
  // Ordre du catalogue (comptoir par comptoir), le midi puis le soir.
  for (const service of ['lunch', 'dinner'] as const) {
    for (const [epflName, label] of Object.entries(spot.epfl)) {
      const key = normalizeName(epflName);
      const items = offers.filter((o) => o.service === service && normalizeName(o.restaurant) === key).map((o) => o.item);
      if (items.length) sections.push({ title: service === 'dinner' ? `Ce soir · ${label}` : label, items });
    }
  }
  return sections;
}

/** Menu complet d'un spot : offre du jour EPFL, puis carte fixe officielle. */
export async function spotMenu(spot: Spot, now = new Date()): Promise<SpotMenu> {
  if (!spot.epfl) return { sections: spot.menu, daily: null };
  const date = zurichDate(now);
  const entry = await offersFor(date);
  const daily = entry.offers ? sectionsFor(spot, entry.offers) : [];
  const status: DailyStatus = entry.offers === null ? 'unavailable' : daily.length ? 'ok' : 'empty';
  return {
    sections: [...daily, ...spot.menu],
    daily: { date, status, sourceUrl: `${EPFL_MENU_URL}?date=${date}`, fetchedAt: entry.fetchedAt ? new Date(entry.fetchedAt).toISOString() : null },
  };
}
