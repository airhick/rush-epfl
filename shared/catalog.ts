import { week, type WeekHours } from './hours';
import type { LatLng } from './geo';
import { COVERS } from './covers';

/**
 * Catalogue des spots de graille.
 *
 * Aucun prix n'est estimé. Les restaurants de l'EPFL publient chaque jour
 * leurs menus et leurs prix exacts : le serveur les lit en direct (voir
 * server/services/epflMenus.ts) à partir des comptoirs listés dans `epfl`.
 * Les cartes fixes (`menu`) ne contiennent que des prix relevés sur une
 * source officielle. Partout ailleurs, on passe par une demande libre avec
 * un budget maximum, et le rusher déclare le ticket exact.
 *
 * Les horaires viennent de la page officielle de l'EPFL ou du site du
 * commerce. Tout vit ici pour que le client et le serveur partagent les
 * mêmes données.
 */

export type SpotKind = 'restaurant' | 'cafe' | 'cafeteria' | 'bar' | 'foodtruck' | 'grocery';
export type SpotGlyph = 'utensils' | 'coffee' | 'sandwich' | 'beer' | 'truck' | 'basket' | 'pizza' | 'burger' | 'salad' | 'croissant';

export type ItemTag = 'vege' | 'vegan';

/** Prix par statut, comme l'EPFL les publie (en centimes). */
export interface PriceTiers {
  student?: number;
  doctoral?: number;
  campus?: number;
  visitor?: number;
}

export interface MenuItem {
  id: string;
  name: string;
  description?: string;
  /** Montant réservé : le prix publié le plus élevé. 0 si l'article ne se commande pas. */
  priceCents: number;
  tiers?: PriceTiers;
  tags?: ItemTag[];
  allergens?: string[];
  /** Prix au poids (centimes les 100 g) : visible, mais pas commandable à l'avance. */
  per100gCents?: number;
}

export interface MenuSection {
  title: string;
  items: MenuItem[];
}

export interface SpotCover {
  url: string;
  credit: string;
  source: 'google' | 'epfl';
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
  hours: WeekHours;
  /** Comptoirs de l'offre du jour EPFL : nom publié par l'EPFL → titre de section. */
  epfl?: Record<string, string>;
  /** Carte fixe, prix exacts relevés sur une source officielle. */
  menu: MenuSection[];
  /** D'où viennent les informations affichées (crédité dans l'app). */
  sources: SourceRef[];
  cover?: SpotCover;
}

export interface SourceRef {
  label: string;
  url: string;
}

export const KIND_LABEL: Record<SpotKind, string> = {
  restaurant: 'Restaurant',
  cafe: 'Café',
  cafeteria: 'Cafétéria',
  bar: 'Bar',
  foodtruck: 'Food trucks',
  grocery: 'Épicerie',
};

const item = (id: string, name: string, price: number, extra: Partial<MenuItem> = {}): MenuItem => ({
  id,
  name,
  priceCents: Math.round(price * 100),
  ...extra,
});

/* ── Sources officielles (relevé du 24 septembre 2026) ─────────────────── */

export const EPFL_MENU_URL = 'https://www.epfl.ch/campus/restaurants-shops-hotels/fr/offre-du-jour-de-tous-les-points-de-restauration/';
const EPFL_MENU = { label: 'EPFL · Offre du jour', url: EPFL_MENU_URL };
const EPFL_HOURS = { label: 'EPFL · Horaires', url: 'https://www.epfl.ch/campus/restaurants-shops-hotels/fr/restauration/horaires-points-de-restauration/' };
const EPFL_PAGE = (path: string) => ({ label: 'EPFL · Fiche du point de vente', url: `https://www.epfl.ch/campus/restaurants-shops-hotels/fr/${path}` });
const EPFL = [EPFL_MENU, EPFL_HOURS];

/** Un seul comptoir : ses offres forment la section « Aujourd'hui ». */
const today = (epflName: string) => ({ [epflName]: 'Aujourd’hui' });

