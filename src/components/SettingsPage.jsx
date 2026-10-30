import { Info } from 'lucide-react';
import { Mark, Wordmark } from './Brand';
import { Chapter } from './Chapter';
import { AppearanceSection } from './settings/AppearanceSection';
import { MemorySection } from './settings/MemorySection';
import { FollowSection } from './settings/FollowSection';
import { DataSection } from './settings/DataSection';
import { BackupSettings } from './settings/BackupSettings';
import { RemoteSettings } from './settings/RemoteSettings';
import { UpdatesSection } from './settings/UpdatesSection';

export function SettingsPage({ data, setting, call, notify, fontScale, stepFontScale, onAbout }) {
  return (
    <div className="content-page settings-page">
      <div className="page-heading">
        <div>
          <Chapter n={7} title="PREFERÊNCIAS" />
          <div className="eyebrow">FAÇA DESTE ESPAÇO O SEU</div>
          <h1>Seu lar. Seu estilo.</h1>
          <p>Um lugar confortável para pensar, criar e continuar.</p>
        </div>
      </div>
      <AppearanceSection
        settings={data.settings}
        setting={setting}
        fontScale={fontScale}
        stepFontScale={stepFontScale}
      />
      <MemorySection settings={data.settings} setting={setting} />
      <FollowSection settings={data.settings} setting={setting} />
      <DataSection call={call} />
      <BackupSettings call={call} notify={notify} />
      <RemoteSettings call={call} notify={notify} />
      <UpdatesSection settings={data.settings} setting={setting} call={call} notify={notify} />
      <div className="about">
        <Mark size={29} />
        <strong>
          <Wordmark />
        </strong>
        <span>{data.appVersion || ''} beta</span>
        <p>O fogo no centro de tudo: agentes, projetos e memória.</p>
        <button className="secondary-button" data-action="about" onClick={onAbout}>
          <Info size={15} />
          Sobre a VeSTA
        </button>
      </div>
    </div>
  );
}
