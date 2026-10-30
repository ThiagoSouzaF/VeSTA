import { Brain, Eye, Folder, Check, RefreshCw, Palette, HardDrive, Minus, Plus, Info } from 'lucide-react';
import { THEME_NAMES, THEMES } from '../lib/constants';
import { BACKDROPS } from './Backdrop';
import { SettingToggle } from './SettingToggle';
import { RemoteSettings } from './RemoteSettings';
import { BackupSettings } from './BackupSettings';
import { action } from '../lib/api';
import { Mark, Wordmark } from './Brand';
import { Chapter } from './Chapter';
import { SCALE_MIN, SCALE_MAX, scalePercent } from '../lib/zoom';
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
      <section className="settings-section" data-section="appearance">
        <div className="settings-label">
          <Palette size={19} />
          <div>
            <h3>Aparência</h3>
            <p>Escolha a atmosfera do seu espaço.</p>
          </div>
        </div>
        <div className="theme-grid">
          {THEMES.map((t) => (
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
            {BACKDROPS.filter((b) => !(b.id === 'inkrain' && data.settings.theme === 'ink')).map((b) => (
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
        {data.settings.theme === 'ink' ? (
          <div className="accent-setting ink-only">
            <div>
              <strong>Cor de destaque</strong>
              <span>A Tinta Mangá é só preto e branco. As cores de destaque ficam nos outros temas.</span>
            </div>
            <div className="accent-options">
              <span className="accent-swatch ink chosen" title="Tinta" aria-label="Tinta (única opção)">
                <Check size={17} />
              </span>
              <span className="accent-ink-name">TINTA</span>
            </div>
          </div>
        ) : (
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
        )}
        <SettingToggle
          title="Mostrar a mascote"
          description="Vesta aparece na barra lateral, na tela Atividade e nas telas vazias, e muda de pose conforme o que as IAs estão fazendo."
          checked={data.settings.mascot !== false}
          onChange={() => setting({ mascot: data.settings.mascot === false })}
        />
      </section>
      <section className="settings-section" data-section="memory">
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
          title="Aprender com as conversas"
          description="Cada conversa vira uma sessão no AI Memory: seus pedidos, as ferramentas usadas e um trecho da resposta. Depois de 30 minutos sem mensagens (ou ao trocar de IA ou de projeto) a sessão é encerrada."
          checked={data.settings.capture !== false}
          onChange={() => setting({ capture: data.settings.capture === false })}
        />
        <SettingToggle
          title="Consolidar com IA (Codex)"
          description="Ao encerrar a sessão, o Codex resume a conversa e extrai regras, armadilhas e decisões em páginas próprias, usando o seu login do Codex (consome a cota do ChatGPT; o conteúdo da conversa vai para a OpenAI, mesmo em chats do Claude). Desligado, a sessão fica só com um resumo automático, sem IA."
          checked={data.settings.memoryConsolidate === 'codex'}
          disabled={data.settings.capture === false}
          onChange={() => setting({ memoryConsolidate: data.settings.memoryConsolidate === 'codex' ? 'off' : 'codex' })}
        />
        <SettingToggle
          title="Guardar também a conversa bruta"
          description="Modo antigo: salva cada resposta inteira (até 6 mil caracteres da pergunta e 10 mil da resposta) como uma página. Gera muito volume; deixe desligado se a consolidação estiver ativa."
          checked={!!data.settings.captureRaw}
          onChange={() => setting({ captureRaw: !data.settings.captureRaw })}
        />
        <SettingToggle
          title="Agentes podem consultar e gravar na memória"
          description="Claude, Codex e OpenCode recebem as ferramentas do AI Memory só nas sessões abertas pelo VeSTA, para buscar decisões anteriores e registrar o que aprenderam neste projeto. Nada muda nas configurações globais desses programas."
          checked={data.settings.memoryTools !== false}
          onChange={() => setting({ memoryTools: data.settings.memoryTools === false })}
        />
        <SettingToggle
          title="Os chats podem mudar as preferências"
          description="Peça numa conversa (“mude o tema para Papel”, “faça um backup agora”) e a IA ajusta o VeSTA. Conectar o Google Drive, restaurar backups e o controle pelo celular continuam só aqui. Chats em Só consulta apenas leem."
          checked={data.settings.chatSettings !== false}
          onChange={() => setting({ chatSettings: data.settings.chatSettings === false })}
        />
      </section>
      <section className="settings-section" data-section="follow">
        <div className="settings-label">
          <Eye size={19} />
          <div>
            <h3>Processos em segundo plano</h3>
            <p>Quando o Claude deixa um comando rodando, o VeSTA continua de olho e mostra o retorno dele.</p>
          </div>
        </div>
        <div className="setting-row">
          <div>
            <strong>Acompanhar por até</strong>
            <p>
              Depois desse tempo o VeSTA para de acompanhar e avisa no chat. Servidores de desenvolvimento, que nunca
              terminam, caem nesse limite. Os processos continuam rodando.
            </p>
          </div>
          <select
            aria-label="Tempo máximo de acompanhamento"
            value={data.settings.followMinutes ?? 120}
            onChange={(e) => setting({ followMinutes: Number(e.target.value) })}
          >
            {[15, 30, 60, 120, 240, 480, 720].map((m) => (
              <option value={m} key={m}>
                {m >= 60 ? m / 60 + ' h' : m + ' min'}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>Conversas acompanhadas ao mesmo tempo</strong>
            <p>Cada uma mantém um processo do Claude aberto. Acima do limite, o turno termina como antes.</p>
          </div>
          <select
            aria-label="Máximo de conversas acompanhadas"
            value={data.settings.followMax ?? 3}
            onChange={(e) => setting({ followMax: Number(e.target.value) })}
          >
            {[1, 2, 3, 5, 8, 10].map((n) => (
              <option value={n} key={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </section>
      <section className="settings-section" data-section="data">
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
      <BackupSettings call={call} notify={notify} />
      <RemoteSettings call={call} notify={notify} />
      <section className="settings-section" data-section="updates">
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
