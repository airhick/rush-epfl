import { useEffect, useRef, useState, type FormEvent, type PointerEvent, type RefObject } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Bike, ChevronLeft, Eye, EyeOff, Gift, MessageCircle, Wallet } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { keys, useAuthOptions, useUpdateProfile } from '../lib/queries';
import { useMapScene } from '../state/scene';
import { useMedia } from '../lib/useMedia';
import { Button, Chip, Skeleton } from '../ui/primitives';
import { Logo } from '../ui/Logo';
import type { Me } from '../../shared/types';
import { formatCHF } from '../../shared/money';

const DOMAIN = '@epfl.ch';
/** Même règle que le serveur (server/services/auth.ts). */
const PASSWORD_MIN = 8;

/**
 * Sur iOS, un champ focalisé par script n'ouvre pas le clavier, et le
 * toucher ensuite ne l'ouvre pas non plus. On refocalise donc le champ
 * pendant le geste de l'utilisateur.
 */
const focusOnTap = (ref: RefObject<HTMLInputElement | null>) => (e: PointerEvent) => {
  const input = ref.current;
  if (!input || e.pointerType === 'mouse') return;
  if (document.activeElement === input) input.blur();
  input.focus();
};

/** Retour de la connexion EPFL qui n'a pas abouti (/?epfl=…). */
const EPFL_ERRORS: Record<string, string> = {
  cancelled: 'Connexion EPFL annulée.',
  consent: 'L’EPFL n’a pas encore autorisé Rush à utiliser ta connexion. Réessaie plus tard.',
  expired: 'La connexion a pris trop de temps. Réessaie.',
  account: 'Connecte-toi avec ton compte EPFL (prenom.nom@epfl.ch).',
  unavailable: 'La connexion EPFL n’est pas disponible pour le moment.',
  failed: 'La connexion EPFL n’a pas abouti. Réessaie dans un instant.',
};

/** Aller-retour chez Microsoft (annuaire EPFL), puis retour sur la page ouverte. */
const epflLoginUrl = (loginHint?: string) => {
  const params = new URLSearchParams({ next: window.location.pathname });
  if (loginHint) params.set('login_hint', loginHint);
  return `/api/auth/epfl?${params}`;
};

const toEmail = (raw: string) => {
  const v = raw.trim().toLowerCase();
  return v.includes('@') ? v : `${v}${DOMAIN}`;
};

type View = 'start' | 'login' | 'register';

