// The "/" menu above the composer: VeSTA's skills that match what follows the "/". The composer drives it from the
// keyboard (↑ ↓ choose, Tab completes, Enter sends, Esc closes); a click completes the name.
import { BookOpen } from 'lucide-react';
import { costLevel, fmt } from '../lib/skills';

export function SlashMenu({ items, index, onPick }) {
  return (
    <div className="slash-menu" role="listbox" aria-label="Skills">
      <div className="slash-head">
        <span>
          <BookOpen size={12} /> SKILLS DO VESTA
        </span>
        <span>{items.length}</span>
      </div>
      {items.length ? (
        items.map((s, i) => (
          <button
            key={s.name}
            type="button"
            role="option"
            aria-selected={i === index}
            data-slash={s.name}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(s.name)}
          >
            <span className="skill-name">/{s.name}</span>
            <span className="skill-desc">{s.description}</span>
            <span className={'skill-tag' + (costLevel(s) === 3 ? ' warn' : '')}>~{fmt(s.tokens)} tk</span>
          </button>
        ))
      ) : (
        <div className="slash-none">Nenhuma skill com esse nome. O texto vai como mensagem normal.</div>
      )}
      <div className="slash-foot">
        ↑ ↓ escolhe · Tab completa · Enter envia · Esc fecha · comandos da própria IA passam direto
      </div>
    </div>
  );
}
