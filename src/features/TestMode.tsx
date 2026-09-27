import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Bike, Bot, CreditCard, FlaskConical, LogOut, Plus, RotateCcw, ShoppingBag } from 'lucide-react';
import { formatCHF } from '../../shared/money';
import type { Me, TestInfo } from '../../shared/types';
import { useSampleOrder, useTestSwitch, useTestTool, type TestRole } from '../lib/queries';
import { toast } from '../state/ui';
import { Sheet } from '../ui/Sheet';
import { Button, Group, IconTile, Row, Segmented, Switch } from '../ui/primitives';

/*
 * Mode test (équipe Rush) : le vrai parcours avec de l'argent fictif. Un
 * bandeau rayé et une pastille « TEST » restent visibles tant qu'on y est ;
 * la pastille ouvre les outils.
 */

export const ROLE_LABEL: Record<TestRole, string> = { buyer: 'Demandeur', rusher: 'Rusher' };

export const STRIPE_TEST_CARD = 'Carte de test 4242 4242 4242 4242, date future, CVC au choix.';

/** Carte de l'écran /admin : ouvre un compte de test. */
export function TestModeCard() {
  const navigate = useNavigate();
  const enter = useTestSwitch();
  const go = (role: TestRole) =>
    enter.mutate(role, {
      onSuccess: (me) => {
        navigate(role === 'rusher' ? '/deliver' : '/');
        toast({
          title: `Mode test · ${ROLE_LABEL[role]}`,
          body: me?.test?.stripe ? STRIPE_TEST_CARD : 'Argent fictif : rien n’est vraiment payé.',
        });
      },
    });
  return (
    <section className="test-card">
      <header className="test-card__head">
        <span className="test-card__icon">
          <FlaskConical size={18} />
        </span>
        <span>
          <strong>Mode test</strong>
          <span>Le vrai parcours, avec de l’argent fictif</span>
        </span>
      </header>
      <p className="test-card__text">
        Recharge par l’environnement de test Stripe, demande, offres en direct, suivi, messages, livraison et retrait : tout se passe comme
        pour de vrai, sur des comptes de test que personne d’autre ne voit. Des rushers simulés peuvent livrer tes demandes.
      </p>
      <div className="test-card__actions">
        <Button
          size="md"
          icon={<ShoppingBag size={16} />}
          loading={enter.isPending && enter.variables === 'buyer'}
          onClick={() => go('buyer')}
        >
          Tester comme demandeur
        </Button>
        <Button
          size="md"
          variant="secondary"
          icon={<Bike size={16} />}
          loading={enter.isPending && enter.variables === 'rusher'}
          onClick={() => go('rusher')}
        >
          Tester comme rusher
        </Button>
      </div>
      {enter.error && <p className="form-error">{(enter.error as Error).message}</p>}
    </section>
  );
}

/** Pastille « TEST » dans les contrôles de la carte. */
export function TestBadge({ me }: { me: Me & { test: TestInfo } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="test-pill" onClick={() => setOpen(true)} aria-label="Outils du mode test">
        <FlaskConical size={14} strokeWidth={2.4} />
        <span>TEST</span>
        <span className="test-pill__role">{ROLE_LABEL[me.test.role]}</span>
      </button>
      <TestPanel me={me} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function TestPanel({ me, open, onClose }: { me: Me & { test: TestInfo }; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const switcher = useTestSwitch();
  const tool = useTestTool();
  const sample = useSampleOrder();
  const [confirmReset, setConfirmReset] = useState(false);
  const { test } = me;
  const error = [switcher.error, tool.error, sample.error].find(Boolean) as Error | undefined;

  const switchTo = (role: TestRole) => {
    if (role === test.role) return;
    switcher.mutate(role, { onSuccess: () => navigate(role === 'rusher' ? '/deliver' : '/') });
  };

  return (
    <Sheet open={open} onClose={onClose} title="Mode test">
      <p className="sheet-text">
        Argent fictif, parcours réel : notifications, offres, suivi et messages fonctionnent comme en vrai. Seuls les comptes de test voient
        les commandes de test.
      </p>

      <div className="test-panel__role">
        <Segmented
          id="test-role"
          value={test.role}
          onChange={switchTo}
          options={[
            { value: 'buyer', label: 'Demandeur' },
            { value: 'rusher', label: 'Rusher' },
          ]}
        />
      </div>

      <Group header="Solde fictif">
        <Row
          leading={
            <IconTile>
              <Plus size={15} color="#fff" />
            </IconTile>
          }
          title="Ajouter CHF 20 fictifs"
          subtitle={`Solde : ${formatCHF(me.balanceCents)}`}
          trailing={
            <Button
              size="sm"
              variant="tinted"
              loading={tool.isPending && tool.variables?.kind === 'credit'}
              onClick={() => tool.mutate({ kind: 'credit' })}
            >
              + 20
            </Button>
          }
        />
        <Row
          leading={
            <IconTile>
              <CreditCard size={15} color="#fff" />
            </IconTile>
          }
          title="Recharger par Stripe (test)"
          subtitle={test.stripe ? 'Carte 4242 4242 4242 4242' : 'Pas encore branché'}
          chevron={test.stripe}
          onClick={
            test.stripe
              ? () => {
                  onClose();
                  navigate('/wallet');
                }
              : undefined
          }
        />
      </Group>

      <Group header="Rushers simulés">
        <Row
          leading={
            <IconTile>
              <Bot size={15} color="#fff" />
            </IconTile>
          }
          title="Rusher automatique"
          subtitle={
            test.autoRusher
              ? 'Livre tes demandes tout seul'
              : 'Coupé : livre-les en Rusher'
          }
          trailing={
            <Switch checked={test.autoRusher} label="Rusher automatique" onChange={(on) => tool.mutate({ kind: 'auto-rusher', on })} />
          }
        />
        <Row
          leading={
            <IconTile>
              <ShoppingBag size={15} color="#fff" />
            </IconTile>
          }
          title="Demande à livrer"
          subtitle="Un bot commande, tu livres"
          trailing={
            <Button
              size="sm"
              variant="tinted"
              loading={sample.isPending}
              onClick={() =>
                sample.mutate(undefined, {
                  onSuccess: () => {
                    onClose();
                    if (test.role === 'rusher') navigate('/deliver');
                    else switcher.mutate('rusher', { onSuccess: () => navigate('/deliver') });
                  },
                })
              }
            >
              Publier
            </Button>
          }
        />
      </Group>

      <Group>
        <Row
          leading={
            <IconTile>
              <RotateCcw size={15} color="#fff" />
            </IconTile>
          }
          title={confirmReset ? 'Sûr ? Touche encore pour effacer' : 'Tout remettre à zéro'}
          subtitle="Commandes, soldes et retraits de test"
          destructive
          onClick={() => {
            if (!confirmReset) return setConfirmReset(true);
            setConfirmReset(false);
            tool.mutate({ kind: 'reset' }, { onSuccess: () => toast({ title: 'Mode test remis à zéro' }) });
          }}
        />
        <Row
          leading={
            <IconTile>
              <LogOut size={15} color="#fff" />
            </IconTile>
          }
          title="Quitter le mode test"
          subtitle={test.ownerFirstName ? `Retour au compte de ${test.ownerFirstName}` : 'Retour à ton vrai compte'}
          onClick={() =>
            switcher.mutate('real', {
              onSuccess: (real) => {
                onClose();
                navigate(real ? '/admin' : '/');
              },
            })
          }
        />
      </Group>

      {error && <p className="form-error pad-x">{error.message}</p>}
    </Sheet>
  );
}
