import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Clock, Flame, Footprints, Leaf, Plus, ShoppingBag, Sprout } from 'lucide-react';
import { KIND_LABEL, SPOT_BY_ID, type ItemTag, type MenuItem } from '../../shared/catalog';
import { formatDistance, walkingDistance, walkingMinutes } from '../../shared/geo';
import { openStatus } from '../../shared/hours';
import { suggestTip } from '../../shared/pricing';
import { formatCHF } from '../../shared/money';
import { useActivity } from '../lib/queries';
import { joinNames, plural } from '../lib/format';
import { useCart, useCartSummary } from '../state/cart';
import { useDropoff, useGeo } from '../state/location';
import { useMapScene } from '../state/scene';
import { Screen } from '../ui/Screen';
import { Sheet } from '../ui/Sheet';
import { AvatarStack, Button, cx, Empty, SpotCover, Stepper } from '../ui/primitives';

const TAG: Record<ItemTag, { icon: typeof Leaf; label: string } | null> = {
  vege: { icon: Leaf, label: 'Végé' },
  vegan: { icon: Sprout, label: 'Vegan' },
  popular: { icon: Flame, label: 'Populaire' },
  hot: null,
};

export function SpotScreen() {
  const { id } = useParams();
  const spot = id ? SPOT_BY_ID.get(id) : undefined;
  const navigate = useNavigate();
  const geo = useGeo();
  const dropoff = useDropoff();
  const cart = useCart();
  const summary = useCartSummary();
  const { data: activity } = useActivity();
  const [conflict, setConflict] = useState<MenuItem | null>(null);
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
  }, [spot?.id]);

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

  const add = (item: MenuItem) => {
    if (cart.spotId && cart.spotId !== spot.id && summary.count > 0) setConflict(item);
    else cart.add(spot.id, item.id);
  };

  const jump = (i: number) => {
    const el = sectionRefs.current[i];
    const root = scroller.current;
    if (el && root) root.scrollTo({ top: el.offsetTop - 104, behavior: 'smooth' });
  };

  return (
    <Screen
      back="/"
      navTitle={spot.name}
      scrollRef={scroller}
      hero={
        <div className="spot-hero">
          <SpotCover spot={spot} height={168} />
        </div>
      }
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
          {KIND_LABEL[spot.kind]} · {spot.place} · {['Petit budget', 'Budget moyen', 'Plus cher'][spot.priceLevel - 1]}
        </p>
      </div>

      <div className="info-strip">
        <div className="info-strip__cell">
          <Footprints size={17} />
          <strong>{walkingMinutes(distance)} min</strong>
          <span>{formatDistance(distance)} de toi</span>
        </div>
        <div className="info-strip__cell">
          <Clock size={17} />
          <strong className={cx(status.open ? 'text-green' : 'text-red')}>{status.open ? 'Ouvert' : 'Fermé'}</strong>
          <span>{status.label.split('· ')[1] ?? status.label}</span>
        </div>
        <div className="info-strip__cell">
          <span className="info-strip__tip">{formatCHF(tip.suggestedCents, { bare: true })}</span>
          <strong>Pourboire</strong>
          <span>suggéré</span>
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
            Tu peux consulter la carte, les demandes rouvriront à l’ouverture.
          </p>
        </div>
      )}

      <div className="menu-tabs">
        {spot.menu.map((s, i) => (
          <button key={s.title} className={cx('menu-tabs__tab', section === i && 'is-active')} onClick={() => jump(i)}>
            {s.title}
          </button>
        ))}
      </div>

      {spot.menu.map((s, i) => (
        <section
          key={s.title}
          className="menu-section"
          ref={(el) => {
            sectionRefs.current[i] = el;
          }}
        >
          <h2 className="menu-section__title">{s.title}</h2>
          {s.items.map((item) => {
            const qty = inCart ? (cart.lines[item.id] ?? 0) : 0;
            return (
              <div key={item.id} className={cx('menu-item', qty > 0 && 'is-in-cart')}>
                <div className="menu-item__text">
                  <span className="menu-item__name">
                    {qty > 0 && <span className="menu-item__qty">{qty}×</span>}
                    {item.name}
                  </span>
                  {item.description && <span className="menu-item__desc">{item.description}</span>}
                  <span className="menu-item__meta">
                    <span className="menu-item__price">{formatCHF(item.priceCents)}</span>
                    {item.tags?.map((t) => {
                      const tag = TAG[t];
                      if (!tag) return null;
                      const Icon = tag.icon;
                      return (
                        <span key={t} className={cx('tag', `tag--${t}`)}>
                          <Icon size={11} strokeWidth={2.4} />
                          {tag.label}
                        </span>
                      );
                    })}
                  </span>
                </div>
                {qty > 0 ? (
                  <Stepper compact value={qty} onChange={(n) => cart.setQty(item.id, n)} />
                ) : (
                  <button className="add-btn" onClick={() => add(item)} disabled={!status.open} aria-label={`Ajouter ${item.name}`}>
                    <Plus size={18} strokeWidth={2.6} />
                  </button>
                )}
              </div>
            );
          })}
        </section>
      ))}
      <p className="footnote">Prix indicatifs. Ton rusher saisit le montant exact du ticket : tu ne paies que ce qui a été dépensé.</p>

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
              if (conflict) cart.add(spot.id, conflict.id);
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
