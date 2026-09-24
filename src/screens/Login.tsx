import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Bike, Gift, MessageCircle, Wallet } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { keys, useUpdateProfile } from '../lib/queries';
import { useMapScene } from '../state/scene';
import { Button, Chip, cx } from '../ui/primitives';
import { Logo } from '../ui/Logo';
import type { Me } from '../../shared/types';
import { formatCHF } from '../../shared/money';

const DOMAIN = '@epfl.ch';

const toEmail = (raw: string) => {
  const v = raw.trim().toLowerCase();
  return v.includes('@') ? v : `${v}${DOMAIN}`;
};

export function Login() {
  const qc = useQueryClient();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [local, setLocal] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  useMapScene(() => ({ cameraKey: 'login', camera: { kind: 'overview' } }), []);

  const request = useMutation({
    mutationFn: () => api<{ devCode?: string }>('/auth/request', { body: { email: toEmail(local) } }),
    onSuccess: (res) => {
      setDevCode(res.devCode ?? null);
      setStep('code');
      setCode('');
    },
  });

  const verify = useMutation({
    mutationFn: (c: string) => api<Me>('/auth/verify', { body: { email: toEmail(local), code: c } }),
    onSuccess: (me) => qc.setQueryData(keys.me, me),
    onError: () => setCode(''),
  });

  useEffect(() => {
    if (step === 'code') codeInput.current?.focus();
  }, [step]);

  useEffect(() => {
    if (code.length === 6 && !verify.isPending) verify.mutate(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    if (local.trim()) request.mutate();
  };

  const error = (step === 'email' ? request.error : verify.error) as ApiError | null;

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
                <span className="field__control">
                  <input
                    autoFocus
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
              <Button block loading={request.isPending} disabled={!local.trim()} icon={<ArrowRight size={18} />}>
                Recevoir un code
              </Button>
              <p className="auth__fine">Rush est réservé aux étudiant·e·s et au personnel de l’EPFL.</p>
            </form>
          </motion.div>
        ) : (
          <motion.div
            key="code"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.22 }}
          >
            <h1 className="auth__title">Vérifie ta boîte mail</h1>
            <p className="auth__lead">
              Code envoyé à <strong>{toEmail(local)}</strong>.{' '}
              <button className="link" onClick={() => setStep('email')}>
                Modifier
              </button>
            </p>

            <label className={cx('otp', verify.isError && 'is-error')} onClick={() => codeInput.current?.focus()}>
              <input
                ref={codeInput}
                className="otp__input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                aria-label="Code à 6 chiffres"
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className={cx('otp__cell', i === code.length && 'is-caret', code[i] && 'is-filled')}>
                  {code[i] ?? ''}
                </span>
              ))}
            </label>

            {error && <p className="form-error">{error.message}</p>}
            {verify.isPending && <p className="auth__lead">Vérification…</p>}

            {devCode && (
              <button className="dev-code" onClick={() => setCode(devCode)}>
                <span>Mode développement</span>
                <strong>{devCode}</strong>
                <span className="dev-code__hint">Toucher pour remplir</span>
              </button>
            )}

            <button className="link auth__resend" disabled={request.isPending} onClick={() => request.mutate()}>
              Renvoyer un code
            </button>
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
