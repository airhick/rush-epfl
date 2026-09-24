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
  area: 'EPFL' | 'UNIL';
  tagline: string;
  priceLevel: 1 | 2 | 3;
  hours: WeekHours;
  menu: MenuSection[];
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

const LUNCH = week.weekdays(['11:15', '14:00']);

const item = (id: string, name: string, price: number, extra: Partial<MenuItem> = {}): MenuItem => ({
  id,
  name,
  priceCents: Math.round(price * 100),
  ...extra,
});

export const SPOTS: Spot[] = [
  {
    id: 'esplanade',
    name: "L'Esplanade",
    kind: 'restaurant',
    glyph: 'utensils',
    place: 'CO · Esplanade',
    area: 'EPFL',
    lat: 46.52045,
    lng: 6.567,
    tagline: 'Assiettes du jour, grande terrasse',
    priceLevel: 1,
    hours: LUNCH,
    menu: [
      {
        title: 'Menus du jour',
        items: [
          item('esp-viande', 'Assiette du jour', 9.5, { description: 'Viande, garniture et légumes du marché', tags: ['hot', 'popular'] }),
          item('esp-vege', 'Assiette végétarienne', 8.5, { description: 'Plat du jour sans viande', tags: ['hot', 'vege'] }),
          item('esp-pates', 'Pâtes du jour', 7.9, { description: 'Sauce maison, parmesan', tags: ['hot', 'vege'] }),
        ],
      },
      {
        title: 'À côté',
        items: [
          item('esp-salade', 'Salade composée', 8.9, { tags: ['vege'] }),
          item('esp-soupe', 'Soupe du jour', 3.5, { tags: ['hot', 'vegan'] }),
          item('esp-dessert', 'Dessert du jour', 3.2),
          item('esp-eau', 'Eau minérale 50 cl', 2.0),
        ],
      },
    ],
  },
  {
    id: 'parmentier',
    name: 'Le Parmentier',
    kind: 'restaurant',
    glyph: 'burger',
    place: 'ME · Terrasse sud',
    area: 'EPFL',
    lat: 46.51835,
    lng: 6.5636,
    tagline: 'Grill, burgers et frites maison',
    priceLevel: 2,
    hours: LUNCH,
    menu: [
      {
        title: 'Grill',
        items: [
          item('par-burger', 'Burger maison', 12.5, { description: 'Bœuf suisse, cheddar, oignons confits', tags: ['hot', 'popular'] }),
          item('par-veggie', 'Burger végé', 11.5, { description: 'Galette pois chiches & patate douce', tags: ['hot', 'vege'] }),
          item('par-poulet', 'Poulet rôti & frites', 11.9, { tags: ['hot'] }),
          item('par-wrap', 'Wrap falafel', 9.5, { tags: ['vegan'] }),
        ],
      },
      {
        title: 'Accompagnements',
        items: [
          item('par-frites', 'Frites', 4.5, { tags: ['hot', 'vegan', 'popular'] }),
          item('par-salade', 'Petite salade verte', 3.9, { tags: ['vegan'] }),
          item('par-coca', 'Coca-Cola 33 cl', 2.5),
        ],
      },
    ],
  },
  {
    id: 'corbusier',
    name: 'Le Corbusier',
    kind: 'restaurant',
    glyph: 'salad',
    place: 'SG · Rez',
    area: 'EPFL',
    lat: 46.5195,
    lng: 6.5643,
    tagline: 'Cuisine du monde et bowls',
    priceLevel: 2,
    hours: week.weekdays(['11:30', '13:45']),
    menu: [
      {
        title: 'Bowls',
        items: [
          item('cor-poke', 'Poke bowl saumon', 12.9, { description: 'Riz vinaigré, avocat, edamame', tags: ['popular'] }),
          item('cor-tofu', 'Bowl tofu teriyaki', 11.5, { tags: ['vegan'] }),
        ],
      },
      {
        title: 'Au wok',
        items: [
          item('cor-curry', 'Curry vert thaï', 11.5, { description: 'Poulet, lait de coco, riz jasmin', tags: ['hot'] }),
          item('cor-riz', 'Riz cantonais', 9.8, { tags: ['hot'] }),
          item('cor-nems', 'Nems (4 pièces)', 5.5, { tags: ['hot'] }),
          item('cor-the', 'Thé glacé maison', 3.0),
        ],
      },
    ],
  },
  {
    id: 'vinci',
    name: 'Le Vinci',
    kind: 'restaurant',
    glyph: 'pizza',
    place: 'CE · Centre Est',
    area: 'EPFL',
    lat: 46.5196,
    lng: 6.5692,
    tagline: 'Pizzas au feu de bois',
    priceLevel: 2,
    hours: week.weekdays(['11:30', '14:00'], ['17:30', '20:00']),
    menu: [
      {
        title: 'Pizzas',
        items: [
          item('vin-margherita', 'Margherita', 12.0, { description: 'Tomate, mozzarella fior di latte, basilic', tags: ['vege', 'popular'] }),
          item('vin-prosciutto', 'Prosciutto e funghi', 14.5),
          item('vin-4f', 'Quattro formaggi', 15.0, { tags: ['vege'] }),
          item('vin-diavola', 'Diavola', 14.5, { description: 'Salami piquant, olives' }),
          item('vin-calzone', 'Calzone', 15.5),
        ],
      },
      {
        title: 'Et aussi',
        items: [
          item('vin-roquette', 'Salade roquette & parmesan', 7.5, { tags: ['vege'] }),
          item('vin-tiramisu', 'Tiramisù', 5.5),
          item('vin-sanpe', 'San Pellegrino 50 cl', 2.8),
        ],
      },
    ],
  },
  {
    id: 'vallotton',
    name: 'La Table de Vallotton',
    kind: 'restaurant',
    glyph: 'utensils',
    place: 'BC · Rez',
    area: 'EPFL',
    lat: 46.51865,
    lng: 6.56195,
    tagline: 'Menus du jour et salad bar',
    priceLevel: 1,
    hours: week.weekdays(['11:30', '13:45']),
    menu: [
      {
        title: 'Menus',
        items: [
          item('val-menu', 'Menu du jour', 9.9, { tags: ['hot', 'popular'] }),
          item('val-vege', 'Menu végétarien', 8.9, { tags: ['hot', 'vege'] }),
          item('val-soupe', 'Soupe & pain', 3.8, { tags: ['hot', 'vegan'] }),
        ],
      },
      {
        title: 'Salad bar',
        items: [
          item('val-salad-s', 'Boîte salade — petite', 6.5, { tags: ['vege'] }),
          item('val-salad-l', 'Boîte salade — grande', 9.5, { tags: ['vege'] }),
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
    tagline: 'Viennoiseries, sandwichs, café',
    priceLevel: 1,
    hours: week.weekdays(['07:30', '16:00']),
    menu: [
      {
        title: 'Boulangerie',
        items: [
          item('arc-croissant', 'Croissant au beurre', 1.6, { tags: ['popular'] }),
          item('arc-pac', 'Pain au chocolat', 1.8),
          item('arc-tresse', 'Tresse au beurre', 2.4),
        ],
      },
      {
        title: 'Sandwichs',
        items: [
          item('arc-jambon', 'Jambon-beurre', 5.9),
          item('arc-mozza', 'Mozzarella, tomate, pesto', 6.5, { tags: ['vege'] }),
          item('arc-poulet', 'Poulet curry', 6.9),
        ],
      },
      {
        title: 'Boissons',
        items: [
          item('arc-cafe', 'Café', 2.2, { tags: ['hot'] }),
          item('arc-cappu', 'Cappuccino', 3.0, { tags: ['hot'] }),
          item('arc-jus', "Jus d'orange pressé", 3.5),
        ],
      },
    ],
  },
  {
    id: 'ornithorynque',
    name: "L'Ornithorynque",
    kind: 'cafeteria',
    glyph: 'sandwich',
    place: 'CE · 1er étage',
    area: 'EPFL',
    lat: 46.51925,
    lng: 6.5682,
    tagline: 'Paninis, quiches et smoothies',
    priceLevel: 1,
    hours: week.weekdays(['07:30', '17:00']),
    menu: [
      {
        title: 'Salé',
        items: [
          item('orn-panini', 'Panini tomate-mozza', 7.5, { tags: ['hot', 'vege', 'popular'] }),
          item('orn-panini-j', 'Panini jambon-fromage', 7.5, { tags: ['hot'] }),
          item('orn-quiche', 'Quiche lorraine', 6.9, { tags: ['hot'] }),
        ],
      },
      {
        title: 'Sucré & boissons',
        items: [
          item('orn-muffin', 'Muffin myrtilles', 3.2),
          item('orn-smoothie', 'Smoothie fruits rouges', 5.5, { tags: ['vegan'] }),
          item('orn-latte', 'Latte', 3.6, { tags: ['hot'] }),
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
    tagline: 'Le bar des étudiant·e·s, ouvert tard',
    priceLevel: 1,
    hours: week.custom([['08:00', '24:00']], [['17:00', '24:00']]),
    menu: [
      {
        title: 'À boire',
        items: [
          item('sat-cafe', 'Café', 1.5, { tags: ['hot', 'popular'] }),
          item('sat-pression', 'Bière pression 25 cl', 3.5),
          item('sat-pinte', 'Bière pression 50 cl', 6.0, { tags: ['popular'] }),
          item('sat-mate', 'Club-Mate', 4.0),
        ],
      },
      {
        title: 'À grignoter',
        items: [
          item('sat-hotdog', 'Hot-dog', 4.5, { tags: ['hot'] }),
          item('sat-croque', 'Croque-monsieur', 5.0, { tags: ['hot'] }),
          item('sat-chips', 'Chips', 2.0, { tags: ['vegan'] }),
        ],
      },
    ],
  },
  {
    id: 'giacometti',
    name: 'Le Giacometti',
    kind: 'cafeteria',
    glyph: 'sandwich',
    place: 'SG · 1er étage',
    area: 'EPFL',
    lat: 46.5193,
    lng: 6.5638,
    tagline: 'Focaccias et bowls à emporter',
    priceLevel: 1,
    hours: week.weekdays(['07:30', '15:30']),
    menu: [
      {
        title: 'À emporter',
        items: [
          item('gia-focaccia', 'Focaccia jambon cru', 7.2, { tags: ['popular'] }),
          item('gia-bowl', 'Bowl quinoa & feta', 9.5, { tags: ['vege'] }),
          item('gia-wrap', 'Wrap poulet caesar', 8.4),
        ],
      },
      {
        title: 'Boissons & douceurs',
        items: [
          item('gia-espresso', 'Espresso', 2.0, { tags: ['hot'] }),
          item('gia-chai', 'Chai latte', 4.2, { tags: ['hot'] }),
          item('gia-cookie', 'Cookie chocolat', 2.5),
        ],
      },
    ],
  },
  {
    id: 'bc-cafe',
    name: 'Café BC',
    kind: 'cafe',
    glyph: 'coffee',
    place: 'BC · Hall',
    area: 'EPFL',
    lat: 46.5185,
    lng: 6.5613,
    tagline: 'Espresso de spécialité',
    priceLevel: 1,
    hours: week.weekdays(['07:30', '17:00']),
    menu: [
      {
        title: 'Café',
        items: [
          item('bc-espresso', 'Espresso', 2.0, { tags: ['hot'] }),
          item('bc-cappu', 'Cappuccino', 3.2, { tags: ['hot', 'popular'] }),
          item('bc-flat', 'Flat white', 4.0, { tags: ['hot'] }),
          item('bc-cold', 'Cold brew', 4.5),
        ],
      },
      {
        title: 'À côté',
        items: [
          item('bc-croissant', 'Croissant', 1.6),
          item('bc-banana', 'Banana bread', 3.5, { tags: ['vege'] }),
          item('bc-bagel', 'Bagel saumon', 7.9),
        ],
      },
    ],
  },
  {
    id: 'niagara',
    name: 'Niagara',
    kind: 'cafe',
    glyph: 'icecream',
    place: 'PH · Rez',
    area: 'EPFL',
    lat: 46.51725,
    lng: 6.566,
    tagline: 'Glaces artisanales et gaufres',
    priceLevel: 1,
    hours: week.weekdays(['08:00', '17:00']),
    menu: [
      {
        title: 'Glaces',
        items: [
          item('nia-1', 'Glace 1 boule', 3.5, { tags: ['popular'] }),
          item('nia-2', 'Glace 2 boules', 6.0),
          item('nia-frappe', 'Frappé vanille', 5.5),
        ],
      },
      {
        title: 'Chaud',
        items: [
          item('nia-gaufre', 'Gaufre sucre glace', 4.5, { tags: ['hot'] }),
          item('nia-choco', 'Chocolat chaud', 3.5, { tags: ['hot'] }),
        ],
      },
    ],
  },
  {
    id: 'rlc',
    name: 'Café du Learning Center',
    kind: 'cafe',
    glyph: 'coffee',
    place: 'Rolex Learning Center',
    area: 'EPFL',
    lat: 46.51845,
    lng: 6.5683,
    tagline: 'Ouvert le soir et le week-end',
    priceLevel: 1,
    hours: week.custom([['07:30', '21:00']], [['10:00', '18:00']], [['10:00', '18:00']]),
    menu: [
      {
        title: 'Boissons',
        items: [
          item('rlc-cafe', 'Café', 2.2, { tags: ['hot'] }),
          item('rlc-matcha', 'Matcha latte', 5.0, { tags: ['hot', 'popular'] }),
          item('rlc-the', 'Thé', 2.5, { tags: ['hot'] }),
        ],
      },
      {
        title: 'Pour réviser',
        items: [
          item('rlc-sandwich', 'Sandwich du jour', 6.5),
          item('rlc-salade', 'Salade à emporter', 8.5, { tags: ['vege'] }),
          item('rlc-brownie', 'Brownie', 3.2),
        ],
      },
    ],
  },
  {
    id: 'foodtrucks',
    name: 'Food trucks Cosandey',
    kind: 'foodtruck',
    glyph: 'truck',
    place: 'Place Cosandey',
    area: 'EPFL',
    lat: 46.5196,
    lng: 6.5676,
    tagline: 'Trois trucks, cuisines qui tournent',
    priceLevel: 2,
    hours: week.weekdays(['11:00', '14:00']),
    menu: [
      {
        title: 'Truck mexicain',
        items: [
          item('ft-tacos', 'Tacos al pastor (3)', 12.0, { tags: ['hot', 'popular'] }),
          item('ft-burrito', 'Burrito haricots noirs', 13.0, { tags: ['hot', 'vegan'] }),
        ],
      },
      {
        title: 'Truck libanais',
        items: [
          item('ft-falafel', 'Pita falafel', 10.0, { tags: ['vegan'] }),
          item('ft-shawarma', 'Shawarma poulet', 11.5, { tags: ['hot'] }),
        ],
      },
      {
        title: 'Truck asiatique',
        items: [
          item('ft-bao', 'Bao porc effiloché (2)', 9.0, { tags: ['hot'] }),
          item('ft-limonade', 'Limonade gingembre', 4.0),
        ],
      },
    ],
  },
  {
    id: 'native',
    name: 'Le Native',
    kind: 'restaurant',
    glyph: 'burger',
    place: 'Innovation Park',
    area: 'EPFL',
    lat: 46.5164,
    lng: 6.5622,
    tagline: 'Burgers et bowls, produits locaux',
    priceLevel: 3,
    hours: week.weekdays(['11:30', '14:00']),
    menu: [
      {
        title: 'Plats',
        items: [
          item('nat-burger', 'Burger Native', 16.5, { tags: ['hot', 'popular'] }),
          item('nat-poke', 'Poke bowl thon', 17.0),
          item('nat-veggie', 'Bowl veggie de saison', 15.0, { tags: ['vegan'] }),
        ],
      },
      {
        title: 'Côtés',
        items: [
          item('nat-frites', 'Frites de patate douce', 6.0, { tags: ['hot', 'vegan'] }),
          item('nat-kombucha', 'Kombucha', 5.0),
        ],
      },
    ],
  },
  {
    id: 'vending-inf',
    name: 'Distributeurs INF',
    kind: 'vending',
    glyph: 'soda',
    place: 'INF · Rez',
    area: 'EPFL',
    lat: 46.51895,
    lng: 6.563,
    tagline: 'Snacks et boissons, 24h/24',
    priceLevel: 1,
    hours: week.everyday(['00:00', '24:00']),
    menu: [
      {
        title: 'Boissons',
        items: [
          item('ven-redbull', 'Red Bull 25 cl', 3.0, { tags: ['popular'] }),
          item('ven-coca', 'Coca-Cola 50 cl', 2.5),
          item('ven-eau', 'Eau 50 cl', 1.8),
          item('ven-cafe', 'Café machine', 1.2, { tags: ['hot'] }),
        ],
      },
      {
        title: 'Snacks',
        items: [
          item('ven-snickers', 'Snickers', 1.8),
          item('ven-chips', 'Chips paprika', 2.2, { tags: ['vegan'] }),
          item('ven-sandwich', 'Sandwich emballé', 5.0),
        ],
      },
    ],
  },
  {
    id: 'holy-cow-epfl',
    name: 'Holy Cow!',
    kind: 'restaurant',
    glyph: 'burger',
    place: 'Les Arcades · Quartier Nord',
    area: 'EPFL',
    lat: 46.52258,
    lng: 6.56562,
    tagline: 'Burgers au bœuf suisse, à côté du métro',
    priceLevel: 2,
    hours: week.everyday(['11:00', '23:00']),
    menu: [
      {
        title: 'Burgers',
        items: [
          item('hc-holycow', 'Holy Cow!', 14.9, { description: 'Bœuf suisse, cheddar, sauce maison', tags: ['hot', 'popular'] }),
          item('hc-smoky', 'Smoky Big Cheese & Bacon', 16.9, { tags: ['hot'] }),
          item('hc-bigbeef', 'Big Beef', 18.9, { description: 'Double steak', tags: ['hot'] }),
          item('hc-buffalo', 'Buffalo Crispy Chicken', 15.9, { tags: ['hot'] }),
          item('hc-veggie', 'Veggie', 14.4, { description: 'Mayo citron vert-basilic, chutney de pomme épicé', tags: ['hot', 'vege'] }),
        ],
      },
      {
        title: 'À côté',
        items: [
          item('hc-frites', 'Frites', 5.9, { tags: ['hot', 'vegan', 'popular'] }),
          item('hc-patate', 'Frites de patate douce', 6.9, { tags: ['hot', 'vegan'] }),
          item('hc-soda', 'Soda 50 cl', 4.5),
        ],
      },
    ],
  },
  {
    id: 'denner-epfl',
    name: 'Denner EPFL',
    kind: 'grocery',
    glyph: 'basket',
    place: 'Les Arcades · Quartier Nord',
    area: 'EPFL',
    lat: 46.52283,
    lng: 6.56525,
    tagline: 'Boissons et snacks à petit prix',
    priceLevel: 1,
    hours: week.custom([['07:30', '20:00']], [['08:00', '18:00']]),
    menu: [
      {
        title: 'Boissons',
        items: [
          item('den-coca', 'Coca-Cola 1.5 L', 1.95, { tags: ['popular'] }),
          item('den-eau', 'Eau minérale 1.5 L', 0.55),
          item('den-icetea', 'Ice tea 1.5 L', 1.3),
          item('den-redbull', 'Red Bull 25 cl', 1.75),
          item('den-biere', 'Bière 50 cl', 1.4),
        ],
      },
      {
        title: 'Snacks',
        items: [
          item('den-chips', 'Chips nature 175 g', 2.95, { tags: ['vegan'] }),
          item('den-chocolat', 'Chocolat au lait 100 g', 1.4),
          item('den-biscuits', 'Biscuits', 1.9),
          item('den-sandwich', 'Sandwich', 3.6),
        ],
      },
    ],
  },
  {
    id: 'migros-epfl',
    name: 'Migros EPFL',
    kind: 'grocery',
    glyph: 'basket',
    place: 'Les Arcades · Quartier Nord',
    area: 'EPFL',
    lat: 46.52309,
    lng: 6.56487,
    tagline: 'Le supermarché du campus',
    priceLevel: 1,
    hours: week.custom([['07:30', '20:00']], [['08:00', '18:00']]),
    menu: [
      {
        title: 'Sur le pouce',
        items: [
          item('mig-sandwich', 'Sandwich jambon-fromage', 4.2, { tags: ['popular'] }),
          item('mig-wrap', 'Wrap falafel', 5.5, { tags: ['vegan'] }),
          item('mig-salade', 'Salade de pâtes', 4.95, { tags: ['vege'] }),
          item('mig-sushi', 'Sushi box', 8.9),
        ],
      },
      {
        title: 'Boissons',
        items: [
          item('mig-eau', 'Eau minérale 1.5 L', 0.8),
          item('mig-coca', 'Coca-Cola 50 cl', 1.95),
          item('mig-latte', 'Café latte (gobelet)', 1.95),
          item('mig-redbull', 'Red Bull 25 cl', 1.95),
        ],
      },
      {
        title: 'Fruits & douceurs',
        items: [
          item('mig-banane', 'Banane', 0.45, { tags: ['vegan'] }),
          item('mig-pomme', 'Pomme', 0.7, { tags: ['vegan'] }),
          item('mig-chocolat', 'Chocolat au lait 100 g', 1.8),
          item('mig-chips', 'Chips 90 g', 2.6, { tags: ['vegan'] }),
        ],
      },
      {
        title: 'Dépannage',
        items: [
          item('mig-lait', 'Lait entier 1 L', 1.7),
          item('mig-pain', 'Pain mi-blanc', 2.5),
          item('mig-pates', 'Pâtes 500 g', 1.3),
        ],
      },
    ],
  },
  {
    id: 'geopolis',
    name: 'Cafétéria Géopolis',
    kind: 'cafeteria',
    glyph: 'sandwich',
    place: 'UNIL · Géopolis',
    area: 'UNIL',
    lat: 46.5206,
    lng: 6.5731,
    tagline: 'Juste de l’autre côté de la Sorge',
    priceLevel: 1,
    hours: week.weekdays(['07:30', '16:30']),
    menu: [
      {
        title: 'Midi',
        items: [
          item('geo-plat', 'Plat du jour', 8.9, { tags: ['hot', 'popular'] }),
          item('geo-sandwich', 'Sandwich baguette', 5.8),
          item('geo-salade', 'Salade de pâtes', 6.5, { tags: ['vege'] }),
        ],
      },
      {
        title: 'Boissons',
        items: [
          item('geo-cafe', 'Café', 2.0, { tags: ['hot'] }),
          item('geo-ice', 'Ice tea', 2.8),
        ],
      },
    ],
  },
  {
    id: 'unitheque',
    name: 'Cafétéria Unithèque',
    kind: 'cafeteria',
    glyph: 'coffee',
    place: 'UNIL · Unithèque',
    area: 'UNIL',
    lat: 46.5225,
    lng: 6.5805,
    tagline: 'La pause des révisions à la BCU',
    priceLevel: 1,
    hours: week.custom([['08:00', '19:00']], [['10:00', '17:00']]),
    menu: [
      {
        title: 'Café & snacks',
        items: [
          item('uni-cafe', 'Café', 2.0, { tags: ['hot', 'popular'] }),
          item('uni-croissant', 'Croissant', 1.5),
          item('uni-wrap', 'Wrap houmous', 6.9, { tags: ['vegan'] }),
          item('uni-muffin', 'Muffin chocolat', 3.0),
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
