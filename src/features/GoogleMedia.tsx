import { useState, type ReactNode } from 'react';
import { ArrowUpRight, Star } from 'lucide-react';
import type { GoogleAttribution, GooglePlace } from '../../shared/types';
import { cx } from '../ui/primitives';

/*
 * Photos et avis Google Maps, affichés sous la licence de l'API Places :
 * chaque photo et chaque avis restent crédités à leur auteur, avec la
 * mention « Google Maps ».
 */

const photoSrc = (spotId: string, name: string, width: number) =>
  `/api/spots/${encodeURIComponent(spotId)}/google/photo?name=${encodeURIComponent(name)}&w=${width}`;

function Credit({ people }: { people: GoogleAttribution[] }) {
  if (people.length === 0) return <>Google Maps</>;
  return (
    <>
      ©{' '}
      {people.map((p, i) => (
        <span key={`${p.name}-${i}`}>
          {i > 0 && ', '}
          {p.url ? (
            <a href={p.url} target="_blank" rel="noreferrer">
              {p.name}
            </a>
          ) : (
            p.name
          )}
        </span>
      ))}{' '}
      · Google Maps
    </>
  );
}

/** Galerie en tête de fiche, défilement horizontal avec aimantation. */
export function GoogleGallery({ spotId, place, fallback }: { spotId: string; place: GooglePlace; fallback: ReactNode }) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const photos = place.photos.filter((p) => !failed.has(p.name));
  if (photos.length === 0) return <>{fallback}</>;
  return (
    <div className="g-gallery" aria-label="Photos Google Maps">
      {photos.map((p) => (
        <figure key={p.name} className="g-gallery__item">
          <img
            src={photoSrc(spotId, p.name, 900)}
            alt=""
            loading="lazy"
            onError={() => setFailed((s) => new Set(s).add(p.name))}
          />
          <figcaption>
            <Credit people={p.attributions} />
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="g-stars" aria-label={`${value} sur 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={12} strokeWidth={0} fill="currentColor" className={cx(n > Math.round(value) && 'is-off')} />
      ))}
    </span>
  );
}

export function GoogleReviews({ place }: { place: GooglePlace }) {
  const [open, setOpen] = useState<number | null>(null);
  if (place.reviews.length === 0 && place.rating === null) return null;
  return (
    <section className="g-reviews">
      <div className="g-reviews__head">
        <h2>Avis Google Maps</h2>
        {place.rating !== null && (
          <span className="g-reviews__score">
            <strong>{place.rating.toFixed(1).replace('.', ',')}</strong>
            <Stars value={place.rating} />
            <span>({place.ratingCount})</span>
          </span>
        )}
      </div>
      {place.reviews.map((r, i) => (
        <article key={i} className="g-review">
          <header>
            {r.author.photoUrl ? (
              <img className="g-review__avatar" src={r.author.photoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
            ) : (
              <span className="g-review__avatar g-review__avatar--empty">{r.author.name[0]}</span>
            )}
            <span className="g-review__who">
              {r.author.url ? (
                <a href={r.author.url} target="_blank" rel="noreferrer">
                  {r.author.name}
                </a>
              ) : (
                <strong>{r.author.name}</strong>
              )}
              <span>
                <Stars value={r.rating} /> {r.when}
              </span>
            </span>
          </header>
          {r.text && (
            <p className={cx('g-review__text', open !== i && 'is-clamped')} onClick={() => setOpen(open === i ? null : i)}>
              {r.text}
            </p>
          )}
        </article>
      ))}
      <p className="g-reviews__credit">
        Avis publiés par des utilisateurs de Google Maps, crédités à leurs auteurs.{' '}
        {place.mapsUrl && (
          <a href={place.mapsUrl} target="_blank" rel="noreferrer">
            Tous les avis sur Google Maps <ArrowUpRight size={12} />
          </a>
        )}
      </p>
    </section>
  );
}
