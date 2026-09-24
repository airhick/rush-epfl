import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import maplibregl, { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from 'geojson';
import { Flag } from 'lucide-react';
import { SPOTS, type Spot } from '../../shared/catalog';
import { EPFL_CENTER, type LatLng } from '../../shared/geo';
import { openStatus } from '../../shared/hours';
import { buildStyle, fallbackStyle } from './style';
import { MapMarker } from './MapMarker';
import { setMap } from './instance';
import { useScene, type Camera, type RouteLine } from '../state/scene';
import { useGeo } from '../state/location';
import { useLayout } from '../state/ui';
import { useActivity } from '../lib/queries';
import { useResolvedTheme } from '../lib/theme';
import { useIsDesktop } from '../lib/useMedia';
import { GLYPHS } from '../lib/spotStyle';
import { Avatar, cx } from '../ui/primitives';

const CUSTOM_STYLE = import.meta.env.VITE_MAP_STYLE as string | undefined;
const BOUNDS: [[number, number], [number, number]] = [
  [6.5, 46.49],
  [6.64, 46.55],
];
const LABEL_ZOOM = 15.7;
const ALL_LABELS_ZOOM = 16.8;

const INK = { light: '#000000', dark: '#FFFFFF' };
const CASING = { light: '#FFFFFF', dark: '#1D1E20' };

function styleFor(theme: 'light' | 'dark', fallback: boolean): StyleSpecification | string {
  if (CUSTOM_STYLE) return CUSTOM_STYLE;
  return fallback ? fallbackStyle(theme) : buildStyle(theme);
}

function addOverlay(map: maplibregl.Map, theme: 'light' | 'dark') {
  if (map.getSource('rush-routes')) return;
  map.addSource('rush-routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const byStyle = (s: RouteLine['style']) => ['==', ['get', 'style'], s] as maplibregl.FilterSpecification;
  map.addLayer({
    id: 'rush-route-ghost',
    type: 'line',
    source: 'rush-routes',
    filter: byStyle('ghost'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': INK[theme], 'line-opacity': 0.28, 'line-width': 2, 'line-dasharray': [2, 2] },
  });
  map.addLayer({
    id: 'rush-route-casing',
    type: 'line',
    source: 'rush-routes',
    filter: ['!=', ['get', 'style'], 'ghost'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': CASING[theme], 'line-width': 9, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'rush-route-approach',
    type: 'line',
    source: 'rush-routes',
    filter: byStyle('approach'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': INK[theme], 'line-width': 4.5, 'line-dasharray': [0.01, 2] },
  });
  map.addLayer({
    id: 'rush-route-active',
    type: 'line',
    source: 'rush-routes',
    filter: byStyle('active'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': INK[theme], 'line-width': 4.5 },
  });
}

function toFeatures(routes: RouteLine[] = []): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: routes.map((r) => ({
      type: 'Feature',
      properties: { id: r.id, style: r.style },
      geometry: { type: 'LineString', coordinates: r.points.map((p) => [p.lng, p.lat]) },
    })),
  };
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMapState] = useState<maplibregl.Map | null>(null);
  const [labels, setLabels] = useState(0);
  const theme = useResolvedTheme();
  const themeRef = useRef(theme);
  const fallback = useRef(false);
  const desktop = useIsDesktop();

  const scene = useScene((s) => s.scene);
  const hoverSpotId = useScene((s) => s.hoverSpotId);
  const onDropoffMove = useScene((s) => s.onDropoffMove);
  const onRequestClick = useScene((s) => s.onRequestClick);
  const insets = useLayout((s) => s.insets);
  const geo = useGeo();
  const { data: activity } = useActivity();
  const navigate = useNavigate();

  /* Initialisation, une seule fois. */
  useEffect(() => {
    if (!container.current) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: styleFor(themeRef.current, false),
      center: [EPFL_CENTER.lng, EPFL_CENTER.lat],
      zoom: 15.5,
      minZoom: 12.5,
      maxZoom: 19.5,
      maxBounds: BOUNDS,
      attributionControl: false,
      fadeDuration: 120,
      maxPitch: 60,
    });
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    m.touchZoomRotate.disableRotation();

    let tiles = false;
    m.on('data', (e) => {
      if (e.dataType === 'source' && (e as maplibregl.MapSourceDataEvent).sourceId === 'omt' && (e as maplibregl.MapSourceDataEvent).tile) tiles = true;
    });
    // Si les tuiles vectorielles ne répondent pas, on bascule sur un fond raster.
    const watchdog = window.setTimeout(() => {
      if (!tiles && !CUSTOM_STYLE && !fallback.current) {
        fallback.current = true;
        m.setStyle(styleFor(themeRef.current, true));
      }
    }, 7000);

    m.on('style.load', () => {
      addOverlay(m, themeRef.current);
      const src = m.getSource('rush-routes') as GeoJSONSource | undefined;
      src?.setData(toFeatures(useScene.getState().scene.routes));
    });
    // Libellés progressifs : spots ouverts d'abord, tous les spots en zoomant davantage.
    const labelLevel = () => setLabels(m.getZoom() >= ALL_LABELS_ZOOM ? 2 : m.getZoom() >= LABEL_ZOOM ? 1 : 0);
    m.on('zoom', labelLevel);
    // Les marqueurs DOM n'ont pas besoin d'attendre les tuiles : ils s'affichent tout de suite.
    labelLevel();
    setMapState(m);
    setMap(m);

    return () => {
      window.clearTimeout(watchdog);
      setMap(null);
      m.remove();
    };
  }, []);

  /* Changement de thème : on recharge le style, les calques maison sont réinjectés. */
  useEffect(() => {
    if (themeRef.current === theme) return;
    themeRef.current = theme;
    map?.setStyle(styleFor(theme, fallback.current));
  }, [theme, map]);

  /* Trajets. */
  useEffect(() => {
    const src = map?.getSource('rush-routes') as GeoJSONSource | undefined;
    src?.setData(toFeatures(scene.routes));
  }, [map, scene.routes]);

  /* Caméra. */
  const padding = useMemo(() => {
    const base = desktop ? 72 : 36;
    return {
      top: insets.top + base,
      right: insets.right + base,
      bottom: insets.bottom + base,
      left: insets.left + base,
    };
  }, [insets, desktop]);

  useEffect(() => {
    if (!map) return;
    applyCamera(map, scene.camera, padding);
    // La caméra ne bouge que si la scène change de clé ou si la zone visible change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, scene.cameraKey, padding]);

  const activityBySpot = useMemo(() => new Map((activity ?? []).map((a) => [a.spotId, a])), [activity]);
  const now = new Date();

  /* Libellés qui se chevauchent : on garde les plus utiles, les autres reviennent en zoomant. */
  const [hiddenLabels, setHiddenLabels] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!map) return;
    const date = new Date();
    const priority = (s: Spot) => {
      if (scene.focusSpotIds && !scene.focusSpotIds.includes(s.id)) return -1;
      if (scene.highlightSpotId === s.id || hoverSpotId === s.id) return 4;
      if (!openStatus(s.hours, date).open) return 0;
      return (activityBySpot.get(s.id)?.rushers.length ?? 0) > 0 ? 2 : 1;
    };
    const compute = () => {
      const visible = SPOTS.filter((s) => priority(s) >= 0);
      const points = new Map(visible.map((s) => [s.id, map.project([s.lng, s.lat])]));
      const bubbles = visible.map((s) => {
        const p = points.get(s.id)!;
        return { id: s.id, x1: p.x - 14, x2: p.x + 14, y1: p.y - 14, y2: p.y + 14 };
      });
      const placed: { x1: number; x2: number; y1: number; y2: number }[] = [];
      const hidden = new Set<string>();
      const hits = (a: (typeof placed)[number], b: (typeof placed)[number]) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
      for (const s of [...visible].sort((a, b) => priority(b) - priority(a))) {
        const p = points.get(s.id)!;
        const half = (s.name.length * 6.4 + 8) / 2;
        const label = { x1: p.x - half, x2: p.x + half, y1: p.y + 15, y2: p.y + 31 };
        const blocked = placed.some((r) => hits(r, label)) || bubbles.some((b) => b.id !== s.id && hits(b, label));
        if (blocked && priority(s) < 4) hidden.add(s.id);
        else placed.push(label);
      }
      setHiddenLabels((prev) => (prev.size === hidden.size && [...hidden].every((id) => prev.has(id)) ? prev : hidden));
    };
    compute();
    map.on('moveend', compute);
    map.on('resize', compute);
    return () => {
      map.off('moveend', compute);
      map.off('resize', compute);
    };
  }, [map, scene.focusSpotIds, scene.highlightSpotId, hoverSpotId, activityBySpot]);

  return (
    <div className={cx('map', labels > 0 && 'map--labels', labels > 1 && 'map--labels-all', scene.focusSpotIds && 'map--focus')}>
      <div ref={container} className="map__canvas" />
      {map && (
        <>
          {SPOTS.map((spot) => {
            const focused = scene.focusSpotIds?.includes(spot.id);
            const dim = scene.focusSpotIds ? !focused : false;
            const selected = scene.highlightSpotId === spot.id || hoverSpotId === spot.id;
            return (
              <MapMarker key={spot.id} map={map} position={spot} zIndex={selected ? 3 : focused ? 2 : 1}>
                <SpotPin
                  spot={spot}
                  selected={selected}
                  dim={dim}
                  closed={!openStatus(spot.hours, now).open}
                  labelHidden={hiddenLabels.has(spot.id)}
                  rushers={activityBySpot.get(spot.id)?.rushers.length ?? 0}
                  onClick={() => navigate(`/spot/${spot.id}`)}
                />
              </MapMarker>
            );
          })}

          {scene.requests?.map((r) => (
            <MapMarker key={r.id} map={map} position={r} anchor="bottom" zIndex={r.selected ? 6 : 5}>
              <button className={cx('req-pin', r.selected && 'is-selected')} onClick={() => onRequestClick?.(r.id)}>
                {r.label}
              </button>
            </MapMarker>
          ))}

          {scene.destination && (
            <MapMarker map={map} position={scene.destination} anchor="bottom" zIndex={4}>
              <div className="dest-pin">
                <Flag size={13} strokeWidth={2.4} />
                <span>{scene.destination.label}</span>
              </div>
            </MapMarker>
          )}

          {scene.dropoff && (
            <MapMarker
              map={map}
              position={scene.dropoff}
              anchor="bottom"
              draggable={scene.dropoff.draggable}
              onDragEnd={(p) => onDropoffMove?.(p)}
              zIndex={8}
            >
              <div className={cx('drop-pin', scene.dropoff.draggable && 'is-draggable')}>
                <span className="drop-pin__label">{scene.dropoff.label}</span>
                <span className="drop-pin__head" />
                <span className="drop-pin__stem" />
              </div>
            </MapMarker>
          )}

          {geo.status === 'live' && (
            <MapMarker map={map} position={geo.position} zIndex={7} glide={900}>
              <div className="me-dot" />
            </MapMarker>
          )}

          {scene.courier && (
            <MapMarker map={map} position={scene.courier} zIndex={9} glide={1400}>
              <div className="courier-pin">
                <span className="courier-pin__pulse" />
                <Avatar user={scene.courier.user} size={34} ring />
              </div>
            </MapMarker>
          )}
        </>
      )}
    </div>
  );
}

