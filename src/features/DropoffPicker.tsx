import { useMemo, useState } from 'react';
import { Building2, ChevronDown, LocateFixed, MapPin, Search } from 'lucide-react';
import { BUILDINGS, nearestBuilding } from '../../shared/catalog';
import { formatDistance, walkingDistance } from '../../shared/geo';
import { useDropoff, useGeo } from '../state/location';
import { Sheet } from '../ui/Sheet';
import { Group, IconTile, Row } from '../ui/primitives';

/** Bouton « Livraison à … » et feuille de choix du point de livraison. */
export function DropoffButton({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const dropoff = useDropoff();
  const source = dropoff.source === 'auto' ? 'Ma position' : dropoff.source === 'pin' ? 'Épingle' : 'Bâtiment';
  return (
    <>
      <button className={compact ? 'dropoff-btn dropoff-btn--compact' : 'dropoff-btn'} onClick={() => setOpen(true)}>
        <span className="dropoff-btn__eyebrow">Livraison à</span>
        <span className="dropoff-btn__value">
          {dropoff.label}
          <span className="dropoff-btn__source">· {source}</span>
          <ChevronDown size={16} strokeWidth={2.6} />
        </span>
      </button>
      <DropoffSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function DropoffSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dropoff = useDropoff();
  const geo = useGeo();
  const [q, setQ] = useState('');

  const buildings = useMemo(() => {
    const list = BUILDINGS.map((b) => ({ ...b, d: walkingDistance(geo.position, b) }));
    const filtered = q ? list.filter((b) => normalize(`${b.name} ${b.hint}`).includes(normalize(q))) : list;
    return filtered.sort((a, b) => a.d - b.d);
  }, [geo.position, q]);

  const useMyPosition = () => {
    geo.start();
    const p = useGeo.getState().position;
    dropoff.set({ ...p, label: nearestBuilding(p).name, source: 'auto' });
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Point de livraison">
      <label className="search search--sheet">
        <Search size={17} />
        <input placeholder="Bâtiment, auditoire…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>

      <Group>
        <Row
          onClick={useMyPosition}
          leading={
            <IconTile color="var(--blue)">
              <LocateFixed size={17} color="#fff" />
            </IconTile>
          }
          title="Ma position actuelle"
          subtitle={
            geo.status === 'live'
              ? `Près de ${nearestBuilding(geo.position).name}`
              : geo.status === 'denied'
                ? 'Localisation refusée dans le navigateur'
                : geo.status === 'off-campus'
                  ? 'Tu sembles hors du campus'
                  : 'Autoriser la localisation'
          }
        />
      </Group>

      <Group header="Bâtiments">
        {buildings.map((b) => (
          <Row
            key={b.id}
            onClick={() => {
              dropoff.set({ lat: b.lat, lng: b.lng, label: b.name, source: 'building' });
              onClose();
            }}
            leading={
              <IconTile color="var(--fill-2)">
                <Building2 size={16} color="var(--label)" />
              </IconTile>
            }
            title={b.name}
            subtitle={b.hint}
            trailing={
              dropoff.label === b.name && dropoff.source === 'building' ? (
                <MapPin size={16} color="var(--blue)" />
              ) : (
                <span className="muted">{formatDistance(b.d)}</span>
              )
            }
          />
        ))}
      </Group>
      <p className="sheet-note">Tu pourras affiner en déplaçant l’épingle sur la carte avant de publier.</p>
    </Sheet>
  );
}
