import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { EPFL_CENTER, isOnCampus, type LatLng } from '../../shared/geo';
import { nearestBuilding } from '../../shared/catalog';

type GeoStatus = 'idle' | 'locating' | 'live' | 'denied' | 'off-campus' | 'unsupported';

interface GeoState {
  /** Position réelle si disponible et sur le campus, sinon le centre du campus. */
  position: LatLng;
  accuracy: number | null;
  status: GeoStatus;
  heading: number | null;
  start: () => void;
}

let watchId: number | null = null;

export const useGeo = create<GeoState>((set) => ({
  position: EPFL_CENTER,
  accuracy: null,
  status: 'idle',
  heading: null,
  start: () => {
    if (watchId !== null) return;
    if (!('geolocation' in navigator)) return set({ status: 'unsupported' });
    set({ status: 'locating' });
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (!isOnCampus(p)) return set({ status: 'off-campus', position: EPFL_CENTER, accuracy: null });
        set({ status: 'live', position: p, accuracy: pos.coords.accuracy, heading: pos.coords.heading ?? null });
      },
      (err) => {
        set({ status: err.code === err.PERMISSION_DENIED ? 'denied' : 'idle' });
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        watchId = null;
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
  },
}));

export interface DropoffDraft extends LatLng {
  label: string;
  note: string;
  source: 'auto' | 'building' | 'pin';
}

interface DropoffState extends DropoffDraft {
  set: (patch: Partial<DropoffDraft>) => void;
}

const initial = nearestBuilding(EPFL_CENTER);

/** Point de livraison courant, conservé d'une commande à l'autre. */
export const useDropoff = create<DropoffState>()(
  persist(
    (set) => ({
      lat: initial.lat,
      lng: initial.lng,
      label: initial.name,
      note: '',
      source: 'auto',
      set: (patch) => set(patch),
    }),
    { name: 'rush.dropoff' },
  ),
);

/** Tant que l'utilisateur n'a rien choisi, le point de livraison suit sa position. */
useGeo.subscribe((geo, prev) => {
  if (geo.status !== 'live' || geo.position === prev.position) return;
  const dropoff = useDropoff.getState();
  if (dropoff.source !== 'auto') return;
  dropoff.set({ ...geo.position, label: nearestBuilding(geo.position).name });
});