export function Login() {
  const qc = useQueryClient();
  const { data: options, isError: noOptions } = useAuthOptions();
  const [params, setParams] = useSearchParams();
  const [epflError] = useState(() => {
    const code = params.get('epfl') ?? '';
    return Object.hasOwn(EPFL_ERRORS, code) ? EPFL_ERRORS[code] : null;
  });
  const [leaving, setLeaving] = useState(false);
  const [view, setView] = useState<View>('start');
  const [local, setLocal] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  // Focus automatique seulement avec une souris : sur mobile il bloque le clavier.
  const finePointer = useMedia('(pointer: fine)');
  const email = toEmail(local);
  const epflOn = options?.epfl === true;
  const registering = view === 'register';

  useMapScene(() => ({ cameraKey: 'login', camera: { kind: 'overview' } }), []);

  useEffect(() => {
    if (params.has('epfl')) setParams({}, { replace: true });
    // Retour arrière depuis Microsoft : la page revient du cache avec le bouton en chargement.
    const reset = (e: PageTransitionEvent) => e.persisted && setLeaving(false);
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const goEpfl = (loginHint?: string) => {
    setLeaving(true);
    window.location.assign(epflLoginUrl(loginHint));
  };

  const signIn = useMutation({
    mutationFn: () => api<Me>(registering ? '/auth/register' : '/auth/login', { body: { email, password } }),
    onSuccess: (me) => qc.setQueryData(keys.me, me),
    // Adresse EPFL qui passe par la connexion EPFL : on y va directement.
    onError: (err) => err instanceof ApiError && err.status === 403 && epflOn && goEpfl(email),
  });

  const open = (next: View) => {
    signIn.reset();
    setView(next);
  };

  useEffect(() => {
    if (view === 'start' || !finePointer) return;
    (local.trim() ? passwordInput : emailInput).current?.focus();
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const tooShort = registering && password.length < PASSWORD_MIN;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (local.trim() && password && !tooShort) signIn.mutate();
  };

  const error = signIn.error as ApiError | null;

  return (
    <div className="auth">
      <div className="auth__brand">
        <Logo size={30} />
        <span className="auth__tag">EPFL</span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {view === 'start' ? (
          <motion.div
            key="start"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.22 }}
          >
            <h1 className="auth__title">La graille du campus, ramenée par ceux qui y sont déjà.</h1>
            <ul className="auth__points">
              <li>
                <span className="auth__icon">
                  <Bike size={18} />
                </span>
                <span>
                  <strong>Quelqu’un passe au Parmentier ?</strong> Il prend ton burger sur son chemin.
                </span>
              </li>
              <li>
                <span className="auth__icon">
                  <Wallet size={18} />
                </span>
                <span>
                  <strong>Solde Rush intégré.</strong> Le montant est réservé, le reste t’est rendu.
                </span>
              </li>
              <li>
                <span className="auth__icon">
                  <MessageCircle size={18} />
                </span>
                <span>
                  <strong>Messagerie et suivi en direct</strong> sur la carte du campus.
                </span>
              </li>
            </ul>

            {!options && !noOptions ? (
              <Skeleton h={116} r={16} />
            ) : epflOn ? (
              <div className="auth__form">
                {epflError && <p className="form-error">{epflError}</p>}
                <Button block loading={leaving} icon={<ArrowRight size={18} />} onClick={() => goEpfl()}>
                  Continuer avec EPFL
                </Button>
                <p className="auth__fine">Avec ton compte EPFL habituel, celui de ta messagerie. Rush ne voit jamais ton mot de passe.</p>
                <button type="button" className="link auth__alt" onClick={() => open('login')}>
                  Se connecter avec un mot de passe
                </button>
              </div>
            ) : (
              <div className="auth__form">
                {epflError && <p className="form-error">{epflError}</p>}
                <Button block onClick={() => open('register')}>
                  Créer un compte
                </Button>
                <Button block variant="secondary" onClick={() => open('login')}>
                  Se connecter
                </Button>
                <p className="auth__fine">
                  Rush est réservé aux étudiant·e·s et au personnel de l’EPFL. Un cookie garde ta connexion sur cet appareil.
                </p>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.22 }}
          >
            <button type="button" className="link auth__back" onClick={() => open('start')}>
              <ChevronLeft size={18} strokeWidth={2.4} /> Retour
            </button>
            <h1 className="auth__title">{registering ? 'Crée ton compte' : 'Content de te revoir'}</h1>
            <p className="auth__lead">
              {registering
                ? 'Ton adresse EPFL et un mot de passe. Ton prénom et ta section juste après.'
                : 'Connecte-toi avec ton adresse EPFL et ton mot de passe.'}
            </p>

            <form onSubmit={submit} className="auth__form">
              <label className="field field--suffix">
                <span className="field__label">Adresse EPFL</span>
                <span className="field__control" onPointerDown={focusOnTap(emailInput)}>
                  <input
                    ref={emailInput}
                    type="text"
                    inputMode="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="prenom.nom"
                    value={local}
                    onChange={(e) => setLocal(e.target.value)}
                  />
                  {!local.includes('@') && <span className="field__suffix">{DOMAIN}</span>}
                </span>
              </label>
              <label className="field">
                <span className="field__label">Mot de passe</span>
                <span className="field__control" onPointerDown={focusOnTap(passwordInput)}>
                  <input
                    ref={passwordInput}
                    type={reveal ? 'text' : 'password'}
                    autoComplete={registering ? 'new-password' : 'current-password'}
                    autoCapitalize="none"
                    spellCheck={false}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="field__reveal"
                    onClick={() => setReveal(!reveal)}
                    aria-label={reveal ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  >
                    {reveal ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </span>
              </label>
              {registering && (
                <p className="auth__hint">{PASSWORD_MIN} caractères minimum. Garde-le bien : il n’y a pas encore de réinitialisation.</p>
              )}
              {error && <p className="form-error">{error.message}</p>}
              <Button block loading={signIn.isPending || leaving} disabled={!local.trim() || !password || tooShort} icon={<ArrowRight size={18} />}>
                {registering ? 'Créer mon compte' : 'Se connecter'}
              </Button>
              <p className="auth__switch">
                {registering ? 'Déjà un compte ?' : 'Pas encore de compte ?'}{' '}
                <button type="button" className="link" onClick={() => open(registering ? 'login' : 'register')}>
                  {registering ? 'Se connecter' : 'Créer un compte'}
                </button>
              </p>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const SECTIONS = ['AR', 'GC', 'SIE', 'IN', 'SC', 'MA', 'PH', 'CGC', 'SV', 'EL', 'ME', 'MX', 'MT', 'MTE', 'DH', 'Doctorat', 'Personnel'];

export function Onboarding({ me }: { me: Me }) {
  const [firstName, setFirst] = useState(me.firstName);
  const [lastName, setLast] = useState(me.lastName);
  const [section, setSection] = useState<string | null>(me.section);
  const save = useUpdateProfile();

  return (
    <div className="auth">
      <div className="auth__brand">
        <Logo size={30} />
      </div>
      <h1 className="auth__title">Bienvenue sur Rush, {firstName || 'toi'}.</h1>
      <p className="auth__lead">Ton prénom et l’initiale de ton nom sont visibles par les personnes avec qui tu échanges.</p>
      {me.balanceCents > 0 && (
        <div className="welcome-gift">
          <Gift size={18} />
          <span>
            <strong>{formatCHF(me.balanceCents)} offert</strong> sur ton solde Rush pour bien démarrer.
          </span>
        </div>
      )}

      <form
        className="auth__form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ firstName, lastName, section });
        }}
      >
        <div className="field-row">
          <label className="field">
            <span className="field__label">Prénom</span>
            <span className="field__control">
              <input value={firstName} onChange={(e) => setFirst(e.target.value)} autoComplete="given-name" />
            </span>
          </label>
          <label className="field">
            <span className="field__label">Nom</span>
            <span className="field__control">
              <input value={lastName} onChange={(e) => setLast(e.target.value)} autoComplete="family-name" />
            </span>
          </label>
        </div>

        <div className="field">
          <span className="field__label">Section</span>
          <div className="chip-wrap">
            {SECTIONS.map((s) => (
              <Chip key={s} active={section === s} onClick={() => setSection(section === s ? null : s)}>
                {s}
              </Chip>
            ))}
          </div>
        </div>

        {save.error && <p className="form-error">{(save.error as Error).message}</p>}
        <Button block loading={save.isPending} disabled={!firstName.trim()}>
          C’est parti
        </Button>
      </form>
    </div>
  );
}
