import { week, type WeekHours } from './hours';
import type { LatLng } from './geo';

/**
 * Catalogue des spots de graille.
 *
 * Les coordonnées sont positionnées à la main sur le plan du campus et les
 * prix sont indicatifs (tarifs publics constatés, arrondis). Tout vit ici
 * pour que le client et le serveur partagent exactement les mêmes données :
 * le serveur recalcule toujours les montants à partir de ce fichier et ne
 * fait jamais confiance aux prix envoyés par le navigateur.
 */

export type SpotKind = 'restaurant' | 'cafe' | 'cafeteria' | 'bar' | 'foodtruck' | 'grocery' | 'vending';
export type SpotGlyph =
  | 'utensils'
  | 'coffee'
  | 'sandwich'
  | 'beer'
  | 'truck'
  | 'basket'
  | 'soda'
  | 'pizza'
  | 'burger'
  | 'icecream'
  | 'salad'
  | 'croissant';

export type ItemTag = 'vege' | 'vegan' | 'hot' | 'popular';

export interface MenuItem {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  tags?: ItemTag[];
  /** Aucun prix public trouvé : estimation à confirmer sur place. */
  est?: boolean;
}

export interface MenuSection {
  title: string;
  items: MenuItem[];
}

export interface Spot extends LatLng {
  id: string;
  name: string;
  kind: SpotKind;
  glyph: SpotGlyph;
  /** Bâtiment ou repère, tel qu'on le dit sur le campus. */
  place: string;
  area: 'EPFL';
  tagline: string;
  priceLevel: 1 | 2 | 3;
  hours: WeekHours;
  /** Horaires relevés sur une source officielle, ou horaires typiques. */
  hoursVerified: boolean;
  priceNote?: string;
  /** D'où viennent les informations affichées (crédité dans l'app). */
  sources: SourceRef[];
  /** Note publique d'un service tiers, affichée avec sa source. */
  rating?: ExternalRating;
  checkedAt: string;
  menu: MenuSection[];
}

export interface SourceRef {
  label: string;
  url: string;
}

export interface ExternalRating {
  value: number;
  source: string;
  url: string;
}

export const KIND_LABEL: Record<SpotKind, string> = {
  restaurant: 'Restaurant',
  cafe: 'Café',
  cafeteria: 'Cafétéria',
  bar: 'Bar',
  foodtruck: 'Food truck',
  grocery: 'Supermarché',
  vending: 'Distributeurs',
};

const item = (id: string, name: string, price: number, extra: Partial<MenuItem> = {}): MenuItem => ({
  id,
  name,
  priceCents: Math.round(price * 100),
  ...extra,
});

/* ── Sources publiques utilisées pour le catalogue (relevé de septembre 2026) ── */

const EPFL_MENU = { label: 'EPFL · Offre du jour', url: 'https://www.epfl.ch/campus/restaurants-shops-hotels/fr/offre-du-jour-de-tous-les-points-de-restauration/' };
const EPFL_HOURS = { label: 'EPFL · Horaires', url: 'https://www.epfl.ch/campus/restaurants-shops-hotels/fr/restauration/horaires-points-de-restauration' };
const EPFL_SELF = (slug: string) => ({ label: 'EPFL · Fiche du restaurant', url: `https://www.epfl.ch/campus/restaurants-shops-hotels/${slug}` });
const CHECKED = '2026-09';

/** Prix estimé : pas de source publique, à confirmer sur place. */
const est = { est: true } as const;