function SpotPin({
  spot,
  selected,
  dim,
  closed,
  labelHidden,
  rushers,
  onClick,
}: {
  spot: Spot;
  selected: boolean;
  dim: boolean;
  closed: boolean;
  labelHidden: boolean;
  rushers: number;
  onClick: () => void;
}) {
  const Icon = GLYPHS[spot.glyph];
  return (
    <button
      className={cx('spot-pin', selected && 'is-selected', dim && 'is-dim', closed && 'is-closed', labelHidden && 'is-label-hidden')}
      onClick={onClick}
      aria-label={spot.name}
    >
      <span className="spot-pin__bubble">
        <Icon strokeWidth={2} />
      </span>
      {rushers > 0 && !closed && <span className="spot-pin__live">{rushers}</span>}
      <span className="spot-pin__label">{spot.name}</span>
    </button>
  );
}

function applyCamera(map: maplibregl.Map, camera: Camera, padding: maplibregl.PaddingOptions) {
  const opts = { padding, duration: 900, essential: true } as const;
  if (camera.kind === 'fly') {
    map.flyTo({ ...opts, center: [camera.center.lng, camera.center.lat], zoom: camera.zoom, pitch: camera.pitch ?? 0, bearing: 0, speed: 1.4 });
    return;
  }
  const points: LatLng[] = camera.kind === 'fit' ? camera.points : SPOTS.filter((s) => s.area === 'EPFL');
  if (points.length === 0) return;
  if (points.length === 1) {
    map.flyTo({ ...opts, center: [points[0].lng, points[0].lat], zoom: 17, pitch: 0, bearing: 0 });
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  for (const p of points) bounds.extend([p.lng, p.lat]);
  map.fitBounds(bounds, { ...opts, pitch: 0, maxZoom: camera.kind === 'fit' ? camera.maxZoom ?? 17.2 : 16.4 });
}
