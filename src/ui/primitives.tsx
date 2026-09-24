import { forwardRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Minus, Plus, Star } from 'lucide-react';
import type { PublicUser } from '../../shared/types';
import type { Spot } from '../../shared/catalog';
import { GLYPHS, photoUrl } from '../lib/spotStyle';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

/* ── Boutons ─────────────────────────────────────────────────────────── */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'tinted' | 'ghost' | 'danger' | 'success';
  size?: 'lg' | 'md' | 'sm';
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'lg', block, loading, icon, children, className, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx('btn', `btn--${variant}`, `btn--${size}`, block && 'btn--block', loading && 'is-loading', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 18} /> : icon}
      {children && <span className="btn__label">{children}</span>}
    </button>
  );
});

export function IconButton({
  label,
  children,
  className,
  glass,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; glass?: boolean }) {
  return (
    <button aria-label={label} title={label} className={cx('icon-btn', glass && 'icon-btn--glass', className)} {...rest}>
      {children}
    </button>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg className="spinner" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x="11" y="2" width="2" height="6" rx="1" transform={`rotate(${i * 45} 12 12)`} opacity={0.25 + i * 0.09} />
      ))}
    </svg>
  );
}

/* ── Identité ────────────────────────────────────────────────────────── */

export function Avatar({
  user,
  size = 36,
  ring,
  className,
}: {
  user: Pick<PublicUser, 'firstName' | 'lastInitial' | 'hue'>;
  size?: number;
  ring?: boolean;
  className?: string;
}) {
  const initials = `${user.firstName[0] ?? ''}${user.lastInitial[0] ?? ''}`.toUpperCase();
  return (
    <span
      className={cx('avatar', ring && 'avatar--ring', className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(160deg, hsl(${user.hue} 72% 66%), hsl(${(user.hue + 28) % 360} 62% 46%))`,
      }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function AvatarStack({ users, size = 24, max = 3 }: { users: PublicUser[]; size?: number; max?: number }) {
  return (
    <span className="avatar-stack" style={{ height: size }}>
      {users.slice(0, max).map((u) => (
        <Avatar key={u.id} user={u} size={size} ring />
      ))}
      {users.length > max && (
        <span className="avatar avatar--ring avatar--more" style={{ width: size, height: size, fontSize: size * 0.36 }}>
          +{users.length - max}
        </span>
      )}
    </span>
  );
}

export function Rating({ user, compact }: { user: PublicUser; compact?: boolean }) {
  if (user.rating === null) return <span className="rating rating--new">Nouveau</span>;
  return (
    <span className="rating">
      <Star size={12} fill="currentColor" strokeWidth={0} />
      {user.rating.toFixed(1).replace('.', ',')}
      {!compact && <span className="rating__count">({user.ratingCount})</span>}
    </span>
  );
}

export function StarsInput({ value, onChange, size = 34 }: { value: number; onChange: (n: number) => void; size?: number }) {
  return (
    <div className="stars-input" role="radiogroup" aria-label="Note">
      {[1, 2, 3, 4, 5].map((n) => (
        <motion.button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} étoile${n > 1 ? 's' : ''}`}
          whileTap={{ scale: 0.8 }}
          className={cx('stars-input__star', n <= value && 'is-on')}
          onClick={() => onChange(n)}
        >
          <Star size={size} strokeWidth={1.5} fill={n <= value ? 'currentColor' : 'none'} />
        </motion.button>
      ))}
    </div>
  );
}

/* ── Spots ───────────────────────────────────────────────────────────── */

export function SpotBadge({ spot, size = 44 }: { spot: Spot; size?: number; radius?: number }) {
  const Icon = GLYPHS[spot.glyph];
  return (
    <span className="spot-badge" style={{ width: size, height: size }} aria-hidden>
      <Icon size={size * 0.5} strokeWidth={1.9} />
    </span>
  );
}

