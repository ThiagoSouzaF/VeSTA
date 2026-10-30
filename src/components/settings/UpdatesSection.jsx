import { RefreshCw } from 'lucide-react';
import { action } from '../../lib/api';
import { SettingsSection } from './SettingsSection';
import { SettingToggle } from './SettingToggle';

export function UpdatesSection({ settings, setting, call, notify }) {
  return (
    <SettingsSection
      id="updates"
      icon={RefreshCw}
      title="Atualizações"
      description="O VeSTA pergunta antes de instalar qualquer versão nova. Fora isso, ele não envia nada a ninguém: sem telemetria."
    >
      <SettingToggle
        title="Procurar atualizações ao abrir"
        description="Uma consulta às Releases do VeSTA no GitHub, alguns segundos depois de abrir. Desligado, só quando você clicar abaixo."
        checked={settings.autoUpdate !== false}
        onChange={() => setting({ autoUpdate: settings.autoUpdate === false })}
      />
      <button
        className="secondary-button"
        onClick={action(async () => {
          const r = await call('checkUpdates');
          if (r?.message && r.status !== 'declined') notify(r.message);
        })}
      >
        <RefreshCw size={15} />
        Procurar atualizações
      </button>
    </SettingsSection>
  );
}
