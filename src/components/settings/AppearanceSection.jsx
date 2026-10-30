import { Check, Palette, Minus, Plus } from 'lucide-react';
import { THEME_NAMES, THEMES } from '../../lib/constants';
import { BACKDROPS } from '../Backdrop';
import { SCALE_MIN, SCALE_MAX, scalePercent } from '../../lib/zoom';
import { SettingsSection } from './SettingsSection';
import { SettingToggle } from './SettingToggle';

const ACCENTS = [
  ['ember', 'Brasa'],
  ['violet', 'Violeta'],
  ['mint', 'Menta'],
  ['amber', 'Âmbar'],
  ['rose', 'Rosa'],
];

function ThemeGrid({ theme, setting }) {
  return (
    <div className="theme-grid">
      {THEMES.map((t) => (
        <button className={'theme-card ' + (theme === t ? 'chosen' : '')} key={t} onClick={() => setting({ theme: t })}>
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
            {theme === t ? (
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
  );
}

function BackdropPicker({ settings, setting }) {
  return (
    <div className="backdrop-setting">
      <div>
        <strong>Fundo</strong>
        <span>Um movimento discreto atrás das conversas, nas cores do tema.</span>
      </div>
      <div className="backdrop-options">
        {BACKDROPS.filter((b) => !(b.id === 'inkrain' && settings.theme === 'ink')).map((b) => (
          <button
            className={'backdrop-option ' + b.id + ((settings.background || 'rain') === b.id ? ' chosen' : '')}
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
  );
}

function FontScale({ fontScale, stepFontScale }) {
  return (
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
  );
}

function AccentPicker({ settings, setting }) {
  if (settings.theme === 'ink')
    return (
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
    );
  return (
    <div className="accent-setting">
      <div>
        <strong>Cor de destaque</strong>
        <span>Um toque da sua personalidade.</span>
      </div>
      <div className="accent-options">
        {ACCENTS.map(([id, label]) => (
          <button
            title={label}
            aria-label={label}
            className={'accent-swatch ' + id}
            onClick={() => setting({ accent: id })}
            key={id}
          >
            {settings.accent === id && <Check size={17} />}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AppearanceSection({ settings, setting, fontScale, stepFontScale }) {
  return (
    <SettingsSection id="appearance" icon={Palette} title="Aparência" description="Escolha a atmosfera do seu espaço.">
      <ThemeGrid theme={settings.theme} setting={setting} />
      <BackdropPicker settings={settings} setting={setting} />
      <FontScale fontScale={fontScale} stepFontScale={stepFontScale} />
      <AccentPicker settings={settings} setting={setting} />
      <SettingToggle
        title="Mostrar a mascote"
        description="Vesta aparece na barra lateral, na tela Atividade e nas telas vazias, e muda de pose conforme o que as IAs estão fazendo."
        checked={settings.mascot !== false}
        onChange={() => setting({ mascot: settings.mascot === false })}
      />
    </SettingsSection>
  );
}
