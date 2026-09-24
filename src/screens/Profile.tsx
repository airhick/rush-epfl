import { useState } from 'react';
import { BookOpen, LogOut, Moon, Pencil, ShieldCheck } from 'lucide-react';
import { useLogout, useMe, useUpdateProfile } from '../lib/queries';
import { useMapScene } from '../state/scene';
import { usePrefs, type ThemePref } from '../state/ui';
import { Screen } from '../ui/Screen';
import { Sheet } from '../ui/Sheet';
import { Avatar, Button, Group, IconTile, Rating, Row, Segmented } from '../ui/primitives';

export function Profile() {
  const { data: me } = useMe();
  const logout = useLogout();
  const { theme, setTheme } = usePrefs();
  const [edit, setEdit] = useState(false);
  const [how, setHow] = useState(false);

  useMapScene(() => ({ cameraKey: 'overview', camera: { kind: 'overview' } }), []);
  if (!me) return null;

  return (
    <Screen back="/" navTitle="Profil">
      <div className="profile-head">
        <Avatar user={me} size={88} />
        <h1 className="title1">
          {me.firstName} {me.lastName}
        </h1>
        <p className="muted">
          {me.email}
          {me.section && ` · ${me.section}`}
        </p>
      </div>

      <div className="stat-tiles pad-x">
        <div className="stat-tile">
          <span>Livraisons</span>
          <strong>{me.deliveries}</strong>
        </div>
        <div className="stat-tile">
          <span>Note</span>
          <strong>
            <Rating user={me} />
          </strong>
        </div>
      </div>

      <Group>
        <Row
          onClick={() => setEdit(true)}
          leading={
            <IconTile color="var(--blue)">
              <Pencil size={15} color="#fff" />
            </IconTile>
          }
          title="Modifier le profil"
          chevron
        />
        <Row
          leading={
            <IconTile color="var(--indigo)">
              <Moon size={15} color="#fff" />
            </IconTile>
          }
          title="Apparence"
          trailing={
            <Segmented<ThemePref>
              id="theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'system', label: 'Auto' },
                { value: 'light', label: 'Clair' },
                { value: 'dark', label: 'Sombre' },
              ]}
            />
          }
        />
      </Group>

      <Group>
        <Row
          onClick={() => setHow(true)}
          leading={
            <IconTile color="var(--green)">
              <BookOpen size={15} color="#fff" />
            </IconTile>
          }
          title="Comment fonctionne Rush"
          chevron
        />
        <Row
          leading={
            <IconTile color="var(--label-2)">
              <ShieldCheck size={15} color="#fff" />
            </IconTile>
          }
          title="Communauté vérifiée"
          subtitle="Seules les adresses @epfl.ch peuvent se connecter."
        />
      </Group>

      <Group>
        <Row
          onClick={() => logout.mutate()}
          destructive
          leading={
            <IconTile color="var(--red)">
              <LogOut size={15} color="#fff" />
            </IconTile>
          }
          title="Se déconnecter"
        />
      </Group>

      <EditProfile open={edit} onClose={() => setEdit(false)} />
      <HowItWorks open={how} onClose={() => setHow(false)} />
    </Screen>
  );
}

function EditProfile({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: me } = useMe();
  const save = useUpdateProfile();
  const [first, setFirst] = useState(me?.firstName ?? '');
  const [last, setLast] = useState(me?.lastName ?? '');
  const [section, setSection] = useState(me?.section ?? '');

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Profil"
      footer={
        <Button
          block
          loading={save.isPending}
          disabled={!first.trim()}
          onClick={() => save.mutate({ firstName: first, lastName: last, section: section.trim() || null }, { onSuccess: onClose })}
        >
          Enregistrer
        </Button>
      }
    >
      <div className="form-stack">
        <label className="field">
          <span className="field__label">Prénom</span>
          <span className="field__control">
            <input value={first} onChange={(e) => setFirst(e.target.value)} />
          </span>
        </label>
        <label className="field">
          <span className="field__label">Nom</span>
          <span className="field__control">
            <input value={last} onChange={(e) => setLast(e.target.value)} />
          </span>
        </label>
        <label className="field">
          <span className="field__label">Section</span>
          <span className="field__control">
            <input value={section} onChange={(e) => setSection(e.target.value)} placeholder="IN, SV, Personnel…" />
          </span>
        </label>
      </div>
    </Sheet>
  );
}

const STEPS = [
  ['Tu publies une demande', 'Choisis un spot, tes articles et où tu es. Le montant (articles + 10 % de marge + pourboire) est réservé sur ton solde.'],
  ['Un rusher sur place accepte', 'Quelqu’un qui est déjà au spot, ou qui passe par là, prend ta demande. Vous pouvez vous écrire.'],
  ['Il avance l’achat', 'Il paie au comptoir et déclare le montant exact du ticket.'],
  ['Tu confirmes la réception', 'Il est remboursé avec son pourboire, et ce qui n’a pas été dépensé revient sur ton solde.'],
];

function HowItWorks({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Comment fonctionne Rush">
      <ol className="how">
        {STEPS.map(([title, body], i) => (
          <li key={title}>
            <span className="how__n">{i + 1}</span>
            <span>
              <strong>{title}</strong>
              <span>{body}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="sheet-note">
        Le pourboire suggéré tient compte de la distance à pied, du nombre d’articles et de l’heure de pointe. Sans confirmation, une
        livraison est validée automatiquement après 15 minutes ; une demande sans rusher expire après 40 minutes et le montant est rendu.
      </p>
    </Sheet>
  );
}
