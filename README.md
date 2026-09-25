# Rush

**La graille du campus, ramenée par ceux qui y sont déjà.**

Rush est une web app communautaire réservée à l'EPFL. Tu es à l'INF et tu as faim ? Quelqu'un qui est déjà au Parmentier — ou qui y passe — prend ta commande sur son chemin et te l'amène. Le paiement passe par un solde intégré, le pourboire est suggéré au juste prix, et tout se suit sur une carte du campus.

## Ce que fait l'app

| | |
|---|---|
| **Carte intégrée** | Tous les spots de graille de l'EPFL et autour (UNIL), avec les rushers présents en direct, les trajets et la position du livreur. Style vectoriel maison inspiré d'Apple Plans, bâtiments en 3D, clair/sombre. |
| **Fiches spots** | Menu du jour des restaurants EPFL lu en direct sur epfl.ch, avec les prix exacts étudiant, doctorant, campus et visiteur ; horaires officiels ; photos et avis Google Maps crédités à leurs auteurs. |
| **Commander** | Plats du jour et cartes officielles, ou **demande libre** avec un budget maximum là où aucun prix n'est publié. Point de livraison par GPS, bâtiment ou épingle déplaçable sur la carte, note visible uniquement par le rusher. |
| **Livrer** | Tu indiques où tu es et où tu vas : les demandes sont triées selon le **détour** qu'elles t'imposent (« Sur ton chemin », « +320 m de détour »). |
| **Solde Rush** | **CHF 1.00 offert** à chaque nouveau compte, **recharge par carte via Stripe** (montant libre de CHF 1 à 100) et gains des livraisons. Montant réservé à la commande, règlement du rusher à la livraison, reste rendu automatiquement. |
| **Retraits TWINT** | Chacun demande un retrait depuis son solde ; l'équipe Rush reçoit une notification, envoie l'argent par TWINT et marque la demande comme envoyée. |
| **Pourboire suggéré** | Calculé à partir de la distance à pied, du nombre d'articles et de l'heure de pointe, avec le détail affiché ligne par ligne. |
| **Messagerie** | Une conversation par commande, en temps réel (WebSocket), indicateur de saisie, réponses rapides contextuelles, messages système. |
| **Suivi** | Barre de progression façon Uber (publiée → acceptée → achetée → livrée), ETA, position live du rusher, notation mutuelle. |
| **Accès EPFL** | « Continuer avec EPFL » : connexion avec le compte EPFL (Microsoft Entra ID), adresse et nom fournis par l'annuaire. Sans configuration Entra, compte `@epfl.ch` + mot de passe. |

## Démarrer

Prérequis : **Node 22.13+** (SQLite intégré à Node, aucune dépendance native).

```bash
npm install
npm run dev
```

Ouvre <http://localhost:5173> et crée un compte avec n'importe quelle adresse `@epfl.ch` et un mot de passe (8 caractères minimum). La connexion EPFL n'apparaît que si `ENTRA_CLIENT_ID` et `ENTRA_CLIENT_SECRET` sont définis.

`npm run dev` active le **mode démo** (`RUSH_DEMO=1`) : huit rushers simulés publient des demandes, acceptent les tiennes, se déplacent sur la carte et te répondent dans le chat. Idéal pour tester seul. Pour tester à deux humains, ouvre une seconde fenêtre de navigation privée avec une autre adresse.

```bash
npm test          # tarification, horaires, géo, cycle commande/solde complet
npm run typecheck
```

## Comment l'argent circule

Tous les montants sont en centimes, et le solde est **toujours la somme d'un registre append-only** (`transactions`) : rien n'est jamais modifié en place.

