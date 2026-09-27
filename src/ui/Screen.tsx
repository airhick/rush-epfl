import { useRef, useState, type ReactNode, type UIEvent } from 'react';
import { useNavigate } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import { cx } from './primitives';

interface ScreenProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Titre compact affiché dans la barre quand on a défilé. */
  navTitle?: ReactNode;
  back?: string | true;
  backLabel?: string;
  trailing?: ReactNode;
  hero?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  onScroll?: (e: UIEvent<HTMLDivElement>) => void;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Gabarit d'écran iOS : grand titre qui se replie dans la barre de
 * navigation au défilement, pied de page collant pour l'action principale.
 */
export function Screen({
  title,
  subtitle,
  navTitle,
  back,
  backLabel,
  trailing,
  hero,
  footer,
  children,
  className,
  bodyClassName,
  onScroll,
  scrollRef,
}: ScreenProps) {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const localRef = useRef<HTMLDivElement>(null);
  const ref = scrollRef ?? localRef;
  const threshold = hero ? 140 : 36;

  const goBack = () => {
    if (back === true) navigate(-1);
    else if (back) navigate(back);
  };

  return (
    <section className={cx('screen', Boolean(hero) && 'screen--hero', Boolean(back) && 'screen--back', scrolled && 'is-scrolled', className)}>
      <header className="nav">
        <div className="nav__side">
          {back && (
            <button className="nav__back" onClick={goBack} aria-label={backLabel ?? 'Retour'}>
              <ChevronLeft size={24} strokeWidth={2.4} />
              {backLabel && <span>{backLabel}</span>}
            </button>
          )}
        </div>
        <div className="nav__title">{navTitle ?? (typeof title === 'string' ? title : null)}</div>
        <div className="nav__side nav__side--end">{trailing}</div>
      </header>

      <div
        ref={ref}
        className="screen__scroll"
        onScroll={(e) => {
          setScrolled(e.currentTarget.scrollTop > threshold);
          onScroll?.(e);
        }}
      >
        {hero}
        {(title || subtitle) && (
          <div className="screen__head">
            {title && <h1 className="large-title">{title}</h1>}
            {subtitle && <p className="screen__subtitle">{subtitle}</p>}
          </div>
        )}
        <div className={cx('screen__body', bodyClassName)}>{children}</div>
      </div>

      {footer && <div className="screen__footer">{footer}</div>}
    </section>
  );
}
