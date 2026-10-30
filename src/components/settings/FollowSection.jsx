import { Eye } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { SettingRow } from './SettingRow';

const MINUTES = [15, 30, 60, 120, 240, 480, 720];
const MAX_CHATS = [1, 2, 3, 5, 8, 10];

export function FollowSection({ settings, setting }) {
  return (
    <SettingsSection
      id="follow"
      icon={Eye}
      title="Processos em segundo plano"
      description="Quando o Claude deixa um comando rodando, o VeSTA continua de olho e mostra o retorno dele."
    >
      <SettingRow
        title="Acompanhar por até"
        description="Depois desse tempo o VeSTA para de acompanhar e avisa no chat. Servidores de desenvolvimento, que nunca terminam, caem nesse limite. Os processos continuam rodando."
      >
        <select
          aria-label="Tempo máximo de acompanhamento"
          value={settings.followMinutes ?? 120}
          onChange={(e) => setting({ followMinutes: Number(e.target.value) })}
        >
          {MINUTES.map((m) => (
            <option value={m} key={m}>
              {m >= 60 ? m / 60 + ' h' : m + ' min'}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        title="Conversas acompanhadas ao mesmo tempo"
        description="Cada uma mantém um processo do Claude aberto. Acima do limite, o turno termina como antes."
      >
        <select
          aria-label="Máximo de conversas acompanhadas"
          value={settings.followMax ?? 3}
          onChange={(e) => setting({ followMax: Number(e.target.value) })}
        >
          {MAX_CHATS.map((n) => (
            <option value={n} key={n}>
              {n}
            </option>
          ))}
        </select>
      </SettingRow>
    </SettingsSection>
  );
}