const SPOT_LIST: Omit<Spot, 'cover'>[] = [
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
    tagline: 'Trois comptoirs : Alpine, Native (végétal) et Ginko',
    hours: week.days(
      [],
      [['11:30', '14:00'], ['18:30', '20:30']],
      [['11:30', '14:00'], ['18:30', '20:30']],
      [['11:30', '14:00'], ['18:30', '20:30']],
      [['11:30', '13:30']],
      [['11:30', '16:30']],
    ),
    epfl: { Alpine: 'Alpine', 'Native-Restauration végétale - Bar à café': 'Native · végétal', Ginko: 'Ginko' },
    menu: [],
    sources: [EPFL_PAGE('restauration/self-service/food-lab/'), ...EPFL],
  },
  {
    id: 'arcadie',
    name: "L'Arcadie",
    kind: 'cafeteria',
    glyph: 'croissant',
    place: 'MX',
    area: 'EPFL',
    lat: 46.51775,
    lng: 6.5648,
    tagline: 'Cafétéria et menus de midi (11h30 à 14h)',
    hours: week.weekdays(['07:00', '17:00']),
    epfl: today('Arcadie'),
    menu: [],
    sources: [EPFL_PAGE('restauration/cafeteria/larcadie/'), ...EPFL],
  },
  {
    id: 'giacometti',
    name: 'Le Giacometti',
    kind: 'cafeteria',
    glyph: 'sandwich',
    place: 'SG',
    area: 'EPFL',
    lat: 46.52074,
    lng: 6.56448,
    tagline: 'Sandwichs, salades et café',
    hours: week.weekdays(['08:00', '17:00']),
    epfl: today('Giacometti'),
    menu: [],
    sources: [EPFL_PAGE('restauration/cafeteria/le-giacometti/'), ...EPFL],
  },
  {
    id: 'ornithorynque',
    name: "L'Ornithorynque",
    kind: 'cafeteria',
    glyph: 'utensils',
    place: 'CE',
    area: 'EPFL',
    lat: 46.51925,
    lng: 6.5682,
    tagline: 'Self-service, trois menus chaque midi',
    hours: week.weekdays(['11:30', '14:00']),
    epfl: today('Ornithorynque'),
    menu: [],
    sources: [EPFL_PAGE('restauration/self-service/ornithorynque/'), ...EPFL],
  },
  {
    id: 'piano',
    name: 'Piano',
    kind: 'restaurant',
    glyph: 'pizza',
    place: 'SG',
    area: 'EPFL',
    lat: 46.52095,
    lng: 6.56405,
    tagline: 'Self-service au SG, pizzas dès CHF 12',
    hours: week.weekdays(['11:30', '13:30']),
    epfl: today('Piano'),
    menu: [],
    sources: [
      EPFL_PAGE('restauration/self-service/le-corbusier/'),
      { label: 'EPFL · Carte des pizzas du Piano', url: 'https://www.epfl.ch/campus/restaurants-shops-hotels/wp-content/uploads/2025/01/Carte-pizzas-Piano-01.25.jpg' },
      ...EPFL,
    ],
  },
  {
    id: 'hopper',
    name: 'Hopper',
    kind: 'restaurant',
    glyph: 'utensils',
    place: 'BC',
    area: 'EPFL',
    lat: 46.51845,
    lng: 6.56208,
    tagline: 'Le self-service du BC',
    hours: week.weekdays(['08:00', '16:00']),
    epfl: today('Hopper'),
    menu: [],
    sources: [EPFL_PAGE('restauration/self-service/cafeteria-bc/'), ...EPFL],
  },
  {
    id: 'niki',
    name: 'Niki',
    kind: 'cafe',
    glyph: 'croissant',
    place: 'ELA',
    area: 'EPFL',
    lat: 46.51953,
    lng: 6.56452,
    tagline: 'Galettes, sandwichs et salades',
    hours: week.weekdays(['08:00', '16:00']),
    epfl: today('Niki'),
    menu: [],
    sources: [EPFL_PAGE('restauration/cafeteria/cafeteria-niki/'), ...EPFL],
  },
  {
    id: 'zaha',
    name: 'Zaha',
    kind: 'cafe',
    glyph: 'coffee',
    place: 'INM',
    area: 'EPFL',
    lat: 46.5183,
    lng: 6.56315,
    tagline: 'La cafétéria de l’INM',
    hours: week.weekdays(['08:30', '15:00']),
    epfl: today('Zaha'),
    menu: [],
    sources: [EPFL_PAGE('restauration/cafeteria/zaha/'), ...EPFL],
  },
  {
    id: 'satellite',
    name: 'Satellite',
    kind: 'bar',
    glyph: 'beer',
    place: 'Esplanade',
    area: 'EPFL',
    lat: 46.52056,
    lng: 6.56783,
    tagline: 'Le bar des étudiant·e·s, kit étudiant à CHF 7',
    hours: week.days([['07:30', '22:00']], [['07:30', '22:00']], [['07:30', '22:00']], [['07:30', '23:00']], [['07:30', '23:00']]),
    epfl: today('Satellite'),
    menu: [],
    sources: [EPFL_PAGE('restauration/cafeteria/satellite/'), { label: 'satellite.bar', url: 'https://satellite.bar/' }, ...EPFL],
  },
  {
    id: 'klee',
    name: 'Le Klee',
    kind: 'cafe',
    glyph: 'coffee',
    place: 'Rolex Learning Center',
    area: 'EPFL',
    lat: 46.519,
    lng: 6.5676,
    tagline: 'La cafétéria du Rolex Learning Center',
    hours: week.days([['08:00', '17:30']], [['08:00', '17:30']], [['08:00', '17:30']], [['08:00', '16:00']], [['08:00', '16:00']]),
    epfl: today('Klee Compass'),
    menu: [],
    sources: EPFL,
  },
  {
    id: 'epicure',
    name: "L'Epicure",
    kind: 'restaurant',
    glyph: 'utensils',
    place: 'Avenue Piccard',
    area: 'EPFL',
    lat: 46.51986,
    lng: 6.56875,
    tagline: 'Cuisine du midi, du lundi au vendredi',
    hours: week.weekdays(['11:00', '14:30']),
    epfl: today('Epicure'),
    menu: [],
    sources: EPFL,
  },
  {
    id: 'montreux-jazz-cafe',
    name: 'Montreux Jazz Café',
    kind: 'cafe',
    glyph: 'coffee',
    place: 'Artlab · Place Cosandey',
    area: 'EPFL',
    lat: 46.51789,
    lng: 6.56579,
    tagline: 'Le café-restaurant de l’Artlab',
    hours: week.days([['10:00', '16:30']], [['10:00', '16:30']], [['10:00', '16:30']], [['10:00', '16:30']], [['10:00', '16:00']]),
    epfl: today('Montreux Jazz Café'),
    menu: [],
    sources: [{ label: 'montreuxjazzcafe.com', url: 'https://www.montreuxjazzcafe.com/fr/cafe/lausanne' }, ...EPFL],
  },
  {
    id: 'foodtrucks',
    name: 'Food Truck Village',
    kind: 'foodtruck',
    glyph: 'truck',
    place: 'Place Cosandey',
    area: 'EPFL',
    lat: 46.5196,
    lng: 6.5676,
    tagline: 'NAS, Li Beirut, Manira Wokshop, Pazza et Régal Tandoori',
    hours: week.weekdays(['08:15', '14:00']),
    epfl: {
      'NAS Burger': 'NAS Burger',
      'NAS sandwiches': 'NAS Sandwiches',
      'Li Beirut - Food Truck': 'Li Beirut',
      'Manira Wokshop - Food Truck Village': 'Manira Wokshop',
      'Pazza Pizza & Pasta': 'Pazza Pizza & Pasta',
      'Régal Tandoori - Food Truck': 'Régal Tandoori',
      'Fleur de Pains - Food Truck': 'Fleur de Pains',
    },
    menu: [],
    sources: [EPFL_PAGE('nas-sandwiches/'), EPFL_PAGE('manira-wokshop/'), EPFL_PAGE('restauration/food-truck/li-beirut/'), ...EPFL],
  },
  {
    id: 'puur',
    name: 'Le Puur',
    kind: 'cafeteria',
    glyph: 'salad',
    place: 'Innovation Park',
    area: 'EPFL',
    lat: 46.5181,
    lng: 6.563,
    tagline: 'Self-service au centre de l’Innovation Park',
    hours: week.weekdays(['07:30', '16:30']),
    epfl: today('PUUR'),
    menu: [],
    sources: [EPFL_PAGE('restauration/self-service/le-puur/'), ...EPFL],
  },
  {
    id: 'cyber-cafe-sv',
    name: 'Cyber café SV',
    kind: 'cafe',
    glyph: 'coffee',
    place: 'SV',
    area: 'EPFL',
    lat: 46.52021,
    lng: 6.56344,
    tagline: 'La cafétéria du bâtiment SV, par Novae',
    hours: week.weekdays(['08:00', '16:00']),
    epfl: today('Cyber café SV by Novae'),
    menu: [],
    sources: EPFL,
  },
  {
    id: 'negoce',
    name: 'Le Négoce',
    kind: 'grocery',
    glyph: 'basket',
    place: 'Centre du campus',
    area: 'EPFL',
    lat: 46.52059,
    lng: 6.56809,
    tagline: 'L’épicerie du campus',
    hours: week.weekdays(['06:30', '17:00']),
    epfl: today('Le Négoce'),
    menu: [],
    sources: [EPFL_PAGE('le-negoce-epicerie/'), EPFL_HOURS],
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
    hours: week.everyday(['11:00', '23:00']),
    menu: [],
    sources: [{ label: 'holycow.ch', url: 'https://holycow.ch/nos-restaurants/holy-cow-lausanne-epfl/' }, EPFL_HOURS],
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
    tagline: 'Pizzas à emporter et cuisine italienne',
    hours: week.weekdays(['11:45', '14:00'], ['18:45', '21:30']),
    epfl: today('Gina Ristorante'),
    menu: [
      {
        title: 'Pizzas',
        items: [
          item('gin-margherita', 'Margherita', 16, { description: 'Sauce tomate, mozzarella et huile d’olive au basilic', tags: ['vege'] }),
          item('gin-vegana', 'Vegana', 17, { description: 'Sauce tomate, câpres, champignons, oignons rouges, poivrons et aubergines', tags: ['vegan'] }),
          item('gin-pugliese', 'Pugliese', 17, { description: 'Sauce tomate, mozzarella, oignons rouges, olives et origan', tags: ['vege'] }),
          item('gin-ciccio', 'Ciccio', 20, { description: 'Sauce tomate, mozzarella, champignons frais, jambon cuit' }),
          item('gin-napoli', 'Napoli', 20, { description: 'Sauce tomate, mozzarella, câpres, anchois, origan' }),
          item('gin-quattro-stagioni', 'Quattro stagioni', 21, { description: 'Sauce tomate, mozzarella, jambon cuit, champignons, artichauts, poivrons et olives' }),
          item('gin-giardino', 'Giardino', 21, { description: 'Sauce tomate, mozzarella, aubergines, courgettes, poivrons, champignons frais', tags: ['vege'] }),
          item('gin-tonnata', 'Tonnata', 21, { description: 'Sauce tomate, mozzarella, émietté de thon, câpres, oignons et olives' }),
          item('gin-quattro-formaggi', 'Quattro formaggi', 22, { description: 'Sauce tomate, mozzarella, gorgonzola, taleggio et grana padano', tags: ['vege'] }),
          item('gin-calzone', 'Calzone', 23, { description: 'Sauce tomate, mozzarella, jambon cuit, champignons frais et œuf' }),
          item('gin-diavola', 'Diavola', 23, { description: 'Sauce tomate, mozzarella et salami piquant, oignons rouges et olives' }),
          item('gin-pazzarella', 'Pazzarella', 23, { description: 'Sauce tomate, mozzarella, pancetta, taleggio, oignons, tomates cerises et burrata' }),
          item('gin-capricciosa', 'Capricciosa', 23, { description: 'Sauce tomate, mozzarella, jambon cuit, champignons, artichauts, œuf et olives' }),
          item('gin-regina', 'Regina', 23, { description: 'Sauce tomate, mozzarella di bufala, tomates cerises, huile d’olive au basilic', tags: ['vege'] }),
          item('gin-calabrese', 'Calabrese', 23, { description: 'Sauce tomate, mozzarella, champignons, ’nduja, olives, origan' }),
          item('gin-mortazza', 'Mortazza', 23, { description: 'Sauce tomate, mozzarella, mortadella, burrata, roquette, parmesan et tomates cerises' }),
          item('gin-gina', 'Gina', 25, { description: 'Sauce tomate, mozzarella, tomates cerises, jambon cru, parmigiano, bocconcini di bufala et roquette' }),
          item('gin-bresaola', 'Bresaola', 26, { description: 'Tomate, huile d’olive, parmesan, tomates cerises, bresaola, burrata, roquette' }),
          item('gin-del-sud', 'Del Sud', 26, { description: 'Base blanche, salami piquant, friarielli, tomates cerises, parmesan et burrata' }),
          item('gin-salmone', 'Salmone', 26, { description: 'Base blanche, saumon fumé, oignons, câpres, tomates cerises et mozzarella ciliegine' }),
        ],
      },
      {
        title: 'Antipasti',
        items: [
          item('gin-salade-verte', 'Salade verte', 8, { tags: ['vege'] }),
          item('gin-salade-melee', 'Salade mêlée', 9, { tags: ['vege'] }),
          item('gin-parmigiana-antipasto', 'Parmigiana d’aubergine', 16, { tags: ['vege'] }),
          item('gin-bruschetta', 'Bruschetta à la tomate datte', 22, { description: 'Pesto de basilic et mozzarella di bufala', tags: ['vege'] }),
          item('gin-assiette', 'Assiette Gina', 24, { description: 'Mortadella, coppa, salami de Modena, jambon de Parme, burrata et gnocco fritto' }),
          item('gin-caponata', 'Caponata froide à la sicilienne', 26, { description: 'Relevée au balsamique, salade d’herbes et burrata' }),
          item('gin-carpaccio', 'Carpaccio de bresaola', 26, { description: 'Roquette, parmesan et tomates cerises' }),
        ],
      },
      {
        title: 'Primi piatti',
        items: [
          item('gin-nerano', 'Linguine à la Nerano', 22, { description: 'Courgettes frites et parmesan', tags: ['vege'] }),
          item('gin-fettuccine', 'Fettuccine Gina', 23, { description: 'Tomates datterino, ail, basilic, huile d’olive vierge et burrata', tags: ['vege'] }),
          item('gin-parmigiana', 'Parmigiana d’aubergine', 26, { tags: ['vege'] }),
          item('gin-vongole', 'Spaghetti alle vongole', 28, { description: 'Et zestes de citron' }),
          item('gin-lasagne', 'Lasagne traditionnelle de Bologne', 28, { description: 'Jus corsé au Sangiovese' }),
          item('gin-risotto', 'Risotto au gambero rosso di Mazara', 28, { description: 'Et bisque de homard' }),
          item('gin-ravioli', 'Ravioli maison ricotta et parmesan', 28, { description: 'Sauce aux petits pois et poireaux croquants', tags: ['vege'] }),
        ],
      },
      {
        title: 'Secondi piatti',
        items: [
          item('gin-gambas', 'Gambas grillées', 38, { description: 'Aubergine farcie à la tomate, olives et basilic' }),
          item('gin-calamar', 'Calamar à la plancha', 40, { description: 'Riz noir sauté, sauce citronnée' }),
          item('gin-fritto', 'Fritto misto de calamars et crevettes', 41, { description: 'Mayonnaise à l’ail et citron' }),
          item('gin-thon', 'Filet de thon pinna gialla mi-cuit', 43, { description: 'Caponata sicilienne et réduction de balsamique à l’orange' }),
          item('gin-agneau', 'Côtelettes d’agneau grillées', 43, { description: 'Jus réduit au romarin, polenta croustillante et légumes' }),
          item('gin-tagliata', 'Tagliata de faux-filet suisse maturé', 47, { description: 'Roquette, parmesan, tomates fraîches et patate della nonna' }),
        ],
      },
      {
        title: 'Dolci',
        items: [
          item('gin-gelato-1', 'Gelato, 1 boule', 5, { description: 'De l’Artisan Glacier' }),
          item('gin-sorbet-1', 'Sorbet, 1 boule', 5),
          item('gin-affogato', 'Affogato al caffè di Napoli', 8, { description: 'Café et une boule de glace vanille' }),
          item('gin-gelato-2', 'Gelato, 2 boules', 9),
          item('gin-sorbet-2', 'Sorbet, 2 boules', 9),
          item('gin-sorbetto-amalfi', 'Sorbetto amalfi', 9, { description: 'Sorbet citron et limoncello' }),
          item('gin-affogato-ramazzotti', 'Affogato al Ramazzotti', 10, { description: 'Glace café et amaro Ramazzotti' }),
          item('gin-tiramisu', 'Tiramisu classico', 12),
          item('gin-baba', 'Baba au rhum et chantilly', 12),
          item('gin-panna-cotta', 'Panna cotta aux fruits des bois', 12),
          item('gin-gourmand', 'Café ou thé gourmand', 12, { description: 'Trois petites pièces sucrées du moment' }),
        ],
      },
    ],
    sources: [{ label: 'gina-ristorante.ch · La carte', url: 'https://www.gina-ristorante.ch/#la-carte' }, EPFL_HOURS],
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
    hours: week.custom([['07:30', '20:00']], [['08:00', '18:00']]),
    menu: [],
    sources: [{ label: 'Denner · EPFL Les Arcades', url: 'https://www.denner.ch/fr/succursales/1024-ecublens-vd-epfl-les-arcades~s1145391' }],
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
    hours: week.custom([['07:30', '20:00']], [['08:00', '18:00']]),
    menu: [],
    sources: [{ label: 'Migros · Ecublens EPFL', url: 'https://filialen.migros.ch/fr/supermarche-migros-ecublens-epfl/' }],
  },
];

