import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Search, X } from 'lucide-react';
import { KIND_LABEL, SPOTS, type Spot, type SpotKind } from '../../shared/catalog';
import { formatDistance, walkingDistance, walkingMinutes } from '../../shared/geo';
import { openStatus, zurichNow } from '../../shared/hours';
import { suggestTip } from '../../shared/pricing';
import { formatCHF } from '../../shared/money';
import { useActivity, useMe } from '../lib/queries';
import { joinNames } from '../lib/format';
import { useMapScene, useScene } from '../state/scene';
import { useDropoff, useGeo } from '../state/location';
import { DropoffButton } from '../features/DropoffPicker';
import { ActiveOrders } from '../features/ActiveOrders';
import { Screen } from '../ui/Screen';
import { AvatarStack, Chip, cx, Empty, SpotBadge, SpotCover } from '../ui/primitives';
import type { PublicUser } from '../../shared/types';

type Filter = 'all' | SpotKind | 'open-late';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tout' },
  { id: 'restaurant', label: 'Restaurants' },
  { id: 'cafe', label: 'Cafés' },
  { id: 'cafeteria', label: 'Cafétérias' },
  { id: 'foodtruck', label: 'Food trucks' },
  { id: 'bar', label: 'Bars' },
  { id: 'grocery', label: 'Supermarchés' },
  { id: 'open-late', label: 'Ouvert tard' },
];

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function greeting(): string {
  const h = zurichNow().minutes / 60;
  if (h < 5) return 'Bonne nuit';
  if (h < 11) return 'Bonjour';
  if (h < 14) return 'Bon appétit';
  if (h < 18) return 'Bonne pause';
  return 'Bonsoir';
}