/** Vignette de liste : la photo du spot, sinon son pictogramme blanc sur fond noir. */
export function SpotThumb({ spot, size = 60 }: { spot: Spot; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!spot.cover || failed) return <SpotBadge spot={spot} size={size} />;
  return (
    <img
      className="spot-thumb"
      src={photoUrl(spot.cover.url, size * 3, size * 3)}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

/** Couverture : la photo du spot (créditée), sinon son pictogramme blanc sur fond noir. */
export function SpotCover({ spot, height = 132, className, width = 640 }: { spot: Spot; height?: number; className?: string; width?: number }) {
  const Icon = GLYPHS[spot.glyph];
  const [failed, setFailed] = useState(false);
  const cover = spot.cover && !failed ? spot.cover : null;
  return (
    <div className={cx('spot-cover', className)} style={{ height }}>
      {cover ? (
        <>
          <img
            src={photoUrl(cover.url, width)}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
          <span className="spot-cover__credit">
            © {cover.credit}
            {cover.source === 'google' && ' · Google Maps'}
          </span>
        </>
      ) : (
        <Icon className="spot-cover__glyph" strokeWidth={1.6} aria-hidden />
      )}
    </div>
  );
}

/* ── Contrôles ───────────────────────────────────────────────────────── */

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 12,
  compact,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  compact?: boolean;
}) {
  return (
    <div className={cx('stepper', compact && 'stepper--compact')}>
      <button type="button" aria-label="Retirer" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>
        <Minus size={16} strokeWidth={2.4} />
      </button>
      <motion.span key={value} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="stepper__value">
        {value}
      </motion.span>
      <button type="button" aria-label="Ajouter" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>
        <Plus size={16} strokeWidth={2.4} />
      </button>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)}>
      <motion.span className="switch__thumb" layout transition={{ type: 'spring', stiffness: 600, damping: 34 }} />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  id,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  id: string;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className="segmented__opt" onClick={() => onChange(o.value)}>
          {o.value === value && (
            <motion.span layoutId={`seg-${id}`} className="segmented__thumb" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
          )}
          <span className="segmented__label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Chip({
  active,
  children,
  icon,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; icon?: ReactNode }) {
  return (
    <button type="button" className={cx('chip', active && 'is-active')} aria-pressed={active} {...rest}>
      {icon}
      {children}
    </button>
  );
}

/* ── Listes groupées façon Réglages ─────────────────────────────────── */

export function Group({
  header,
  footer,
  children,
  inset = true,
  className,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  inset?: boolean;
  className?: string;
}) {
  return (
    <section className={cx('group', inset && 'group--inset', className)}>
      {header && <h3 className="group__header">{header}</h3>}
      <div className="group__body">{children}</div>
      {footer && <p className="group__footer">{footer}</p>}
    </section>
  );
}

export function Row({
  leading,
  title,
  subtitle,
  trailing,
  chevron,
  onClick,
  destructive,
  className,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onClick?: () => void;
  destructive?: boolean;
  className?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={cx('row', onClick && 'row--tap', destructive && 'row--destructive', className)} onClick={onClick}>
      {leading && <span className="row__leading">{leading}</span>}
      <span className="row__text">
        <span className="row__title">{title}</span>
        {subtitle && <span className="row__subtitle">{subtitle}</span>}
      </span>
      {trailing !== undefined && <span className="row__trailing">{trailing}</span>}
      {chevron && (
        <svg className="row__chevron" width="8" height="13" viewBox="0 0 8 13" aria-hidden>
          <path d="M1.5 1.5 6.5 6.5l-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </Tag>
  );
}

/** Pictogramme blanc sur fond noir, sans cadre carré. */
export function IconTile({ children, size = 30 }: { color?: string; children: ReactNode; size?: number }) {
  return (
    <span className="icon-tile" style={{ width: size, height: size }}>
      {children}
    </span>
  );
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', r = 8 }: { h?: number; w?: number | string; r?: number }) {
  return <span className="skeleton" style={{ height: h, width: w, borderRadius: r }} />;
}
