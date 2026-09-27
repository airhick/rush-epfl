import { readFileSync } from 'node:fs';
import type { PlaceMedia, PlacePhoto, PlaceReview } from '../../shared/types';

/**
 * Photos et avis Google Maps des spots, relevés une fois (voir
 * server/data/google-places.json) : aucune clé d'API n'est nécessaire.
 * Chaque photo et chaque avis restent crédités à leur auteur, avec un lien
 * vers la fiche Google Maps.
 */

interface Snapshot {
  fetchedAt: string;
  places: Record<
    string,
    { name: string; mapsUrl: string; rating: number | null; ratingCount: number; photos: PlacePhoto[]; reviews: PlaceReview[] }
  >;
}

const snapshot: Snapshot = JSON.parse(readFileSync(new URL('../data/google-places.json', import.meta.url), 'utf8'));

export function placeMedia(spotId: string): PlaceMedia | null {
  const place = snapshot.places[spotId];
  if (!place) return null;
  return {
    ...place,
    fetchedAt: snapshot.fetchedAt,
    // Les avis les plus récents d'abord.
    reviews: [...place.reviews].sort((a, b) => b.date.localeCompare(a.date)),
  };
}

export const hasPlaceMedia = (spotId: string) => spotId in snapshot.places;