0. **Entrées** — chaque nouveau compte reçoit CHF 1.00 (`RUSH_WELCOME_BONUS_CENTS`). Le solde se recharge ensuite par carte (Stripe) ou se gagne en livrant.
1. **Publication** — réservation de `articles + 10 % de marge + pourboire` sur le solde du demandeur. Pour un menu EPFL, l'article compte au prix publié le plus élevé (visiteur), puisque le prix payé dépend du statut du rusher ; une demande libre compte pour son budget.
2. **Achat** — le rusher paie au comptoir et déclare le montant du ticket (plafonné au montant réservé).
3. **Confirmation** — le rusher reçoit `ticket + pourboire`, le demandeur récupère le reste.
4. **Annulation / expiration** — tout est rendu. Une demande sans rusher expire après 40 min ; une livraison non confirmée est validée automatiquement après 15 min.

5. **Retrait** — le montant quitte le solde dès la demande (écriture `withdrawal`) ; s'il est annulé ou refusé, il revient (`withdrawal_refund`). Le crédit offert ne se retire pas.

Le serveur recalcule toujours les prix (menu du jour EPFL ou carte officielle) et ne fait jamais confiance aux montants envoyés par le navigateur.

## Recharges Stripe et retraits TWINT

**Recharge.** Un seul [lien de paiement Stripe](https://docs.stripe.com/payment-links) « montant libre » (CHF 1 à 100, métadonnée `rush=topup`). L'app choisit le montant et ouvre le lien avec `client_reference_id` (le compte), `prefilled_amount` et `locked_prefilled_email`. Après le paiement, Stripe renvoie sur `/wallet?recharge={CHECKOUT_SESSION_ID}` et envoie un webhook `checkout.session.completed` à `/api/stripe/webhook`. Le serveur vérifie la signature (HMAC avec `STRIPE_WEBHOOK_SECRET`, sans SDK ni clé secrète), puis crédite le montant réellement payé, une seule fois par session (table `topups`). Un paiement sans compte correspondant, ou dans une autre devise que le CHF, n'est pas crédité : il apparaît dans l'écran de l'équipe pour être remboursé depuis Stripe.

**Retrait.** Dans Solde → Retirer, la personne indique un montant et son numéro de mobile suisse relié à TWINT. Une seule demande à la fois ; elle peut l'annuler tant qu'elle n'est pas envoyée. Les adresses de `RUSH_ADMIN_EMAILS` voient l'écran **Retraits** (Profil → Équipe Rush) : numéro à copier, montant, et d'où vient l'argent du compte (recharges, gains). Après l'envoi TWINT, « Envoyé » prévient la personne ; « Refuser » lui rend le montant avec un message. L'équipe est prévenue de chaque demande dans l'app et, si `RUSH_NTFY_TOPIC` est défini, sur son téléphone via [ntfy](https://ntfy.sh) (app gratuite, s'abonner au même sujet ; la notification ne contient ni nom ni numéro).

## Connexion EPFL (Microsoft Entra ID)

L'EPFL authentifie avec Microsoft Entra ID (qui remplace Tequila). Rush utilise OpenID Connect : code d'autorisation avec PKCE, puis jeton d'identité vérifié côté serveur (signature RS256 avec les clés publiées par Microsoft, émetteur, audience, nonce, et annuaire EPFL `f6c2556a-c4fb-4ab1-a2c7-9e220df11c43`). Un compte d'un autre annuaire est refusé.

1. Enregistrer l'application sur [app-portal.epfl.ch](https://app-portal.epfl.ch/) (compte EPFL ; sinon passer par le Service Desk, 1234@epfl.ch), en application web avec l'adresse de retour `https://rush-epfl.onrender.com/api/auth/epfl/callback`.
2. Mettre l'identifiant et le secret obtenus dans `ENTRA_CLIENT_ID` et `ENTRA_CLIENT_SECRET` sur Render.

Dès que ces deux variables existent :

- L'écran de connexion propose **Continuer avec EPFL**. Un compte est créé à la première connexion (nom et prénom de l'annuaire, crédit de bienvenue), puis retrouvé par l'identifiant immuable du compte EPFL.
- Une adresse EPFL ne peut plus créer de mot de passe : c'est l'annuaire qui prouve l'adresse. Si un compte à mot de passe existait déjà pour cette adresse, la connexion EPFL le reprend, supprime le mot de passe et ferme les sessions ouvertes avec lui.
- Le mot de passe reste pour les adresses de l'équipe hors EPFL (`RUSH_ADMIN_EMAILS`).
- Le profil affiche « Compte EPFL vérifié », et l'écran Retraits indique pour chaque demande si l'adresse est vérifiée par l'EPFL.

