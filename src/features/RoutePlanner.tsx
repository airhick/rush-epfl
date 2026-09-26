import { useEffect, useState } from 'react';
import { Building2, Crosshair, MapPin, Search, X } from 'lucide-react';
import { SPOTS, spotOf } from '../../shared/catalog';
import { formatDistance, walkingDistance, type LatLng } from '../../shared/geo';
import { openStatus } from '../../shared/hours';
import type { PlaceResult, RouteStop } from '../../shared/types';
import { usePlaceSearch } from '../lib/queries';
import { Sheet } from '../ui/Sheet';
import { Button, cx, IconTile, SpotBadge } from '../ui/primitives';

export const MAX_STOPS = 5;

const stopFrom = (r: PlaceResult): RouteStop => ({ lat: r.lat, lng: r.lng, label: r.label, spotId: r.spotId });

/** Rôle d'une étape dans la phrase « je mange ici, puis je vais là ». */
function stopRole(stops: RouteStop[], i: number) {
  if (i === 0 && stops[0].spotId) return 'Je mange ici';
  if (i === stops.length - 1) return i === 0 ? 'Je vais ici' : 'Puis je vais ici';
  return 'Je passe par ici';
}

/**
 * « Je mange au FoodLab, puis je vais au BC » : les étapes du trajet, trouvées
 * avec un petit moteur de recherche (spots, bâtiments, adresses) ou placées à
 * la main sur la carte.
 */
export function RoutePlanner({
  open,
  onClose,
  draft,
  setDraft,
  from,
  saving,
  onSave,
  onClear,
  onPickOnMap,
}: {
  open: boolean;
  onClose: () => void;
  draft: RouteStop[];
  setDraft: (stops: RouteStop[]) => void;
  /** Position de départ pour classer les suggestions (GPS, ou centre du campus). */
  from: LatLng;
  saving: boolean;
  onSave: () => void;
  onClear: (() => void) | null;
  onPickOnMap: () => void;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const { data: results, isFetching } = usePlaceSearch(debounced);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const add = (stop: RouteStop) => {
    setDraft([...draft, stop].slice(0, MAX_STOPS));
    setQuery('');
  };
  const full = draft.length >= MAX_STOPS;
  const searching = debounced.trim().length >= 2;

  // Sans recherche : les spots ouverts les plus proches, pour « je mange ici » en un geste.
  const nearbySpots = SPOTS.filter((s) => openStatus(s.hours).open && !draft.some((d) => d.spotId === s.id))
    .map((s) => ({ s, d: walkingDistance(from, s) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 4);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Mon trajet"
      footer={
        <div className="route-planner__footer">
          <Button block loading={saving} disabled={draft.length === 0} onClick={onSave}>
            Enregistrer le trajet
          </Button>
          {onClear && (
            <Button block variant="secondary" onClick={onClear}>
              Effacer mon trajet
            </Button>
          )}
        </div>
      }
    >
      <p className="sheet-note sheet-note--top">
        Où tu manges, puis où tu vas : tu reçois en direct les demandes qui tombent sur ton chemin, même avant d’y être.
      </p>

      <div className="route-planner">
        {draft.length > 0 && (
          <ol className="route-stops">
            {draft.map((s, i) => (
              <li key={`${i}-${s.lat}-${s.lng}`}>
                <span className="route-stops__num">{i + 1}</span>
                <span className="route-stops__text">
                  <strong>{s.label}</strong>
                  <span>{stopRole(draft, i)}</span>
                </span>
                <button
                  className="route-stops__remove"
                  onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                  aria-label={`Retirer ${s.label}`}
                >
                  <X size={16} strokeWidth={2.4} />
                </button>
              </li>
            ))}
          </ol>
        )}

        {!full && (
          <>
            <label className="search route-planner__search">
              <Search size={18} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={draft.length === 0 ? 'Où manges-tu ? Spot, bâtiment, adresse…' : 'Et ensuite, où vas-tu ?'}
                autoComplete="off"
                enterKeyHint="search"
              />
              {query && (
                <button onClick={() => setQuery('')} aria-label="Effacer la recherche">
                  <X size={16} />
                </button>
              )}
            </label>

            <div className={cx('place-results', isFetching && 'is-loading')}>
              {searching
                ? results && results.length > 0
                  ? results.map((r) => <PlaceRow key={r.id} place={r} from={from} onPick={() => add(stopFrom(r))} />)
                  : !isFetching && <p className="place-results__empty">Rien trouvé. Place le point sur la carte.</p>
                : nearbySpots.map(({ s, d }) => (
                    <button key={s.id} className="place-row" onClick={() => add({ lat: s.lat, lng: s.lng, label: s.name, spotId: s.id })}>
                      <SpotBadge spot={s} size={34} radius={10} />
                      <span className="place-row__text">
                        <strong>{s.name}</strong>
                        <span>{s.place}</span>
                      </span>
                      <span className="muted small">{formatDistance(d)}</span>
                    </button>
                  ))}
              <button className="place-row" onClick={onPickOnMap}>
                <IconTile>
                  <Crosshair size={15} />
                </IconTile>
                <span className="place-row__text">
                  <strong>Placer un point sur la carte</strong>
                  <span>Approximatif, ça suffit pour trouver les courses sur ton chemin.</span>
                </span>
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

function PlaceRow({ place, from, onPick }: { place: PlaceResult; from: LatLng; onPick: () => void }) {
  return (
    <button className="place-row" onClick={onPick}>
      {place.spotId ? (
        <SpotBadge spot={spotOf(place.spotId)} size={34} radius={10} />
      ) : (
        <IconTile>{place.kind === 'building' ? <Building2 size={15} /> : <MapPin size={15} />}</IconTile>
      )}
      <span className="place-row__text">
        <strong>{place.label}</strong>
        <span>{place.detail}</span>
      </span>
      <span className="muted small">{formatDistance(walkingDistance(from, place))}</span>
    </button>
  );
}
