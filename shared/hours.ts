/**
 * Horaires d'ouverture, toujours évalués dans le fuseau du campus
 * (Europe/Zurich), quel que soit le fuseau du navigateur ou du serveur.
 */

export type TimeRange = readonly [open: string, close: string];
/** Index 0 = dimanche … 6 = samedi, comme Date#getDay(). */
export type WeekHours = readonly (readonly TimeRange[])[];

const TZ = 'Europe/Zurich';
const DAY_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

export function zurichNow(date = new Date()): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export interface OpenStatus {
  open: boolean;
  /** Ferme dans moins de 30 minutes. */
  closingSoon: boolean;
  label: string;
}

export function openStatus(hours: WeekHours, date = new Date()): OpenStatus {
  const { day, minutes } = zurichNow(date);

  for (const [o, c] of hours[day] ?? []) {
    const open = toMinutes(o);
    const close = toMinutes(c);
    if (minutes >= open && minutes < close) {
      if (close >= 24 * 60 && o === '00:00') return { open: true, closingSoon: false, label: 'Ouvert 24h/24' };
      const closingSoon = close - minutes <= 30;
      return {
        open: true,
        closingSoon,
        label: closingSoon ? `Ferme bientôt · ${fmt(c)}` : `Ouvert · jusqu'à ${fmt(c)}`,
      };
    }
  }

  // Prochaine ouverture : plus tard aujourd'hui, sinon les jours suivants.
  for (let offset = 0; offset < 7; offset++) {
    const d = (day + offset) % 7;
    const ranges = [...(hours[d] ?? [])].sort((a, b) => toMinutes(a[0]) - toMinutes(b[0]));
    const next = ranges.find(([o]) => offset > 0 || toMinutes(o) > minutes);
    if (next) {
      const when = offset === 0 ? '' : offset === 1 ? 'demain ' : `${DAY_SHORT[d]} `;
      return { open: false, closingSoon: false, label: `Fermé · ouvre ${when}à ${fmt(next[0])}` };
    }
  }
  return { open: false, closingSoon: false, label: 'Fermé' };
}

function fmt(hhmm: string): string {
  return hhmm === '24:00' ? 'minuit' : hhmm.replace(':', 'h');
}

/** Raccourcis pour déclarer des horaires lisibles dans le catalogue. */
export const week = {
  /** Du lundi au dimanche, dans l'ordre de la semaine. */
  days: (
    mon: TimeRange[],
    tue: TimeRange[],
    wed: TimeRange[],
    thu: TimeRange[],
    fri: TimeRange[],
    sat: TimeRange[] = [],
    sun: TimeRange[] = [],
  ): WeekHours => [sun, mon, tue, wed, thu, fri, sat],
  weekdays: (...ranges: TimeRange[]): WeekHours => [[], ranges, ranges, ranges, ranges, ranges, []],
  everyday: (...ranges: TimeRange[]): WeekHours => Array.from({ length: 7 }, () => ranges),
  custom: (weekdays: TimeRange[], saturday: TimeRange[] = [], sunday: TimeRange[] = []): WeekHours => [
    sunday,
    weekdays,
    weekdays,
    weekdays,
    weekdays,
    weekdays,
    saturday,
  ],
};
