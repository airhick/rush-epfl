import type maplibregl from 'maplibre-gl';

/** Accès à l'instance de carte pour les contrôles flottants (recentrer, 3D…). */
let instance: maplibregl.Map | null = null;

export const setMap = (m: maplibregl.Map | null) => {
  instance = m;
};

export const getMap = () => instance;
