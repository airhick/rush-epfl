import type { StyleSpecification } from 'maplibre-gl';

/**
 * Style vectoriel maison, inspiré d'Apple Plans : terrain chaud et neutre,
 * bâtiments en relief, routes blanches, peu de libellés. Les tuiles
 * OpenMapTiles viennent d'OpenFreeMap (gratuit, sans clé).
 *
 * Pour utiliser un autre fournisseur, définir VITE_MAP_STYLE avec l'URL
 * d'un style MapLibre complet.
 */

const TILES = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>';

interface Palette {
  land: string;
  campus: string;
  park: string;
  wood: string;
  water: string;
  waterLabel: string;
  building: string;
  buildingTop: string;
  buildingLine: string;
  road: string;
  roadCasing: string;
  major: string;
  majorCasing: string;
  motorway: string;
  motorwayCasing: string;
  path: string;
  rail: string;
  label: string;
  labelHalo: string;
  labelMuted: string;
}

export const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    land: '#F2F0EB',
    campus: '#ECE8E0',
    park: '#D3EBC4',
    wood: '#C5E3B2',
    water: '#A6D3F2',
    waterLabel: '#3F7FB5',
    building: '#E3DFD8',
    buildingTop: '#E8E5DF',
    buildingLine: '#D5D0C7',
    road: '#FFFFFF',
    roadCasing: '#DEDAD3',
    major: '#FFFFFF',
    majorCasing: '#D2CDC4',
    motorway: '#FFD98E',
    motorwayCasing: '#E7B966',
    path: '#FFFFFF',
    rail: '#C9C5BE',
    label: '#4A4A4F',
    labelHalo: 'rgba(255,255,255,0.92)',
    labelMuted: '#8A8A8E',
  },
  dark: {
    land: '#1D1E20',
    campus: '#222326',
    park: '#1E2B21',
    wood: '#1B281E',
    water: '#12263A',
    waterLabel: '#5C8DB8',
    building: '#2B2C2F',
    buildingTop: '#323336',
    buildingLine: '#38393D',
    road: '#3A3B3F',
    roadCasing: '#26272A',
    major: '#46474C',
    majorCasing: '#2A2B2E',
    motorway: '#6A5836',
    motorwayCasing: '#3A3122',
    path: '#34353A',
    rail: '#45464A',
    label: '#C7C7CC',
    labelHalo: 'rgba(0,0,0,0.85)',
    labelMuted: '#8E8E93',
  },
};

const z = (stops: [number, number][]) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops.flat()] as unknown as number;

export function buildStyle(theme: 'light' | 'dark'): StyleSpecification {
  const p = PALETTES[theme];
  return {
    version: 8,
    name: `Rush ${theme}`,
    glyphs: GLYPHS,
    sources: {
      omt: { type: 'vector', url: TILES, attribution: ATTRIBUTION },
    },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': p.land } },
      {
        id: 'campus',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['university', 'college', 'school']]],
        paint: { 'fill-color': p.campus },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'omt',
        'source-layer': 'park',
        paint: { 'fill-color': p.park, 'fill-opacity': 0.9 },
      },
      {
        id: 'landcover-grass',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['grass', 'farmland', 'wetland']]],
        paint: { 'fill-color': p.park, 'fill-opacity': 0.75 },
      },
      {
        id: 'landcover-wood',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'wood'],
        paint: { 'fill-color': p.wood, 'fill-opacity': 0.9 },
      },
      {
        id: 'landuse-pitch',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['pitch', 'stadium', 'playground']]],
        paint: { 'fill-color': p.park, 'fill-opacity': 0.8 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'omt',
        'source-layer': 'water',
        paint: { 'fill-color': p.water },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'omt',
        'source-layer': 'waterway',
        paint: { 'line-color': p.water, 'line-width': z([[13, 1], [18, 5]]) },
      },
      {
        id: 'path',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        minzoom: 14,
        filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.path, 'line-width': z([[14, 0.8], [18, 4]]), 'line-opacity': 0.95 },
      },
      {
        id: 'road-minor-casing',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['minor', 'service']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.roadCasing, 'line-width': z([[13, 1.5], [18, 16]]) },
      },
      {
        id: 'road-major-casing',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'tertiary', 'trunk']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.majorCasing, 'line-width': z([[11, 2], [18, 26]]) },
      },
      {
        id: 'road-motorway-casing',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'motorway'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.motorwayCasing, 'line-width': z([[10, 2], [18, 30]]) },
      },
      {
        id: 'road-minor',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['minor', 'service']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.road, 'line-width': z([[13, 0.8], [18, 13]]) },
      },
      {
        id: 'road-major',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'tertiary', 'trunk']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.major, 'line-width': z([[11, 1.2], [18, 22]]) },
      },
      {
        id: 'road-motorway',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'motorway'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.motorway, 'line-width': z([[10, 1.2], [18, 26]]) },
      },
      {
        id: 'rail',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
        paint: { 'line-color': p.rail, 'line-width': z([[13, 1], [18, 3]]) },
      },
      {
        id: 'building-flat',
        type: 'fill',
        source: 'omt',
        'source-layer': 'building',
        minzoom: 14,
        maxzoom: 15.5,
        paint: { 'fill-color': p.building, 'fill-outline-color': p.buildingLine },
      },
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        source: 'omt',
        'source-layer': 'building',
        minzoom: 15,
        paint: {
          'fill-extrusion-color': p.buildingTop,
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, ['coalesce', ['get', 'render_height'], 8]],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.92,
          'fill-extrusion-vertical-gradient': true,
        },
      },
      {
        id: 'water-name',
        type: 'symbol',
        source: 'omt',
        'source-layer': 'water_name',
        layout: {
          'text-field': ['coalesce', ['get', 'name:fr'], ['get', 'name']],
          'text-font': ['Noto Sans Italic'],
          'text-size': 13,
          'text-letter-spacing': 0.1,
        },
        paint: { 'text-color': p.waterLabel, 'text-halo-color': p.labelHalo, 'text-halo-width': 1 },
      },
      {
        id: 'road-name',
        type: 'symbol',
        source: 'omt',
        'source-layer': 'transportation_name',
        minzoom: 15,
        filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'tertiary', 'minor', 'trunk']]],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['coalesce', ['get', 'name:fr'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-max-angle': 30,
        },
        paint: { 'text-color': p.labelMuted, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.4 },
      },
      {
        id: 'place-name',
        type: 'symbol',
        source: 'omt',
        'source-layer': 'place',
        filter: ['in', ['get', 'class'], ['literal', ['town', 'village', 'suburb', 'neighbourhood', 'quarter', 'city']]],
        layout: {
          'text-field': ['coalesce', ['get', 'name:fr'], ['get', 'name']],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 16, 14],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.12,
        },
        paint: { 'text-color': p.labelMuted, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.5 },
      },
    ],
  };
}

/** Repli raster si les tuiles vectorielles sont inaccessibles (réseau filtré, quota…). */
export function fallbackStyle(theme: 'light' | 'dark'): StyleSpecification {
  const flavour = theme === 'dark' ? 'dark_all' : 'voyager';
  return {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tiles: ['a', 'b', 'c', 'd'].map((s) => `https://${s}.basemaps.cartocdn.com/rastertiles/${flavour}/{z}/{x}/{y}@2x.png`),
        tileSize: 256,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
      },
    },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': PALETTES[theme].land } },
      { id: 'carto', type: 'raster', source: 'carto' },
    ],
  };
}