export const SPOTS: Spot[] = [
  /* ── Cœur du campus ─────────────────────────────────────────────────── */
  {
    id: 'foodlab',
    name: 'FoodLab',
    kind: 'restaurant',
    glyph: 'utensils',
    place: 'CM · 2e étage',
    area: 'EPFL',
    lat: 46.5192,
    lng: 6.5665,
    tagline: 'Trois comptoirs : Alpine, Native (végé) et Ginko',
    priceLevel: 1,
    hours: week.weekdays(['11:15', '14:00']),
    hoursVerified: false,
    priceNote: 'Menus au prix étudiant publié par l’EPFL ; le personnel paie plus.',
    sources: [EPFL_SELF('self-service-2/foodlab-alpine/'), EPFL_MENU, EPFL_HOURS],
    checkedAt: CHECKED,
    menu: [
      {
        title: 'Alpine',
        items: [item('fl-alpine', 'Menu Alpine (prix étudiant)', 8.6, { description: 'Plat du jour, voir l’offre du jour EPFL', tags: ['hot', 'popular'] })],
      },
      {
        title: 'Native · végétarien',
        items: [item('fl-native', 'Menu Native (prix étudiant)', 8.1, { tags: ['hot', 'vege'], ...est })],
      },
      {
        title: 'Ginko · sushis et asiatique',
        items: [
          item('fl-ginko-wok', 'Plat wok du jour', 12.5, { tags: ['hot'], ...est }),
          item('fl-ginko-sushi', 'Box sushis', 12.9, est),
        ],
      },
    ],
  },
  {
    id: 'arcadie',
    name: "L'Arcadie",
    kind: 'cafeteria',
    glyph: 'croissant',
    place: 'MX · Rez',
    area: 'EPFL',
    lat: 46.51775,
    lng: 6.5648,
    tagline: 'Menus du midi, viennoiseries, café',
    priceLevel: 1,
    hours: week.weekdays(['07:00', '17:00']),
    hoursVerified: true,
    priceNote: 'Menus au prix étudiant publié par l’EPFL (service de midi 11h30–14h).',
    sources: [EPFL_SELF('cafeteria-2/arcadie'), EPFL_MENU, EPFL_HOURS],
    checkedAt: CHECKED,
    menu: [
      {
        title: 'Menus de midi',
        items: [
          item('arc-menu1', 'Menu 1 (prix étudiant)', 8.1, { tags: ['hot', 'popular'] }),
          item('arc-menu2', 'Menu 2 (prix étudiant)', 8.5, { tags: ['hot'] }),
        ],
      },
      {
        title: 'Cafétéria',
        items: [
          item('arc-croissant', 'Croissant au beurre', 1.6, est),
          item('arc-sandwich', 'Sandwich', 6.2, est),
          item('arc-cafe', 'Café', 2.2, { tags: ['hot'], ...est }),
        ],
      },
    ],
  },
  {
    id: 'giacometti',
    name: 'Le Giacometti',
    kind: 'cafeteria',
    glyph: 'sandwich',
    place: 'SG',
    area: 'EPFL',
    lat: 46.5193,
    lng: 6.5638,
    tagline: 'Sandwichs, salades et café',
    priceLevel: 1,
    hours: week.weekdays(['08:00', '17:00']),
    hoursVerified: true,
    sources: [EPFL_SELF('?p=133'), EPFL_HOURS],
    checkedAt: CHECKED,
    menu: [
      {
        title: 'À emporter',
        items: [
          item('gia-sandwich', 'Sandwich du jour', 6.5, { tags: ['popular'], ...est }),
          item('gia-salade', 'Salade bowl', 9.5, { tags: ['vege'], ...est }),
          item('gia-cafe', 'Café', 2.2, { tags: ['hot'], ...est }),
          item('gia-cookie', 'Cookie', 2.5, est),
        ],
      },
    ],
  },
  {
    id: 'ornithorynque',
    name: "L'Ornithorynque",
    kind: 'cafeteria',
    glyph: 'sandwich',
    place: 'CE',
    area: 'EPFL',
    lat: 46.51925,
    lng: 6.5682,
    tagline: 'Self-service et cafétéria',
    priceLevel: 1,
    hours: week.weekdays(['07:30', '17:00']),
    hoursVerified: false,
    sources: [EPFL_SELF('self-service-2/ornithorynque/'), EPFL_MENU, EPFL_HOURS],
    checkedAt: CHECKED,
    menu: [
      {
        title: 'Midi',
        items: [item('orn-menu', 'Menu du jour (prix étudiant)', 8.1, { tags: ['hot', 'popular'], ...est })],
      },
      {
        title: 'Cafétéria',
        items: [
          item('orn-panini', 'Panini', 7.5, { tags: ['hot'], ...est }),
          item('orn-muffin', 'Muffin', 3.2, est),
          item('orn-cafe', 'Café', 2.2, { tags: ['hot'], ...est }),
        ],
      },
    ],
  },
  {
    id: 'piano',
    name: 'Piano',
    kind: 'restaurant',
    glyph: 'pizza',
    place: 'Ex-Corbusier',
    area: 'EPFL',
    lat: 46.5195,
    lng: 6.5643,
    tagline: 'Carte 100 % italienne signée par un chef italien',
    priceLevel: 1,
    hours: week.weekdays(['11:30', '14:00']),
    hoursVerified: false,
    sources: [EPFL_MENU, EPFL_HOURS],
    checkedAt: CHECKED,
    menu: [
      {
        title: 'Cucina',
        items: [
          item('pia-pasta', 'Pâtes du jour', 9.5, { tags: ['hot', 'popular'], ...est }),
          item('pia-pizza', 'Pizza', 11.0, { tags: ['hot'], ...est }),
          item('pia-tiramisu', 'Tiramisù', 4.5, est),
        ],
      },
    ],
  },
  {
    id: 'hopper',
    name: 'Hopper',
    kind: 'restaurant',
    glyph: 'burger',
    place: 'BC · ex-Cafétéria BC',
    area: 'EPFL',
    lat: 46.5185,
    lng: 6.5613,
    tagline: 'Diner : on commande, on personnalise et on paie en ligne',
    priceLevel: 2,
    hours: week.weekdays(['11:00', '14:30']),
    hoursVerified: false,
    sources: [EPFL_MENU, EPFL_HOURS],
    checkedAt: CHECKED,
    menu: [
      {
        title: 'Diner',
        items: [
          item('hop-burger', 'Burger', 13.5, { tags: ['hot', 'popular'], ...est }),
          item('hop-bowl', 'Bowl', 12.5, est),
          item('hop-frites', 'Frites', 4.5, { tags: ['hot', 'vegan'], ...est }),
        ],
      },
    ],
  },
  {
    id: 'niki',
    name: 'Niki',
    kind: 'cafe',
    glyph: 'croissant',
    place: 'ELA · ex-cafétéria ELA',
    area: 'EPFL',
    lat: 46.5176,
    lng: 6.562,
    tagline: 'Salon de thé : crêpes, gaufres, thés en vrac',
    priceLevel: 1,
    hours: week.weekdays(['08:00', '16:00']),
    hoursVerified: false,
    sources: [EPFL_SELF('cafeteria-2/cafeteria-niki'), EPFL_HOURS],
    checkedAt: CHECKED,
    menu: [
      {
        title: 'Salon de thé',
        items: [
          item('nik-crepe', 'Crêpe sucrée', 5.0, { tags: ['hot', 'popular'], ...est }),
          item('nik-gaufre', 'Gaufre', 4.5, { tags: ['hot'], ...est }),
          item('nik-the', 'Thé en vrac', 3.0, { tags: ['hot', 'vegan'], ...est }),
        ],
      },
    ],
  },
  {
    id: 'zaha',
    name: 'Zaha',
    kind: 'cafeteria',
    glyph: 'coffee',
    place: 'INM · ex-cafétéria INM',
    area: 'EPFL',
    lat: 46.5183,
    lng: 6.56315,
    tagline: 'Cafétéria, fermée le vendredi',
    priceLevel: 1,
    hours: [[], [['08:30', '15:00']], [['08:30', '15:00']], [['08:30', '15:00']], [['08:30', '15:00']], [], []],
    hoursVerified: true,
    sources: [EPFL_SELF('cafeteria-2/zaha'), EPFL_HOURS],
    checkedAt: CHECKED,
    menu: [
      {
        title: 'Cafétéria',
        items: [
          item('zah-cafe', 'Café', 2.2, { tags: ['hot', 'popular'], ...est }),
          item('zah-sandwich', 'Sandwich', 6.2, est),
          item('zah-viennoiserie', 'Viennoiserie', 1.8, est),
        ],
      },
    ],
  },
  {
    id: 'satellite',
    name: 'Satellite',
    kind: 'bar',
    glyph: 'beer',
    place: 'Esplanade',
    area: 'EPFL',
    lat: 46.52075,
    lng: 6.56585,
    tagline: 'Le bar des étudiant·e·s',
    priceLevel: 1,
    hours: week.custom([['08:00', '24:00']], [['17:00', '24:00']]),
    hoursVerified: false,
    sources: [EPFL_HOURS],
    checkedAt: CHECKED,
    menu: [
      {
        title: 'À boire',
        items: [
          item('sat-cafe', 'Café', 1.5, { tags: ['hot', 'popular'], ...est }),
          item('sat-pression', 'Bière pression 25 cl', 3.5, est),
          item('sat-pinte', 'Bière pression 50 cl', 6.0, est),
        ],
      },
      {
        title: 'À grignoter',
        items: [
          item('sat-hotdog', 'Hot-dog', 4.5, { tags: ['hot'], ...est }),
          item('sat-chips', 'Chips', 2.0, { tags: ['vegan'], ...est }),
        ],
      },
    ],
  },
  {
    id: 'klee',
    name: 'Le Klee',
    kind: 'cafe',
    glyph: 'coffee',
    place: 'Rolex Learning Center',
    area: 'EPFL',
    lat: 46.51845,
    lng: 6.5683,
    tagline: 'La cafétéria du Rolex Learning Center',
    priceLevel: 1,
    hours: week.weekdays(['08:00', '18:00']),
    hoursVerified: false,
    sources: [EPFL_HOURS],
    checkedAt: CHECKED,
    menu: [
      {
        title: 'Pour réviser',
        items: [
          item('kle-cafe', 'Café', 2.2, { tags: ['hot', 'popular'], ...est }),
          item('kle-sandwich', 'Sandwich', 6.5, est),
          item('kle-brownie', 'Brownie', 3.2, est),
        ],
      },
    ],
  },
  {
    id: 'foodtrucks',
    name: 'Food trucks Cosandey',
    kind: 'foodtruck',
    glyph: 'truck',
    place: 'Place Cosandey · face à l’Agora',
    area: 'EPFL',
    lat: 46.5196,
    lng: 6.5676,
    tagline: 'Six trucks depuis juin 2025',
    priceLevel: 2,
    hours: week.weekdays(['11:30', '14:00']),
    hoursVerified: true,
    sources: [{ label: 'EPFL · Food trucks', url: 'https://www.epfl.ch/campus/restaurants-shops-hotels/food-truck/' }],
    checkedAt: CHECKED,
    menu: [
      { title: 'NAS Burger', items: [item('ft-nas-burger', 'Burger', 14.0, { tags: ['hot', 'popular'], ...est })] },
      { title: 'NAS Sandwich', items: [item('ft-nas-sandwich', 'Sandwich', 9.0, est)] },
      { title: 'Li Beirut', items: [item('ft-beirut', 'Pita falafel', 11.0, { tags: ['vegan'], ...est })] },
      { title: 'Manira Wokshop', items: [item('ft-wok', 'Wok', 14.0, { tags: ['hot'], ...est })] },
      { title: 'Cut Pizza', items: [item('ft-pizza', 'Part de pizza', 6.0, { tags: ['hot'], ...est })] },
      { title: 'Regal Tandoori', items: [item('ft-tandoori', 'Curry & riz', 14.0, { tags: ['hot'], ...est })] },
    ],
  },
  {
    id: 'puur',
    name: 'Puur',
    kind: 'cafeteria',
    glyph: 'salad',
    place: 'Innovation Park',
    area: 'EPFL',
    lat: 46.5165,
    lng: 6.562,
    tagline: 'Le self-service au centre de l’Innovation Park',
    priceLevel: 1,
    hours: week.weekdays(['11:30', '14:00']),
    hoursVerified: false,
    sources: [EPFL_SELF('self-service-2/puur/'), EPFL_MENU, EPFL_HOURS],
    checkedAt: CHECKED,
    menu: [
      {
        title: 'Midi',
        items: [
          item('puu-menu', 'Menu du jour (prix étudiant)', 8.1, { tags: ['hot', 'popular'], ...est }),
          item('puu-salade', 'Salade', 9.0, { tags: ['vege'], ...est }),
        ],
      },
    ],
  },

  /* ── Quartier Nord · Les Arcades (route Louis-Favre) ────────────────── */
  {
    id: 'holy-cow-epfl',
    name: 'Holy Cow!',
    kind: 'restaurant',
    glyph: 'burger',
    place: 'Les Arcades · Louis-Favre 8d',
    area: 'EPFL',
    lat: 46.52258,
    lng: 6.56562,
    tagline: 'Burgers au bœuf suisse, à côté du métro',
    priceLevel: 2,
    hours: week.everyday(['11:00', '23:00']),
    hoursVerified: true,
    priceNote: 'Menus (burger, frites, boisson) entre CHF 20 et 22 selon Holy Cow! ; prix à l’unité estimés.',
    sources: [{ label: 'holycow.ch', url: 'https://holycow.ch/en/restaurantsen/holy-cow-lausanne-epfl/' }],
    rating: {
      value: 3.1,
      source: 'Tripadvisor',
      url: 'https://www.tripadvisor.com/Restaurant_Review-g2216629-d10326724-Reviews-Holy_Cow_Gourmet_Burger_Co_LAUSANNE_EPFL-Ecublens_Canton_of_Vaud.html',
    },
    checkedAt: CHECKED,
    menu: [
      {
        title: 'Burgers',
        items: [
          item('hc-holycow', 'Holy Cow!', 14.9, { description: 'Bœuf suisse, ketchup, oignons caramélisés', tags: ['hot', 'popular'], ...est }),
          item('hc-cheese', 'Cheddar', 15.9, { description: 'Bœuf suisse, cheddar', tags: ['hot'], ...est }),
          item('hc-chicken', 'Poulet', 15.4, { description: 'Poulet suisse, mayo citron vert-basilic', tags: ['hot'], ...est }),
          item('hc-veggie', 'Veggie', 14.4, { tags: ['hot', 'vege'], ...est }),
        ],
      },
      {
        title: 'À côté',
        items: [
          item('hc-frites', 'Frites', 5.9, { tags: ['hot', 'vegan', 'popular'], ...est }),
          item('hc-soda', 'Soda', 4.5, est),
        ],
      },
    ],
  },
  {
    id: 'gina',
    name: 'Gina Ristorante',
    kind: 'restaurant',
    glyph: 'pizza',
    place: 'Les Arcades · Louis-Favre 8c',
    area: 'EPFL',
    lat: 46.5227,
    lng: 6.56545,
    tagline: 'Pâtes fraîches et pizzas, plat du jour à midi',
    priceLevel: 3,
    hours: week.weekdays(['11:45', '14:00'], ['18:45', '21:30']),
    hoursVerified: true,
    priceNote: 'Plat et pizza du jour à CHF 19.50 à midi ; plats à la carte entre CHF 30 et 45.',
    sources: [{ label: 'gina-ristorante.ch', url: 'https://www.gina-ristorante.ch/' }],
    rating: {
      value: 4.0,
      source: 'Tripadvisor',
      url: 'https://www.tripadvisor.com/Restaurant_Review-g2216629-d5453722-Reviews-Gina_Ristorante-Ecublens_Canton_of_Vaud.html',
    },
    checkedAt: CHECKED,
    menu: [
      {
        title: 'Midi (du lundi au vendredi)',
        items: [
          item('gin-plat', 'Plat du jour', 19.5, { tags: ['hot', 'popular'] }),
          item('gin-pizza-jour', 'Pizza du jour', 19.5, { tags: ['hot'] }),
        ],
      },
      {
        title: 'À la carte',
        items: [item('gin-pates', 'Pâtes fraîches', 30.0, { tags: ['hot'], ...est })],
      },
    ],
  },
  {
    id: 'denner-epfl',
    name: 'Denner EPFL',
    kind: 'grocery',
    glyph: 'basket',
    place: 'Les Arcades · Louis-Favre 8b',
    area: 'EPFL',
    lat: 46.52283,
    lng: 6.56525,
    tagline: 'Boissons et snacks à petit prix',
    priceLevel: 1,
    hours: week.custom([['07:30', '20:00']], [['08:00', '18:00']]),
    hoursVerified: true,
    sources: [{ label: 'Denner · EPFL Les Arcades', url: 'https://www.denner.ch/fr/succursales/1024-ecublens-vd-epfl-les-arcades~s1145391' }],
    checkedAt: CHECKED,
    menu: [
      {
        title: 'Boissons',
        items: [
          item('den-coca', 'Coca-Cola 1.5 L', 1.95, { tags: ['popular'], ...est }),
          item('den-eau', 'Eau minérale 1.5 L', 0.55, est),
          item('den-icetea', 'Ice tea 1.5 L', 1.3, est),
          item('den-redbull', 'Red Bull 25 cl', 1.75, est),
        ],
      },
      {
        title: 'Snacks',
        items: [
          item('den-chips', 'Chips 175 g', 2.95, { tags: ['vegan'], ...est }),
          item('den-chocolat', 'Chocolat au lait 100 g', 1.4, est),
          item('den-sandwich', 'Sandwich', 3.6, est),
        ],
      },
    ],
  },
  {
    id: 'migros-epfl',
    name: 'Migros EPFL',
    kind: 'grocery',
    glyph: 'basket',
    place: 'Les Arcades · Louis-Favre 8a',
    area: 'EPFL',
    lat: 46.52309,
    lng: 6.56487,
    tagline: 'Le supermarché du campus',
    priceLevel: 1,
    hours: week.custom([['07:30', '20:00']], [['08:00', '18:00']]),
    hoursVerified: true,
    sources: [{ label: 'Migros · Ecublens EPFL', url: 'https://filialen.migros.ch/fr/supermarche-migros-ecublens-epfl/' }],
    checkedAt: CHECKED,
    menu: [
      {
        title: 'Sur le pouce',
        items: [
          item('mig-sandwich', 'Sandwich', 4.2, { tags: ['popular'], ...est }),
          item('mig-salade', 'Salade de pâtes', 4.95, { tags: ['vege'], ...est }),
          item('mig-sushi', 'Sushi box', 8.9, est),
        ],
      },
      {
        title: 'Boissons',
        items: [
          item('mig-eau', 'Eau minérale 1.5 L', 0.8, est),
          item('mig-coca', 'Coca-Cola 50 cl', 1.95, est),
          item('mig-latte', 'Café latte (gobelet)', 1.95, est),
        ],
      },
      {
        title: 'Fruits & douceurs',
        items: [
          item('mig-banane', 'Banane', 0.45, { tags: ['vegan'], ...est }),
          item('mig-pomme', 'Pomme', 0.7, { tags: ['vegan'], ...est }),
          item('mig-chocolat', 'Chocolat au lait 100 g', 1.8, est),
        ],
      },
    ],
  },
];

