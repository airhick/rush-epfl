import { useEffect } from 'react';
import { create } from 'zustand';
import type { LatLng } from '../../shared/geo';
import type { PublicUser } from '../../shared/types';

/**
 * Ce que la carte doit montrer. Chaque écran décrit sa scène et la carte
 * s'occupe du rendu et des animations de caméra.
 */
export interface RouteLine {
  id: string;
  points: LatLng[];
  style: 'active' | 'approach' | 'ghost';
}

export interface RequestPin extends LatLng {
  id: string;
  label: string;
  selected?: boolean;
}

export type Camera =
  | { kind: 'fit'; points: LatLng[]; maxZoom?: number }
  | { kind: 'fly'; center: LatLng; zoom: number; pitch?: number }
  | { kind: 'overview' };

export interface Scene {
  /** Change de clé ⇒ nouveau mouvement de caméra. */
  cameraKey: string;
  camera: Camera;
  highlightSpotId?: string | null;
  focusSpotIds?: string[] | null;
  routes?: RouteLine[];
  dropoff?: (LatLng & { label: string; draggable?: boolean }) | null;
  requests?: RequestPin[];
  courier?: (LatLng & { user: PublicUser }) | null;
  destination?: (LatLng & { label: string }) | null;
}

interface SceneState {
  scene: Scene;
  onDropoffMove: ((p: LatLng) => void) | null;
  onRequestClick: ((id: string) => void) | null;
  hoverSpotId: string | null;
  set: (scene: Scene) => void;
  setHandlers: (h: Partial<Pick<SceneState, 'onDropoffMove' | 'onRequestClick'>>) => void;
  hover: (id: string | null) => void;
}

export const useScene = create<SceneState>((set) => ({
  scene: { cameraKey: 'overview', camera: { kind: 'overview' } },
  onDropoffMove: null,
  onRequestClick: null,
  hoverSpotId: null,
  set: (scene) => set({ scene }),
  setHandlers: (h) => set(h),
  hover: (hoverSpotId) => set({ hoverSpotId }),
}));

/** Déclare la scène de l'écran courant. `deps` doit capturer tout ce qui la fait varier. */
export function useMapScene(build: () => Scene, deps: unknown[]) {
  useEffect(() => {
    useScene.getState().set(build());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Arc de Bézier quadratique entre deux points, façon trajet Uber. */
export function arc(from: LatLng, to: LatLng, bend = 0.18, steps = 48): LatLng[] {
  const k = Math.cos((from.lat * Math.PI) / 180);
  const mid = { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 };
  const dx = (to.lng - from.lng) * k;
  const dy = to.lat - from.lat;
  const ctrl = { lat: mid.lat + dx * bend, lng: mid.lng - (dy * bend) / k };
  const pts: LatLng[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({
      lat: u * u * from.lat + 2 * u * t * ctrl.lat + t * t * to.lat,
      lng: u * u * from.lng + 2 * u * t * ctrl.lng + t * t * to.lng,
    });
  }
  return pts;
}