## Pourboire suggéré

```
CHF 1.50 prise en charge
+ CHF 1.00 par 300 m de marche entre le spot et toi
+ CHF 0.30 par article supplémentaire
+ CHF 0.50 à l'heure de pointe (11h45–13h30)
→ arrondi aux 50 centimes, entre CHF 1.50 et CHF 9.00
```

Trois options sont proposées (minimum, suggéré, généreux). Côté rusher, chaque tranche de CHF 0.50 au-dessus du suggéré fait remonter la demande comme si elle était 100 m plus proche.

## Architecture

```
shared/          Code partagé client/serveur
  catalog.ts       Spots, menus, bâtiments (source de vérité des prix)
  pricing.ts       Pourboire suggéré, réservation, règlement
  geo.ts           Distances, temps de marche, calcul du détour
  hours.ts         Horaires d'ouverture (fuseau Europe/Zurich)
  types.ts         Contrat de l'API et des évènements temps réel
server/          Hono + SQLite (node:sqlite) + WebSocket (ws)
  services/        auth, orders, ledger, messages, presence, users,
                   epflMenus (offre du jour EPFL), places (photos et avis Google)
  data/            google-places.json (relevé Google Maps crédité)
  demo/bots.ts     Rushers simulés (mode démo uniquement)
src/             React 19 + Vite
  map/             MapLibre GL, style maison, marqueurs React
  screens/         Explorer, Spot, Demande, Suivi, Livrer, Activité, Messages, Chat, Solde, Profil
  state/           Zustand : panier, position, scène de carte, UI
  lib/             Requêtes TanStack Query, temps réel, formatage
  styles/          Design tokens (couleurs système iOS), composants
```

Chaque écran décrit une **scène** (caméra, trajets, épingles) et la carte se charge du rendu et des animations. Sur ordinateur, le contenu vit dans un panneau flottant en verre dépoli ; sur mobile, dans une feuille glissante à trois crans comme Apple Plans.

## Production

```bash
npm run build
npm start        # sert l'API, le WebSocket et l'app compilée sur le même port
```

Ou avec Docker (c'est ce qu'utilise Render) :

```bash
docker build -t rush-epfl .
docker run -p 8787:8787 -v rush-data:/app/data rush-epfl
```

### Render (offre gratuite)

`render.yaml` décrit le service : image Docker, région Francfort, sonde `/api/health`. Sur l'offre gratuite, l'instance se met en veille après 15 min sans visite (premier chargement ~1 min ensuite) et **le disque n'est pas persistant** : la base SQLite repart de zéro à chaque redémarrage ou déploiement. Pour garder les données, passer à une instance avec disque persistant monté sur `/app/data`.

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port HTTP | `8787` |
| `RUSH_DB` | Fichier SQLite | `data/rush.db` |
| `RUSH_ALLOWED_DOMAINS` | Domaines autorisés, séparés par des virgules | `epfl.ch` |
| `RUSH_DEMO` | `1` pour activer les rushers simulés | désactivé |
| `RUSH_WELCOME_BONUS_CENTS` | Crédit offert à chaque nouveau compte, en centimes | `100` |
| `STRIPE_TOPUP_URL` | Lien de paiement Stripe « montant libre » des recharges | recharges désactivées |
| `STRIPE_WEBHOOK_SECRET` | Secret `whsec_…` du webhook Stripe vers `/api/stripe/webhook` | recharges désactivées |
| `RUSH_ADMIN_EMAILS` | Adresses de l'équipe Rush (traitent les retraits, peuvent se connecter hors `@epfl.ch`) | aucune |
| `RUSH_NTFY_TOPIC` | Sujet ntfy.sh pour être prévenu des retraits sur téléphone | désactivé |
| `ENTRA_CLIENT_ID` | Identifiant de l'application enregistrée sur app-portal.epfl.ch | connexion EPFL désactivée |
| `ENTRA_CLIENT_SECRET` | Secret de cette application | connexion EPFL désactivée |
| `ENTRA_TENANT_ID` | Annuaire Microsoft autorisé | annuaire EPFL |
| `VITE_MAP_STYLE` | URL d'un style MapLibre alternatif (au build) | style maison |

