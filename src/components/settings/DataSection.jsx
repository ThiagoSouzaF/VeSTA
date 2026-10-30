import { Folder, HardDrive } from 'lucide-react';
import { action } from '../../lib/api';
import { SettingsSection } from './SettingsSection';

export function DataSection({ call }) {
  return (
    <SettingsSection
      id="data"
      icon={HardDrive}
      title="Seus dados, no seu computador"
      description="Conversas, preferências e memórias ficam na pasta do VeSTA."
    >
      <button className="secondary-button" onClick={action(() => call('openData'))}>
        <Folder size={15} />
        Abrir pasta de dados
      </button>
      <p className="fine-print">
        As mensagens e o contexto recuperado são enviados à IA escolhida usando sua conta. A consulta do AI Memory
        acontece localmente.
      </p>
    </SettingsSection>
  );
}
