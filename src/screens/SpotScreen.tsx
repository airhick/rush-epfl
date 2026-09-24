import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Clock, Leaf, MessageSquareText, Minus, Plus, ShoppingBag, Star } from 'lucide-react';
import {
  CUSTOM_BUDGET_MAX_CENTS,
  CUSTOM_BUDGET_MIN_CENTS,
  CUSTOM_TEXT_MAX,
  isOrderable,
  KIND_LABEL,
  SPOT_BY_ID,
  type ItemTag,
  type MenuItem,
  type PriceTiers,
  type Spot,
} from '../../shared/catalog';
import { formatDistance, walkingDistance, walkingMinutes } from '../../shared/geo';
import { openStatus } from '../../shared/hours';
import { suggestTip } from '../../shared/pricing';
import { formatCHF } from '../../shared/money';
import type { SpotMenu } from '../../shared/types';
import { useActivity, usePlaceMedia, useSpotMenu } from '../lib/queries';
import { PhotoGallery, PlaceReviews } from '../features/PlaceMedia';
import { joinNames, plural } from '../lib/format';
import { useCart, useCartSummary, type CustomRequest } from '../state/cart';
import { useDropoff, useGeo } from '../state/location';
import { useMapScene } from '../state/scene';
import { Screen } from '../ui/Screen';
import { Sheet } from '../ui/Sheet';
import { AvatarStack, Button, cx, Empty, Skeleton, SpotCover, Stepper } from '../ui/primitives';

const TAG_LABEL: Record<ItemTag, string> = { vege: 'Végétarien', vegan: 'Vegan' };

const TIERS: { key: keyof PriceTiers; label: string }[] = [
  { key: 'student', label: 'étudiant' },
  { key: 'doctoral', label: 'doctorant' },
  { key: 'campus', label: 'campus' },
  { key: 'visitor', label: 'visiteur' },
];

