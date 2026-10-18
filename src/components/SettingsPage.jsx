import { Brain, Folder, Check, RefreshCw, Palette, HardDrive, Minus, Plus, Info } from 'lucide-react';
import { THEME_NAMES } from '../lib/constants';
import { BACKDROPS } from './Backdrop';
import { SettingToggle } from './SettingToggle';
import { RemoteSettings } from './RemoteSettings';
import { action } from '../lib/api';
import { Mark, Wordmark } from './Brand';
import { SCALE_MIN, SCALE_MAX, scalePercent } from '../lib/zoom';
export function SettingsPage({ data, setting, call, notify, fontScale, stepFontScale, onAbout }) {
  return (
    <div className="content-page settings-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">FAÇA DESTE ESPAÇO O SEU</div>
          <h1>Seu lar. Seu estilo.</h1>
          <p>Um lugar confortável para pensar, criar e continuar.</p>
        </div>
      </div>
      <section className="settings-section">
        <div className="settings-label">
          <Palette size={19} />
          <div>
            <h3>Aparência</h3>
            <p>Escolha a atmosfera do seu espaço.</p>
          </div>
        </div>
        <div className="theme-grid">
          {['obsidian', 'aurora', 'paper'].map((t) => (
            <button
              className={'theme-card ' + (data.settings.theme === t ? 'chosen' : '')}
              key={t}
              onClick={() => setting({ theme: t })}
            >
              <div className={'theme-preview ' + t}>
                <div className="preview-sidebar">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="preview-main">
                  <i />
                  <i />
                  <div />
                  <div />
                </div>
              </div>
              <div className="theme-card-name">
                <span>{THEME_NAMES[t]}</span>
                {data.settings.theme === t ? (
                  <span className="theme-check">
                    <Check size={12} />
                  </span>
                ) : (
                  <span className="theme-radio" />
                )}
              </div>
            </button>
          ))}
        </div>
        <div className="backdrop-setting">
          <div>
            <strong>Fundo</strong>
            <span>Um movimento discreto atrás das conversas, nas cores do tema.</span>
          </div>
          <div className="backdrop-options">
            {BACKDROPS.map((b) => (
              <button
                className={'backdrop-option ' + b.id + ((data.settings.background || 'rain') === b.id ? ' chosen' : '')}
                onClick={() => setting({ background: b.id })}
                key={b.id}
              >
                <span className="backdrop-thumb" aria-hidden="true" />
                <strong>{b.name}</strong>
                <span>{b.description}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="zoom-setting">
          <div>
            <strong>Tamanho do texto</strong>
            <span>Conversa, mensagem e atividades. Atalhos: Ctrl + / Ctrl - / Ctrl 0 ou Ctrl + roda do mouse.</span>
          </div>
          <div className="zoom-controls" role="group" aria-label="Tamanho do texto">
            <button
              className="zoom-step"
              aria-label="Diminuir texto"
              disabled={fontScale <= SCALE_MIN}
              onClick={() => stepFontScale(-1)}
            >
              <Minus size={14} />
            </button>
            <output className="zoom-value" aria-live="polite">
              {scalePercent(fontScale)}
            </output>
            <button
              className="zoom-step"
              aria-label="Aumentar texto"
              disabled={fontScale >= SCALE_MAX}
              onClick={() => stepFontScale(1)}
            >
              <Plus size={14} />
            </button>
            <button className="zoom-reset" disabled={fontScale === 1} onClick={() => stepFontScale(0)}>
              Restaurar
            </button>
          </div>
        </div>
        <div className="accent-setting">
          <div>
            <strong>Cor de destaque</strong>
            <span>Um toque da sua personalidade.</span>
          </div>
          <div className="accent-options">
            {[
              ['ember', 'Brasa'],
              ['violet', 'Violeta'],
              ['mint', 'Menta'],
              ['amber', 'Âmbar'],
              ['rose', 'Rosa'],
            ].map(([id, label]) => (
              <button
                title={label}
                aria-label={label}
                className={'accent-swatch ' + id}
                onClick={() => setting({ accent: id })}
                key={id}
              >
                {data.settings.accent === id && <Check size={17} />}
              </button>
            ))}
          </div>
        </div>
        <SettingToggle
          title="Mostrar a mascote"
          description="Vesta aparece na barra lateral, na tela Atividade e nas telas vazias, e muda de pose conforme o que as IAs estão fazendo."
          checked={data.settings.mascot !== false}
          onChange={() => setting({ mascot: data.settings.mascot === false })}
        />
      </section>
      <section className="settings-section">
        <div className="settings-label">
          <Brain size={19} />
          <div>
            <h3>Memória e continuidade</h3>
            <p>Você decide o que acompanha suas conversas.</p>
          </div>
        </div>
        <SettingToggle
          title="Usar memória compartilhada"
          description="Consulta o AI Memory e suas preferências antes de cada resposta."
          checked={data.settings.memoryEnabled}
          onChange={() => setting({ memoryEnabled: !data.settings.memoryEnabled })}
        />
        <SettingToggle
          title="Guardar trechos das conversas"
          description="Salva trechos de até 6 mil caracteres da pergunta e 10 mil da resposta como memória consultável. Não extrai preferências automaticamente."
          checked={data.settings.capture}
          onChange={() => setting({ capture: !data.settings.capture })}
        />
        <SettingToggle
          title="Agentes podem consultar e gravar na memória"
          description="Claude, Codex e OpenCode recebem as ferramentas do AI Memory só nas sessões abertas pelo VeSTA, para buscar decisões anteriores e registrar o que aprenderam neste projeto. Nada muda nas configurações globais desses programas."
          checked={data.settings.memoryTools !== false}
          onChange={() => setting({ memoryTools: data.settings.memoryTools === false })}
        />
      </section>
      <section className="settings-section">
        <div className="settings-label">
          <HardDrive size={19} />
          <div>
            <h3>Seus dados, no seu computador</h3>
            <p>Conversas, preferências e memórias ficam na pasta do VeSTA.</p>
          </div>
        </div>
        <button className="secondary-button" onClick={action(() => call('openData'))}>
          <Folder size={15} />
          Abrir pasta de dados
        </button>
        <p className="fine-print">
          As mensagens e o contexto recuperado são enviados à IA escolhida usando sua conta. A consulta do AI Memory
          acontece localmente.
        </p>
      </section>
      <RemoteSettings call={call} notify={notify} />
      <section className="settings-section">
        <div className="settings-label">
          <RefreshCw size={19} />
          <div>
            <h3>Atualizações</h3>
            <p>Ao abrir, o VeSTA procura uma versão nova nas Releases do GitHub e pergunta antes de instalar.</p>
          </div>
        </div>
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
      </section>
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
