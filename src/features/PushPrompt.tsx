import { Bell, BellRing } from 'lucide-react';
import { PUSH_FAILED, PUSH_HINT, usePush } from '../lib/push';
import { Button, IconTile, Row, Switch } from '../ui/primitives';

/** Réglage des notifications push (Profil). */
export function PushRow() {
  const { state, busy, failed, enable, disable } = usePush();
  if (!state) return null;
  const toggleable = state === 'on' || state === 'off';
  return (
    <Row
      leading={
        <IconTile>
          <Bell size={15} color="#fff" />
        </IconTile>
      }
      title="Notifications"
      subtitle={failed ? PUSH_FAILED : PUSH_HINT[state]}
      trailing={
        toggleable ? (
          <Switch checked={state === 'on'} label="Notifications" onChange={(v) => !busy && (v ? enable() : disable())} />
        ) : undefined
      }
    />
  );
}

/**
 * Invitation à activer les notifications, au bon moment (demande publiée,
 * écran Livrer). Rien si elles sont déjà actives ou impossibles.
 */
export function PushCallout({ text }: { text: string }) {
  const { state, busy, failed, enable } = usePush();
  if (state !== 'off' && state !== 'install') return null;
  return (
    <div className="push-callout">
      <span className="push-callout__icon">
        <BellRing size={18} />
      </span>
      <span className="push-callout__text">
        <strong>{text}</strong>
        <span>{failed ? PUSH_FAILED : state === 'install' ? PUSH_HINT.install : 'Même quand l’app est fermée.'}</span>
      </span>
      {state === 'off' && (
        <Button size="md" loading={busy} onClick={enable}>
          Activer
        </Button>
      )}
    </div>
  );
}