export const SPOTS: Spot[] = SPOT_LIST.map((s) => ({ ...s, cover: COVERS[s.id] }));

/** Demande libre : ce que le demandeur décrit, avec un budget plafond. */
export const CUSTOM_ITEM_ID = 'custom';
export const CUSTOM_TEXT_MAX = 200;
export const CUSTOM_BUDGET_MIN_CENTS = 200;
export const CUSTOM_BUDGET_MAX_CENTS = 6000;

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
  { id: 'SG', name: 'SG', hint: 'Architecture', lat: 46.5207, lng: 6.5643 },
  { id: 'ME', name: 'ME', hint: 'Génie mécanique', lat: 46.5179, lng: 6.5634 },
  { id: 'MX', name: 'MX', hint: 'Science des matériaux', lat: 46.5177, lng: 6.565 },
  { id: 'MA', name: 'MA', hint: 'Mathématiques', lat: 46.5181, lng: 6.5656 },
  { id: 'PH', name: 'PH', hint: 'Physique', lat: 46.5172, lng: 6.5662 },
  { id: 'EL', name: 'EL', hint: 'Génie électrique', lat: 46.5176, lng: 6.562 },
  { id: 'GC', name: 'GC', hint: 'Génie civil', lat: 46.517, lng: 6.5642 },
  { id: 'CH', name: 'CH', hint: 'Chimie', lat: 46.5166, lng: 6.565 },
  { id: 'SV', name: 'SV', hint: 'Sciences de la vie', lat: 46.5202, lng: 6.5634 },
  { id: 'RLC', name: 'RLC', hint: 'Rolex Learning Center', lat: 46.51845, lng: 6.5683 },
  { id: 'STCC', name: 'STCC', hint: 'SwissTech Convention Center', lat: 46.52346, lng: 6.56401 },
  { id: 'ARC', name: 'Les Arcades', hint: 'Quartier Nord · logements et commerces', lat: 46.52286, lng: 6.5651 },
  { id: 'PO', name: 'Polydôme', hint: 'Examens & événements', lat: 46.52, lng: 6.568 },
  { id: 'IP', name: 'Innovation Park', hint: 'Start-ups', lat: 46.5181, lng: 6.563 },
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
      hours: week.everyday(),
      sources: [],
      menu: [],
    }
  );
}

export function findItem(sections: MenuSection[], itemId: string): MenuItem | undefined {
  for (const section of sections) {
    const found = section.items.find((i) => i.id === itemId);
    if (found) return found;
  }
  return undefined;
}

/** Un article se commande s'il a un prix fixe publié. */
export const isOrderable = (item: MenuItem) => item.priceCents > 0;

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
