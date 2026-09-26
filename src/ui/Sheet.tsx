import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { X } from 'lucide-react';
import { useIsDesktop } from '../lib/useMedia';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Feuille modale : glisse depuis le bas sur mobile (et se ferme d'un
 * geste), s'affiche en carte centrée sur ordinateur.
 */
export function Sheet({ open, onClose, title, children, footer }: SheetProps) {
  const desktop = useIsDesktop();
  const drag = useDragControls();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={desktop ? 'modal modal--center' : 'modal modal--sheet'} role="dialog" aria-modal="true">
          <motion.div
            className="modal__scrim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          />
          <motion.div
            className="modal__panel"
            initial={desktop ? { opacity: 0, scale: 0.96, y: 8 } : { y: '100%' }}
            animate={desktop ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
            exit={desktop ? { opacity: 0, scale: 0.97, y: 4 } : { y: '100%' }}
            transition={desktop ? { duration: 0.22, ease: [0.22, 1, 0.36, 1] } : { type: 'spring', stiffness: 420, damping: 40 }}
            drag={desktop ? false : 'y'}
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose();
            }}
          >
            {!desktop && <div className="modal__grabber" onPointerDown={(e) => drag.start(e)} />}
            <div className="modal__head" onPointerDown={(e) => !desktop && drag.start(e)}>
              <div className="modal__title">{title}</div>
              <button className="modal__close" onClick={onClose} aria-label="Fermer">
                <X size={16} strokeWidth={2.6} />
              </button>
            </div>
            <div className="modal__body">{children}</div>
            {footer && <div className="modal__footer">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