Les tuiles viennent d'[OpenFreeMap](https://openfreemap.org) (gratuit, sans clé). Si elles ne répondent pas, la carte bascule automatiquement sur un fond raster CARTO.

### Menus du jour EPFL

Les restaurants de l'EPFL publient chaque jour leurs menus et leurs prix sur la page [Offre du jour](https://www.epfl.ch/campus/restaurants-shops-hotels/fr/offre-du-jour-de-tous-les-points-de-restauration/). Le serveur la lit en direct (`server/services/epflMenus.ts`), la garde 20 minutes en cache et range chaque offre dans le spot correspondant (champ `epfl` du catalogue). Rien n'est complété ni estimé : un plat sans prix ou vendu au poids s'affiche, mais ne se commande qu'en demande libre. Si la page ne répond pas, la fiche le dit et propose la demande libre.

### Photos et avis Google Maps

`server/data/google-places.json` contient un relevé des fiches Google Maps des spots (photos, avis, note), fait le 24 septembre 2026. Aucune clé d'API n'est nécessaire. Chaque photo et chaque avis restent crédités à leur auteur avec un lien vers son profil, et chaque fiche renvoie vers Google Maps. Les photos sont chargées directement depuis Google par le navigateur. Pour rafraîchir le relevé, il suffit de remplacer ce fichier en gardant le même format.

## À savoir avant un vrai lancement

- **Catalogue** (`shared/catalog.ts`) : tous les points de restauration du campus de Lausanne listés par l'EPFL, plus les commerces des Arcades. Horaires officiels (page Horaires de l'EPFL ou site du commerce), aucun prix estimé. Les positions viennent des fiches Google Maps quand elles sont précises, sinon du plan du campus.
- **Prix hors EPFL** : Holy Cow!, Migros, Denner et Le Négoce ne publient pas leurs prix en magasin (ceux d'Uber Eats sont majorés, donc faux au comptoir) : on y passe par une demande libre avec budget. La carte de Gina vient de son site officiel.
- **Photos et avis** : relevé Google Maps crédité, plus quelques photos des pages EPFL. Rien n'est repris d'Uber Eats ou de Tripadvisor.
- **Argent réel et disque non persistant** : sur l'offre gratuite de Render, la base repart de zéro à chaque veille ou déploiement, soldes rechargés compris. Avant d'ouvrir les recharges à d'autres personnes, monter un disque persistant sur `/app/data`. Tous les paiements restent visibles dans Stripe (adresse du payeur, montant) pour recréditer ou rembourser à la main.
- **Frais Stripe** : prélevés sur chaque recharge et payés par l'équipe (le solde est crédité du montant payé). Le compte Stripe encaisse en EUR : les paiements en CHF sont convertis. TWINT n'est pas activé sur ce compte Stripe ; les recharges passent par carte, Apple Pay ou Google Pay.
- **Authentification** : avec la connexion EPFL configurée, les adresses EPFL sont prouvées par l'annuaire de l'EPFL. Sans elle, et pour l'équipe hors EPFL, c'est une adresse + mot de passe (haché avec scrypt, adresse bloquée 15 min après 8 essais ratés, session de 30 jours) : aucun e-mail n'est envoyé, donc **l'adresse n'est pas vérifiée** et il n'y a pas de réinitialisation du mot de passe. Le crédit de bienvenue (CHF 1) reste inférieur à la plus petite commande possible, donc créer de faux comptes ne permet pas de commander gratuitement.
- **Notifications** : en temps réel dans l'app ; les notifications push hors app restent à ajouter (le bus d'évènements `server/services/bus.ts` est prévu pour ça).
