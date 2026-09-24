import { useState, type ReactNode } from 'react';
import { ArrowUpRight, Star } from 'lucide-react';
import type { PlaceMedia } from '../../shared/types';
import { photoUrl } from '../lib/spotStyle';
import { cx } from '../ui/primitives';

/*
 * Photos et avis Google Maps, relevés une fois et affichés avec leurs
 * crédits : chaque photo et chaque avis restent attribués à leur auteur,
 * avec un lien vers la fiche Google Maps.
 */

const LANG: Record<string, string> = { en: 'l’anglais', de: 'l’allemand', it: 'l’italien', es: 'l’espagnol', pt: 'le portugais' };

const monthYear = (iso: string) =>
  iso ? new Intl.DateTimeFormat('fr-CH', { month: 'long', year: 'numeric' }).format(new Date(`${iso}T12:00:00`)) : '';

function Author({ name, url }: { name: string; url: string | null }) {
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      {name}
    </a>
  ) : (
    <>{name}</>
  );
}

/** Galerie en tête de fiche, défilement horizontal avec aimantation. */
export function PhotoGallery({ media, fallback }: { media: PlaceMedia; fallback: ReactNode }) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const photos = media.photos.filter((p) => !failed.has(p.url));
  if (photos.length === 0) return <>{fallback}</>;
  return (
    <div className="g-gallery" aria-label="Photos Google Maps">
      {photos.map((p) => (
        <figure key={p.url} className="g-gallery__item">
          <img
            src={photoUrl(p.url, 900, 600)}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed((s) => new Set(s).add(p.url))}
          />
          <figcaption>
            © <Author name={p.author} url={p.authorUrl} /> · Google Maps
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function Stars({ value, size = 12 }: { value: number; size?: number }) {
  return (
    <span className="g-stars" aria-label={`${value.toFixed(1)} sur 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} strokeWidth={0} fill="currentColor" className={cx(n > Math.round(value) && 'is-off')} />
      ))}
    </span>
  );
}

export function PlaceReviews({ media }: { media: PlaceMedia }) {
  const [open, setOpen] = useState<number | null>(null);
  if (media.reviews.length === 0 && media.rating === null) return null;
  return (
    <section className="g-reviews">
      <div className="g-reviews__head">
        <h2>Avis Google Maps</h2>
        {media.rating !== null && (
          <span className="g-reviews__score">
            <strong>{media.rating.toFixed(1).replace('.', ',')}</strong>
            <Stars value={media.rating} />
            <span>({media.ratingCount})</span>
          </span>
        )}
      </div>
      {media.reviews.map((r, i) => (
        <article key={`${r.author}-${r.date}-${i}`} className="g-review">
          <header>
            <span className="g-review__avatar" aria-hidden>
              {r.author[0]?.toUpperCase()}
            </span>
            <span className="g-review__who">
              <strong>
                <Author name={r.author} url={r.authorUrl} />
              </strong>
              <span>
                <Stars value={r.rating} /> {monthYear(r.date)}
              </span>
            </span>
          </header>
          <p className={cx('g-review__text', open !== i && 'is-clamped')} onClick={() => setOpen(open === i ? null : i)}>
            {r.text}
          </p>
          {r.translatedFrom && <p className="g-review__note">Traduit de {LANG[r.translatedFrom] ?? r.translatedFrom} par Google</p>}
        </article>
      ))}
      <p className="g-reviews__credit">
        Avis publiés sur Google Maps, crédités à leurs auteurs, relevés le {new Date(`${media.fetchedAt}T12:00:00`).toLocaleDateString('fr-CH', { day: 'numeric', month: 'long', year: 'numeric' })}.{' '}
        <a href={media.mapsUrl} target="_blank" rel="noreferrer">
          Tous les avis sur Google Maps <ArrowUpRight size={12} />
        </a>
      </p>
    </section>
  );
}