const longDate = (iso: string) =>
  new Intl.DateTimeFormat('fr-CH', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T12:00:00`));

/** Prix tels que publiés : prix par statut EPFL, prix unique, prix au poids ou pas de prix. */
function Price({ item }: { item: MenuItem }) {
  if (item.per100gCents) {
    return <span className="menu-item__price">{formatCHF(item.per100gCents)} les 100 g · au poids, sur place</span>;
  }
  if (!isOrderable(item)) return <span className="menu-item__price is-muted">Prix non publié</span>;
  const tiers = TIERS.filter((t) => item.tiers?.[t.key] !== undefined).map((t) => ({ ...t, cents: item.tiers![t.key]! }));
  const distinct = new Set(tiers.map((t) => t.cents)).size;
  if (tiers.length < 2 || distinct === 1) return <span className="menu-item__price">{formatCHF(item.priceCents)}</span>;
  const [first, ...rest] = tiers;
  return (
    <span className="menu-item__prices">
      <span className="menu-item__price">
        {formatCHF(first.cents)} <em>{first.label}</em>
      </span>
      <span className="menu-item__tiers">{rest.map((t) => `${t.label} ${formatCHF(t.cents, { bare: true })}`).join(' · ')}</span>
    </span>
  );
}

function DailyNotice({ spot, menu }: { spot: Spot; menu: SpotMenu | undefined }) {
  if (!spot.epfl) return null;
  if (!menu?.daily) {
    return (
      <div className="daily-notice">
        <Skeleton h={14} w="70%" />
      </div>
    );
  }
  const { daily } = menu;
  const source = (
    <a href={daily.sourceUrl} target="_blank" rel="noreferrer">
      epfl.ch <ArrowUpRight size={12} />
    </a>
  );
  if (daily.status === 'ok') {
    return (
      <p className="daily-notice">
        Menu du {longDate(daily.date)}, prix publiés par l’EPFL · {source}
      </p>
    );
  }
  if (daily.status === 'empty') {
    return (
      <p className="daily-notice">
        L’EPFL n’a pas publié de menu pour {spot.name} aujourd’hui. Passe par une demande libre ou consulte {source}.
      </p>
    );
  }
  return (
    <p className="daily-notice is-warning">
      La page des menus de l’EPFL ne répond pas pour l’instant. Réessaie dans un moment, ou passe par une demande libre.
    </p>
  );
}

function CustomRequestSheet({
  open,
  onClose,
  spot,
  initial,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  spot: Spot;
  initial: CustomRequest | null;
  onSave: (request: CustomRequest | null) => void;
}) {
  const [text, setText] = useState(initial?.text ?? '');
  const [budget, setBudget] = useState(initial?.budgetCents ?? 1000);
  useEffect(() => {
    if (!open) return;
    setText(initial?.text ?? '');
    setBudget(initial?.budgetCents ?? 1000);
  }, [open, initial]);
  const step = (d: number) => setBudget((b) => Math.min(CUSTOM_BUDGET_MAX_CENTS, Math.max(CUSTOM_BUDGET_MIN_CENTS, b + d)));
  const valid = text.trim().length >= 3;

  return (
    <Sheet open={open} onClose={onClose} title="Demande libre">
      <p className="sheet-text">
        Décris ce que tu veux chez <strong>{spot.name}</strong>. Ton rusher paie le prix affiché en caisse et déclare le ticket exact :
        tu ne paies que ce qui a été dépensé, sans jamais dépasser ton budget.
      </p>
      <label className="custom-request__field">
        <textarea
          value={text}
          maxLength={CUSTOM_TEXT_MAX}
          rows={3}
          placeholder={spot.kind === 'grocery' ? 'Ex. : 1 l de lait, 6 œufs, des bananes' : 'Ex. : le menu végétarien du jour et une eau plate'}
          onChange={(e) => setText(e.target.value)}
        />
        <span>
          {text.length}/{CUSTOM_TEXT_MAX}
        </span>
      </label>
      <div className="custom-request__budget">
        <span>
          <strong>Budget maximum</strong>
          <span>Le rusher ne dépasse pas ce montant.</span>
        </span>
        <div className="tip-custom__ctrl">
          <button onClick={() => step(-100)} disabled={budget <= CUSTOM_BUDGET_MIN_CENTS} aria-label="Moins">
            <Minus size={16} strokeWidth={2.6} />
          </button>
          <strong>{formatCHF(budget)}</strong>
          <button onClick={() => step(100)} disabled={budget >= CUSTOM_BUDGET_MAX_CENTS} aria-label="Plus">
            <Plus size={16} strokeWidth={2.6} />
          </button>
        </div>
      </div>
      <div className="sheet-actions">
        <Button
          block
          disabled={!valid}
          onClick={() => {
            onSave({ text: text.trim(), budgetCents: budget });
            onClose();
          }}
        >
          {initial ? 'Mettre à jour' : 'Ajouter à ma demande'}
        </Button>
        {initial && (
          <Button
            block
            variant="secondary"
            onClick={() => {
              onSave(null);
              onClose();
            }}
          >
            Retirer la demande libre
          </Button>
        )}
      </div>
    </Sheet>
  );
}

export function SpotScreen() {
  const { id } = useParams();
  const spot = id ? SPOT_BY_ID.get(id) : undefined;
  const navigate = useNavigate();
  const geo = useGeo();
  const dropoff = useDropoff();
  const cart = useCart();
  const summary = useCartSummary();
  const { data: activity } = useActivity();
  const { data: media } = usePlaceMedia(spot?.id);
  const { data: menu, isLoading: menuLoading } = useSpotMenu(spot?.id);
  const [conflict, setConflict] = useState<(() => void) | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [section, setSection] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

  useMapScene(
    () =>
      spot
        ? {
            cameraKey: `spot-${spot.id}`,
            camera: { kind: 'fly', center: spot, zoom: 17.2, pitch: 45 },
            highlightSpotId: spot.id,
            focusSpotIds: [spot.id],
          }
        : { cameraKey: 'overview', camera: { kind: 'overview' } },
    [spot?.id],
  );

  const sections = menu?.sections ?? spot?.menu ?? [];
  const tabs = [...sections.map((s) => s.title), 'Demande libre'];

  // Onglet de section actif selon la position de défilement.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const onScroll = () => {
      const top = root.getBoundingClientRect().top + 120;
      let current = 0;
      sectionRefs.current.forEach((el, i) => {
        if (el && el.getBoundingClientRect().top <= top) current = i;
      });
      setSection(current);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [spot?.id, sections.length]);

  const status = useMemo(() => (spot ? openStatus(spot.hours) : null), [spot]);

  if (!spot || !status) {
    return (
      <Screen back="/">
        <Empty icon={<ShoppingBag size={26} />} title="Spot introuvable" />
      </Screen>
    );
  }

  const rushers = activity?.find((a) => a.spotId === spot.id)?.rushers ?? [];
  const distance = walkingDistance(geo.position, spot);
  const tip = suggestTip({ spot, dropoff, itemCount: 1 });
  const inCart = cart.spotId === spot.id;
  const otherSpot = cart.spotId !== null && cart.spotId !== spot.id && summary.count > 0;

  /** Un rusher ne passe que par un spot : on demande avant d'écraser une autre demande. */
  const guard = (action: () => void) => (otherSpot ? setConflict(() => action) : action());

  const jump = (i: number) => {
    const el = sectionRefs.current[i];
    const root = scroller.current;
    if (el && root) root.scrollTo({ top: el.offsetTop - 104, behavior: 'smooth' });
  };

  const fallbackHero = (
    <div className="spot-hero">
      <SpotCover spot={spot} height={208} width={900} />
    </div>
  );

  return (
    <Screen
      back="/"
      navTitle={spot.name}
      scrollRef={scroller}
      hero={media && media.photos.length > 0 ? <PhotoGallery media={media} fallback={fallbackHero} /> : fallbackHero}
      footer={
        <AnimatePresence>
          {inCart && summary.count > 0 && (
            <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}>
              <Button block onClick={() => navigate('/checkout')} className="cart-btn">
                <span className="cart-btn__count">{summary.count}</span>
                <span>Voir la demande</span>
                <span className="cart-btn__total">{formatCHF(summary.subtotalCents)}</span>
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      }
    >
      <div className="spot-head">
        <h1 className="title1">{spot.name}</h1>
        <p className="spot-head__tagline">{spot.tagline}</p>
        <p className="spot-head__meta">
          {KIND_LABEL[spot.kind]} · {spot.place}
        </p>
        {media?.rating != null && (
          <a className="ext-rating" href={media.mapsUrl} target="_blank" rel="noreferrer">
            <Star size={13} fill="currentColor" strokeWidth={0} />
            {media.rating.toFixed(1).replace('.', ',')}
            <span>sur Google Maps ({media.ratingCount} avis)</span>
            <ArrowUpRight size={13} />
          </a>
        )}
      </div>

      <div className="info-strip">
        <div className="info-strip__cell">
          <strong>{walkingMinutes(distance)} min</strong>
          <span>à pied · {formatDistance(distance)}</span>
        </div>
        <div className="info-strip__cell">
          <strong className={cx(status.open ? 'text-green' : 'text-red')}>{status.open ? 'Ouvert' : 'Fermé'}</strong>
          <span>{status.label.split('· ')[1] ?? status.label}</span>
        </div>
        <div className="info-strip__cell">
          <strong>{formatCHF(tip.suggestedCents)}</strong>
          <span>pourboire suggéré</span>
        </div>
      </div>

      {status.open && rushers.length > 0 && (
        <div className="rushers-callout">
          <AvatarStack users={rushers} size={28} />
          <p>
            <strong>{joinNames(rushers.slice(0, 3).map((r) => r.firstName))}</strong>{' '}
            {rushers.length > 1 ? 'sont sur place' : 'est sur place'} : ta demande peut partir tout de suite.
          </p>
        </div>
      )}

      {!status.open && (
        <div className="closed-callout">
          <Clock size={18} />
          <p>
            <strong>{status.label}</strong>
            <br />
            Tu peux consulter le menu, les demandes rouvriront à l’ouverture.
          </p>
        </div>
      )}

      <div className="menu-tabs">
        {tabs.map((title, i) => (
          <button key={title} className={cx('menu-tabs__tab', section === i && 'is-active')} onClick={() => jump(i)}>
            {title}
          </button>
        ))}
      </div>

      <DailyNotice spot={spot} menu={menu} />
      {menuLoading && spot.epfl && (
        <div className="menu-loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="menu-item">
              <div className="menu-item__text">
                <Skeleton h={16} w="60%" />
                <Skeleton h={12} w="85%" />
                <Skeleton h={13} w="40%" />
              </div>
            </div>
          ))}
        </div>
      )}

      {sections.map((s, i) => (
        <section
          key={s.title}
          className="menu-section"
          ref={(el) => {
            sectionRefs.current[i] = el;
          }}
        >
          <h2 className="menu-section__title">{s.title}</h2>
          {s.items.map((item) => {
            const qty = inCart ? (cart.lines[item.id]?.qty ?? 0) : 0;
            const orderable = isOrderable(item);
            return (
              <div key={item.id} className={cx('menu-item', qty > 0 && 'is-in-cart', !orderable && 'is-info')}>
                <div className="menu-item__text">
                  <span className="menu-item__name">
                    {qty > 0 && <span className="menu-item__qty">{qty}×</span>}
                    {item.name}
                  </span>
                  {item.description && <span className="menu-item__desc">{item.description}</span>}
                  <span className="menu-item__meta">
                    <Price item={item} />
                    {item.tags?.map((t) => (
                      <span key={t} className={cx('tag', `tag--${t}`)}>
                        <Leaf size={11} strokeWidth={2.4} />
                        {TAG_LABEL[t]}
                      </span>
                    ))}
                  </span>
                  {item.allergens && <span className="menu-item__allergens">Allergènes : {item.allergens.join(', ')}</span>}
                </div>
                {orderable &&
                  (qty > 0 ? (
                    <Stepper compact value={qty} onChange={(n) => cart.setQty(item.id, n)} />
                  ) : (
                    <button
                      className="add-btn"
                      onClick={() => guard(() => cart.add(spot.id, item))}
                      disabled={!status.open}
                      aria-label={`Ajouter ${item.name}`}
                    >
                      <Plus size={18} strokeWidth={2.6} />
                    </button>
                  ))}
              </div>
            );
          })}
        </section>
      ))}

      <section
        className="menu-section"
        ref={(el) => {
          sectionRefs.current[sections.length] = el;
        }}
      >
        <h2 className="menu-section__title">Demande libre</h2>
        <button className="custom-request" onClick={() => setCustomOpen(true)} disabled={!status.open}>
          <span className="custom-request__icon">
            <MessageSquareText size={18} />
          </span>
          <span className="custom-request__text">
            {inCart && cart.custom ? (
              <>
                <strong>{cart.custom.text}</strong>
                <span>Budget maximum {formatCHF(cart.custom.budgetCents)} · toucher pour modifier</span>
              </>
            ) : (
              <>
                <strong>Autre chose ?</strong>
                <span>
                  {sections.length === 0
                    ? `${spot.name} ne publie pas ses prix : décris ce que tu veux et fixe un budget.`
                    : 'Un café, une boisson, un article du rayon : décris-le et fixe un budget.'}
                </span>
              </>
            )}
          </span>
          <Plus size={18} strokeWidth={2.6} className="custom-request__plus" />
        </button>
      </section>

      {media && <PlaceReviews media={media} />}

      <section className="ext-sources">
        <h2>Sources</h2>
        <div className="ext-sources__links">
          {spot.sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
              {s.label}
              <ArrowUpRight size={14} />
            </a>
          ))}
          {media && (
            <a href={media.mapsUrl} target="_blank" rel="noreferrer">
              Google Maps · photos et avis
              <ArrowUpRight size={14} />
            </a>
          )}
        </div>
        <p className="ext-sources__disclaimer">
          Menus et prix du jour lus en direct sur le site de l’EPFL ; cartes fixes relevées sur le site officiel du restaurant. Photos et avis
          Google Maps crédités à leurs auteurs. Rush réserve le prix publié le plus élevé : ton rusher déclare le ticket exact et tu ne paies
          que ce qui a été dépensé. Rush n’est affilié à aucun de ces services.
        </p>
      </section>

      <CustomRequestSheet
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        spot={spot}
        initial={inCart ? cart.custom : null}
        onSave={(request) => guard(() => cart.setCustom(spot.id, request))}
      />

      <Sheet open={conflict !== null} onClose={() => setConflict(null)} title="Nouvelle demande ?">
        <p className="sheet-text">
          Ta demande en cours contient {plural(summary.count, 'article', 'articles')} de <strong>{summary.spot?.name}</strong>. Un rusher
          ne passe que par un spot à la fois.
        </p>
        <div className="sheet-actions">
          <Button
            block
            onClick={() => {
              cart.clear();
              conflict?.();
              setConflict(null);
            }}
          >
            Recommencer ici
          </Button>
          <Button block variant="secondary" onClick={() => setConflict(null)}>
            Garder ma demande
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}