export function Explore() {
  const { data: me } = useMe();
  const { data: activity } = useActivity();
  const geo = useGeo();
  const dropoff = useDropoff();
  const hover = useScene((s) => s.hover);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const rushersBySpot = useMemo(() => new Map((activity ?? []).map((a) => [a.spotId, a.rushers])), [activity]);

  const results = useMemo(() => {
    const now = new Date();
    const query = normalize(q.trim());
    return SPOTS.map((spot) => {
      const status = openStatus(spot.hours, now);
      const distance = walkingDistance(geo.position, spot);
      const matches = query
        ? spot.menu.flatMap((s) => s.items).filter((i) => normalize(i.name).includes(query)).map((i) => i.name)
        : [];
      const nameHit = query ? normalize(`${spot.name} ${spot.place} ${spot.tagline} ${KIND_LABEL[spot.kind]}`).includes(query) : true;
      return { spot, status, distance, matches, visible: nameHit || matches.length > 0 };
    })
      .filter((r) => r.visible)
      .filter((r) => {
        if (filter === 'all') return true;
        if (filter === 'open-late') return r.spot.hours.some((day) => day.some(([, close]) => close >= '20:00'));
        return r.spot.kind === filter;
      })
      .sort((a, b) => Number(b.status.open) - Number(a.status.open) || a.distance - b.distance);
  }, [q, filter, geo.position]);

  const filtered = q.trim() !== '' || filter !== 'all';

  useMapScene(
    () => ({
      cameraKey: 'explore',
      camera: { kind: 'overview' },
      focusSpotIds: filtered ? results.map((r) => r.spot.id) : null,
      // Quand la livraison suit la position GPS, le point bleu suffit.
      dropoff: dropoff.source === 'auto' && geo.status === 'live' ? null : { ...dropoff, label: 'Livraison' },
    }),
    [filtered, results, dropoff.lat, dropoff.lng, dropoff.source, geo.status],
  );

  const live = results.filter((r) => r.status.open && (rushersBySpot.get(r.spot.id)?.length ?? 0) > 0);

  return (
    <Screen
      title={
        <>
          {greeting()}
          {me ? `, ${me.firstName}` : ''}
        </>
      }
      navTitle="Explorer"
    >
      <div className="explore-top">
        <DropoffButton />
        <label className="search">
          <Search size={17} strokeWidth={2.2} />
          <input placeholder="Spots, plats, cafés…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && (
            <button onClick={() => setQ('')} aria-label="Effacer">
              <X size={14} strokeWidth={3} />
            </button>
          )}
        </label>
        <div className="chips-scroll">
          {FILTERS.map((f) => (
            <Chip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </Chip>
          ))}
        </div>
      </div>

      <ActiveOrders />

      {!filtered && live.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2>Des rushers y sont déjà</h2>
            <span className="live-dot">En direct</span>
          </div>
          <div className="cards-scroll">
            {live.map(({ spot }) => (
              <LiveCard
                key={spot.id}
                spot={spot}
                rushers={rushersBySpot.get(spot.id)!}
                onClick={() => navigate(`/spot/${spot.id}`)}
                onHover={hover}
              />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section__head">
          <h2>{filtered ? `${results.length} résultat${results.length > 1 ? 's' : ''}` : 'Autour de toi'}</h2>
          {geo.status !== 'live' && !filtered && (
            <button className="link" onClick={geo.start}>
              Activer ma position
            </button>
          )}
        </div>

        {results.length === 0 ? (
          <Empty icon={<Search size={26} />} title="Rien trouvé" body="Essaie un autre plat ou un autre spot." />
        ) : (
          <div className="spot-list">
            {results.map(({ spot, status, distance, matches }) => {
              const rushers = rushersBySpot.get(spot.id) ?? [];
              const tip = suggestTip({ spot, dropoff, itemCount: 1 }).suggestedCents;
              return (
                <button
                  key={spot.id}
                  className={cx('spot-row', !status.open && 'is-closed')}
                  onClick={() => navigate(`/spot/${spot.id}`)}
                  onMouseEnter={() => hover(spot.id)}
                  onMouseLeave={() => hover(null)}
                >
                  <SpotBadge spot={spot} size={56} radius={14} />
                  <span className="spot-row__text">
                    <span className="spot-row__name">{spot.name}</span>
                    <span className="spot-row__meta">
                      {KIND_LABEL[spot.kind]} · {spot.place} · {formatDistance(distance)}
                    </span>
                    {matches.length > 0 ? (
                      <span className="spot-row__match">{matches.slice(0, 2).join(', ')}</span>
                    ) : (
                      <span className={cx('spot-row__status', status.open ? (status.closingSoon ? 'is-warn' : 'is-open') : 'is-closed')}>
                        {status.label}
                      </span>
                    )}
                  </span>
                  <span className="spot-row__side">
                    {rushers.length > 0 && status.open ? (
                      <span className="rusher-count">
                        <span className="rusher-count__dot" />
                        {rushers.length}
                      </span>
                    ) : (
                      <span className="muted small">{walkingMinutes(distance)} min</span>
                    )}
                    <span className="spot-row__tip">~{formatCHF(tip, { bare: true })}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
      <p className="footnote">
        Pourboire indicatif pour un article livré à {dropoff.label}. Prix, horaires et notes proviennent de sources externes (EPFL, enseignes,
        Tripadvisor), à titre indicatif ; le montant réel du ticket fait foi.
      </p>
    </Screen>
  );
}

function LiveCard({
  spot,
  rushers,
  onClick,
  onHover,
}: {
  spot: Spot;
  rushers: PublicUser[];
  onClick: () => void;
  onHover: (id: string | null) => void;
}) {
  return (
    <button className="live-card" onClick={onClick} onMouseEnter={() => onHover(spot.id)} onMouseLeave={() => onHover(null)}>
      <SpotCover spot={spot} height={92} />
      <span className="live-card__body">
        <span className="live-card__name">{spot.name}</span>
        <span className="live-card__who">
          <AvatarStack users={rushers} size={20} />
          <span>{joinNames(rushers.slice(0, 2).map((r) => r.firstName))}{rushers.length > 2 ? '…' : ''}</span>
        </span>
      </span>
    </button>
  );
}
