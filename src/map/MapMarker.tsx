import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import maplibregl from 'maplibre-gl';
import type { LatLng } from '../../shared/geo';

interface MapMarkerProps {
  map: maplibregl.Map;
  position: LatLng;
  anchor?: maplibregl.PositionAnchor;
  draggable?: boolean;
  onDragEnd?: (p: LatLng) => void;
  /** Interpole les déplacements (position GPS d'un rusher) au lieu de sauter. */
  glide?: number;
  className?: string;
  zIndex?: number;
  children: ReactNode;
}

/** Marqueur DOM de MapLibre dont le contenu est rendu par React. */
export function MapMarker({ map, position, anchor = 'center', draggable, onDragEnd, glide, className, zIndex, children }: MapMarkerProps) {
  const el = useMemo(() => document.createElement('div'), []);
  const marker = useRef<maplibregl.Marker | null>(null);
  const current = useRef<LatLng>(position);
  const dragEnd = useRef(onDragEnd);
  dragEnd.current = onDragEnd;

  useEffect(() => {
    const m = new maplibregl.Marker({ element: el, anchor }).setLngLat([position.lng, position.lat]).addTo(map);
    m.on('dragend', () => {
      const ll = m.getLngLat();
      current.current = { lat: ll.lat, lng: ll.lng };
      dragEnd.current?.({ lat: ll.lat, lng: ll.lng });
    });
    marker.current = m;
    return () => {
      m.remove();
      marker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, el, anchor]);

  useEffect(() => {
    marker.current?.setDraggable(Boolean(draggable));
  }, [draggable]);

  // MapLibre pose ses propres classes sur l'élément : on ajoute les nôtres sans les écraser.
  useEffect(() => {
    const classes = className?.split(' ').filter(Boolean) ?? [];
    el.classList.add(...classes);
    return () => el.classList.remove(...classes);
  }, [el, className]);

  useEffect(() => {
    if (zIndex !== undefined) el.style.zIndex = String(zIndex);
  }, [el, zIndex]);

  useEffect(() => {
    const m = marker.current;
    if (!m) return;
    const from = current.current;
    const to = position;
    if (from.lat === to.lat && from.lng === to.lng) return;
    if (!glide) {
      current.current = to;
      m.setLngLat([to.lng, to.lat]);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / glide);
      const e = t * (2 - t);
      const p = { lat: from.lat + (to.lat - from.lat) * e, lng: from.lng + (to.lng - from.lng) * e };
      current.current = p;
      m.setLngLat([p.lng, p.lat]);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [position.lat, position.lng, glide]); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(children, el);
}
