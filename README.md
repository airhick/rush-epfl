# Rush

**La graille du campus, ramenée par ceux qui y sont déjà.**

Rush est une web app communautaire réservée à l'EPFL. Tu es à l'INF et tu as faim ? Quelqu'un qui est déjà au Parmentier — ou qui y passe — prend ta commande sur son chemin et te l'amène. Le paiement passe par un solde intégré, le pourboire est suggéré au juste prix, et tout se suit sur une carte du campus.

## Ce que fait l'app

| | |
|---|---|
| **Carte intégrée** | Tous les spots de graille de l'EPFL et autour (UNIL), avec les rushers présents en direct, les trajets et la position du livreur. Style vectoriel maison inspiré d'Apple Plans, bâtiments en 3D, clair/sombre. |
| **Commander** | Menus par spot, panier, point de livraison par GPS, bâtiment ou épingle déplaçable sur la carte, note visible uniquement par le rusher. |
| **Livrer** | Tu indiques où tu es et où tu vas : les demandes sont triées selon le **détour** qu'elles t'imposent (« Sur ton chemin », « +320 m de détour »). |
| **Solde Rush** | Porte-monnaie local : **CHF 1.00 offert** à chaque nouveau compte, puis le solde se gagne en livrant. Montant réservé à la commande, règlement du rusher à la livraison, reste rendu automatiquement. |
| **Pourboire suggéré** | Calculé à partir de la distance à pied, du nombre d'articles et de l'heure de pointe, avec le détail affiché ligne par ligne. |
| **Messagerie** | Une conversation par commande, en temps réel (WebSocket), indicateur de saisie, réponses rapides contextuelles, messages système. |
| **Suivi** | Barre de progression façon Uber (publiée → acceptée → achetée → livrée), ETA, position live du rusher, notation mutuelle. |
| **Accès EPFL uniquement** | Connexion par code à 6 chiffres envoyé sur l'adresse `@epfl.ch`. |

## Démarrer

Prérequis : **Node 22.13+** (SQLite intégré à Node, aucune dépendance native).

```bash
npm install
npm run dev
```

Ouvre <http://localhost:5173> et connecte-toi avec n'importe quelle adresse `@epfl.ch`. Sans serveur SMTP, le code s'affiche dans la console du serveur **et** dans l'app (bouton « Mode développement »).

`npm run dev` active le **mode démo** (`RUSH_DEMO=1`) : huit rushers simulés publient des demandes, acceptent les tiennes, se déplacent sur la carte et te répondent dans le chat. Idéal pour tester seul. Pour tester à deux humains, ouvre une seconde fenêtre de navigation privée avec une autre adresse.

```bash
npm test          # tarification, horaires, géo, cycle commande/solde complet
npm run typecheck
```

## Comment l'argent circule

Tous les montants sont en centimes, et le solde est **toujours la somme d'un registre append-only** (`transactions`) : rien n'est jamais modifié en place.

0. **Bienvenue** — chaque nouveau compte reçoit CHF 1.00 (`RUSH_WELCOME_BONUS_CENTS`). Il n'y a pas de recharge : le solde s'alimente en livrant pour les autres.
1. **Publication** — réservation de `articles + 10 % de marge + pourboire` sur le solde du demandeur. La marge absorbe les écarts entre prix indicatifs et prix réels.
2. **Achat** — le rusher paie au comptoir et déclare le montant du ticket (plafonné au montant réservé).
3. **Confirmation** — le rusher reçoit `ticket + pourboire`, le demandeur récupère le reste.
4. **Annulation / expiration** — tout est rendu. Une demande sans rusher expire après 40 min ; une livraison non confirmée est validée automatiquement après 15 min.

Le serveur recalcule toujours les prix depuis le catalogue et ne fait jamais confiance aux montants envoyés par le navigateur.

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
  services/        auth, orders, ledger, messages, presence, users
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

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port HTTP | `8787` |
| `RUSH_DB` | Fichier SQLite | `data/rush.db` |
| `SMTP_URL` | Envoi des codes par e-mail (`smtps://user:pass@host`) | console |
| `MAIL_FROM` | Expéditeur des e-mails | `Rush <no-reply@rush.epfl.ch>` |
| `RUSH_ALLOWED_DOMAINS` | Domaines autorisés, séparés par des virgules | `epfl.ch` |
| `RUSH_DEMO` | `1` pour activer les rushers simulés | désactivé |
| `RUSH_WELCOME_BONUS_CENTS` | Crédit offert à chaque nouveau compte, en centimes | `100` |
| `VITE_MAP_STYLE` | URL d'un style MapLibre alternatif (au build) | style maison |

Les tuiles viennent d'[OpenFreeMap](https://openfreemap.org) (gratuit, sans clé). Si elles ne répondent pas, la carte bascule automatiquement sur un fond raster CARTO.

## À savoir avant un vrai lancement

- **SMTP obligatoire en production** : sans `SMTP_URL`, les codes de connexion ne partent que dans les logs du serveur (un avertissement s'affiche au démarrage).
- **Coordonnées des spots** : placées à la main et approximatives. Elles sont toutes dans `shared/catalog.ts`, à vérifier sur le terrain (les prix aussi sont indicatifs).
- **Pas de recharge** : retirée tant qu'aucun vrai moyen de paiement (TWINT, Stripe, Camipro) n'est branché. Avec le crédit par défaut, une première commande (minimum ~CHF 2.40) suppose d'avoir livré au moins une fois.
- **Authentification** : le code par e-mail limite l'accès aux adresses `@epfl.ch` ; une intégration au SSO EPFL (Microsoft Entra ID) serait l'étape suivante.
- **Notifications** : en temps réel dans l'app ; les notifications push hors app restent à ajouter (le bus d'évènements `server/services/bus.ts` est prévu pour ça).
