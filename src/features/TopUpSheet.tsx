import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, CreditCard, GraduationCap, Smartphone } from 'lucide-react';
import { formatCHF } from '../../shared/money';
import { useTopUp } from '../lib/queries';
import { Sheet } from '../ui/Sheet';
import { Button, Chip, Group, IconTile, Row } from '../ui/primitives';

const AMOUNTS = [1000, 2000, 5000, 10000];
const METHODS = [
  { id: 'twint', label: 'TWINT', sub: 'Confirmation dans l’app TWINT', icon: Smartphone, color: '#000' },
  { id: 'card', label: 'Carte bancaire', sub: 'Visa, Mastercard, PostFinance', icon: CreditCard, color: '#5856D6' },
  { id: 'camipro', label: 'Camipro', sub: 'Débité de ta carte Camipro', icon: GraduationCap, color: '#E2001A' },
] as const;

export function TopUpSheet({ open, onClose, suggestedCents }: { open: boolean; onClose: () => void; suggestedCents?: number }) {
  const [amount, setAmount] = useState(2000);
  const [method, setMethod] = useState<(typeof METHODS)[number]['id']>('twint');
  const [done, setDone] = useState(false);
  const topUp = useTopUp();

  useEffect(() => {
    if (!open) return;
    setDone(false);
    topUp.reset();
    if (suggestedCents) setAmount(AMOUNTS.find((a) => a >= suggestedCents) ?? Math.ceil(suggestedCents / 500) * 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = () =>
    topUp.mutate(
      { amountCents: amount, method },
      {
        onSuccess: () => {
          setDone(true);
          setTimeout(onClose, 1100);
        },
      },
    );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Recharger mon solde"
      footer={
        !done && (
          <Button block loading={topUp.isPending} onClick={submit}>
            Recharger {formatCHF(amount)}
          </Button>
        )
      }
    >
      <AnimatePresence mode="wait">
        {done ? (
          <motion.div key="done" className="topup-done" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
            <motion.span
              className="topup-done__check"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 20, delay: 0.05 }}
            >
              <Check size={34} strokeWidth={3} />
            </motion.span>
            <strong>{formatCHF(amount, { sign: true })}</strong>
            <span>ajoutés à ton solde Rush</span>
          </motion.div>
        ) : (
          <motion.div key="form" exit={{ opacity: 0 }}>
            <div className="topup-amount">{formatCHF(amount)}</div>
            <div className="chip-wrap chip-wrap--center">
              {AMOUNTS.map((a) => (
                <Chip key={a} active={amount === a} onClick={() => setAmount(a)}>
                  {formatCHF(a, { bare: true }).replace('.00', '')}
                </Chip>
              ))}
            </div>
            <Group header="Moyen de paiement">
              {METHODS.map((m) => (
                <Row
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  leading={
                    <IconTile color={m.color}>
                      <m.icon size={16} color="#fff" />
                    </IconTile>
                  }
                  title={m.label}
                  subtitle={m.sub}
                  trailing={method === m.id ? <Check size={18} color="var(--blue)" strokeWidth={2.8} /> : null}
                />
              ))}
            </Group>
            {topUp.error && <p className="form-error">{(topUp.error as Error).message}</p>}
            <p className="sheet-note">
              Version pilote : la recharge crédite le solde local de l’app sans transaction bancaire réelle.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  );
}