export interface Building extends LatLng {
  id: string;
  name: string;
  hint: string;
}

/** Points de livraison les plus demandés. On peut toujours ajuster l'épingle sur la carte. */
export const BUILDINGS: Building[] = [
  { id: 'BC', name: 'BC', hint: 'Informatique & Communications', lat: 46.51855, lng: 6.5616 },
  { id: 'INF', name: 'INF', hint: 'Informatique', lat: 46.51895, lng: 6.56305 },
  { id: 'INM', name: 'INM', hint: 'Informatique · auditoires', lat: 46.5183, lng: 6.56315 },
  { id: 'CE', name: 'CE', hint: 'Centre Est · auditoires', lat: 46.51945, lng: 6.5688 },
  { id: 'CM', name: 'CM', hint: 'Centre Midi', lat: 46.5192, lng: 6.5665 },
  { id: 'CO', name: 'CO', hint: 'Coupole · Esplanade', lat: 46.5201, lng: 6.5652 },
  { id: 'SG', name: 'SG', hint: 'Architecture', lat: 46.5194, lng: 6.5641 },
  { id: 'ME', name: 'ME', hint: 'Génie mécanique', lat: 46.5179, lng: 6.5634 },
  { id: 'MX', name: 'MX', hint: 'Science des matériaux', lat: 46.5177, lng: 6.565 },
  { id: 'MA', name: 'MA', hint: 'Mathématiques', lat: 46.5181, lng: 6.5656 },
  { id: 'PH', name: 'PH', hint: 'Physique', lat: 46.5172, lng: 6.5662 },
  { id: 'EL', name: 'EL', hint: 'Génie électrique', lat: 46.5176, lng: 6.562 },
  { id: 'GC', name: 'GC', hint: 'Génie civil', lat: 46.517, lng: 6.5642 },
  { id: 'CH', name: 'CH', hint: 'Chimie', lat: 46.5166, lng: 6.565 },
  { id: 'SV', name: 'SV', hint: 'Sciences de la vie', lat: 46.5212, lng: 6.5648 },
  { id: 'RLC', name: 'RLC', hint: 'Rolex Learning Center', lat: 46.51845, lng: 6.5683 },
  { id: 'STCC', name: 'STCC', hint: 'SwissTech Convention Center', lat: 46.52346, lng: 6.56401 },
  { id: 'ARC', name: 'Les Arcades', hint: 'Quartier Nord · logements et commerces', lat: 46.52286, lng: 6.5651 },
  { id: 'PO', name: 'Polydôme', hint: 'Examens & événements', lat: 46.52, lng: 6.568 },
  { id: 'IP', name: 'Innovation Park', hint: 'Start-ups', lat: 46.5165, lng: 6.562 },
  { id: 'M1', name: 'Métro EPFL', hint: 'Arrêt M1', lat: 46.52219, lng: 6.56611 },
];

export const SPOT_BY_ID = new Map(SPOTS.map((s) => [s.id, s]));

/** Spot d'une commande, même s'il a depuis été retiré du catalogue. */
export function spotOf(id: string): Spot {
  return (
    SPOT_BY_ID.get(id) ?? {
      id,
      name: 'Spot retiré',
      kind: 'restaurant',
      glyph: 'utensils',
      place: 'Plus au catalogue',
      area: 'EPFL',
      lat: 46.5195,
      lng: 6.5662,
      tagline: '',
      priceLevel: 1,
      hours: week.everyday(),
      hoursVerified: false,
      sources: [],
      checkedAt: '',
      menu: [],
    }
  );
}

export function findItem(spot: Spot, itemId: string): MenuItem | undefined {
  for (const section of spot.menu) {
    const found = section.items.find((i) => i.id === itemId);
    if (found) return found;
  }
  return undefined;
}

export function nearestBuilding(p: LatLng): Building {
  let best = BUILDINGS[0];
  let bestD = Infinity;
  for (const b of BUILDINGS) {
    const d = (b.lat - p.lat) ** 2 + ((b.lng - p.lng) * Math.cos((p.lat * Math.PI) / 180)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}
