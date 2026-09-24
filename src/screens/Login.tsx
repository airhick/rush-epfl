import { useEffect, useRef, useState, type FormEvent, type PointerEvent, type RefObject } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Bike, Eye, EyeOff, Gift, MessageCircle, Wallet } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { keys, useUpdateProfile } from '../lib/queries';
import { useMapScene } from '../state/scene';
import { useMedia } from '../lib/useMedia';
import { Button, Chip } from '../ui/primitives';
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

const toEmail = (raw: string) => {
  const v = raw.trim().toLowerCase();
  return v.includes('@') ? v : `${v}${DOMAIN}`;
};

export function Login() {
  const qc = useQueryClient();
  const [step, setStep] = useState<'email' | 'password'>('email');
  const [local, setLocal] = useState('');
  const [exists, setExists] = useState(false);
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  // Focus automatique seulement avec une souris : sur mobile il bloque le clavier.
  const finePointer = useMedia('(pointer: fine)');
  const email = toEmail(local);

  useMapScene(() => ({ cameraKey: 'login', camera: { kind: 'overview' } }), []);

  const check = useMutation({
    mutationFn: () => api<{ exists: boolean }>('/auth/check', { body: { email } }),
    onSuccess: (res) => {
      setExists(res.exists);
      setPassword('');
      setStep('password');
    },
  });

  const signIn = useMutation({
    mutationFn: () => api<Me>(exists ? '/auth/login' : '/auth/register', { body: { email, password } }),
    onSuccess: (me) => qc.setQueryData(keys.me, me),
  });

  useEffect(() => {
    if (step === 'password' && finePointer) passwordInput.current?.focus();
  }, [step]);

  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    if (local.trim()) check.mutate();
  };

  const tooShort = !exists && password.length < PASSWORD_MIN;
  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    if (password && !tooShort) signIn.mutate();
  };

  const error = (step === 'email' ? check.error : signIn.error) as ApiError | null;

  return (
    <div className="auth">
      <div className="auth__brand">
        <Logo size={30} />
        <span className="auth__tag">EPFL</span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {step === 'email' ? (
          <motion.div
            key="email"
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

            <form onSubmit={submitEmail} className="auth__form">
              <label className="field field--suffix">
                <span className="field__label">Adresse EPFL</span>
                <span className="field__control" onPointerDown={focusOnTap(emailInput)}>
                  <input
                    ref={emailInput}
                    autoFocus={finePointer}
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
              {error && <p className="form-error">{error.message}</p>}
              <Button block loading={check.isPending} disabled={!local.trim()} icon={<ArrowRight size={18} />}>
                Continuer
              </Button>
              <p className="auth__fine">Rush est réservé aux étudiant·e·s et au personnel de l’EPFL.</p>
            </form>
          </motion.div>
        ) : (
          <motion.div
            key="password"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.22 }}
          >
            <h1 className="auth__title">{exists ? 'Content de te revoir' : 'Crée ton mot de passe'}</h1>
            <p className="auth__lead">
              {exists ? 'Connexion avec' : 'Nouveau compte pour'} <strong>{email}</strong>.{' '}
              <button className="link" onClick={() => setStep('email')}>
                Modifier
              </button>
            </p>

            <form onSubmit={submitPassword} className="auth__form">
              {/* Pour que le gestionnaire de mots de passe associe le mot de passe à l'adresse. */}
              <input type="email" autoComplete="username" value={email} readOnly hidden />
              <label className="field">
                <span className="field__label">Mot de passe</span>
                <span className="field__control" onPointerDown={focusOnTap(passwordInput)}>
                  <input
                    ref={passwordInput}
                    type={reveal ? 'text' : 'password'}
                    autoComplete={exists ? 'current-password' : 'new-password'}
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
              {!exists && (
                <p className="auth__hint">
                  {PASSWORD_MIN} caractères minimum. Garde-le bien : il n’y a pas encore de réinitialisation.
                </p>
              )}
              {error && <p className="form-error">{error.message}</p>}
              <Button block loading={signIn.isPending} disabled={!password || tooShort} icon={<ArrowRight size={18} />}>
                {exists ? 'Se connecter' : 'Créer mon compte'}
              </Button>
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
