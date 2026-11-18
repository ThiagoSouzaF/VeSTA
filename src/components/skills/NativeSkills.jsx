// Skills → Na sua IA: what Claude Code and Codex already have on this computer (read only). Each one can be brought
// into VeSTA, where an AI adapts it for the others.
import { useEffect, useMemo, useState } from 'react';
import { Search, Download, LoaderCircle } from 'lucide-react';

const TABS = [
  ['claude', 'C', 'Claude Code'],
  ['codex', 'G', 'ChatGPT (Codex)'],
  ['opencode', 'O', 'OpenCode'],
];
const NOTES = {
  claude:
    'Lidas de ~/.claude/skills, dos plugins instalados e da pasta .claude/skills dos seus projetos. O VeSTA só lê: nada aqui é alterado. Se a mesma skill estiver nos dois lugares, o VeSTA não manda a cópia dele ao Claude.',
  codex:
    'Lidas de ~/.codex/skills e dos plugins do Codex. O formato é o mesmo (pasta com SKILL.md), então qualquer uma pode vir para o VeSTA.',
  opencode:
    'O OpenCode chama os modelos por API e não tem uma pasta de skills própria aqui. Ele recebe as skills do VeSTA pela ferramenta vesta-skills, como a memória.',
};

export function NativeSkills({ call, onBring }) {
  const [list, setList] = useState(null);
  const [tab, setTab] = useState('claude');
  const [query, setQuery] = useState('');
  useEffect(() => {
    call('skillsNative')
      .then(setList)
      .catch(() => setList({ claude: [], codex: [], opencode: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once when the tab opens
  }, []);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list?.[tab] || []).filter(
      (s) => !q || s.name.includes(q) || (s.description || '').toLowerCase().includes(q)
    );
  }, [list, tab, query]);
  return (
    <section className="skills-native" role="tabpanel" aria-label="Na sua IA">
      <nav aria-label="IA">
        {TABS.map(([id, letter, name]) => (
          <button key={id} aria-current={tab === id} onClick={() => setTab(id)}>
            <span className="skill-ai">{letter}</span>
            {name}
            <small>{list ? list[id].length || '—' : ''}</small>
          </button>
        ))}
      </nav>
      <div>
        <p className="skills-note">{NOTES[tab]}</p>
        {tab !== 'opencode' && (
          <label className="skills-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar nesta IA"
              aria-label="Buscar nesta IA"
            />
          </label>
        )}
        {!list ? (
          <div className="skills-empty">
            <LoaderCircle size={16} className="spin" /> Procurando…
          </div>
        ) : shown.length ? (
          <div className="skills-native-list">
            {shown.map((s) => (
              <div key={s.dir} className="skill-native-row" data-native={s.name}>
                <div>
                  <span className="skill-name">{s.name}</span>
                  {s.inVesta && <span className="skill-tag solid">também no VeSTA</span>}
                  <div className="skill-desc">{s.description || 'Sem descrição.'}</div>
                  <div className="skill-where">{s.label}</div>
                </div>
                {s.inVesta ? (
                  <button className="secondary-button" disabled>
                    Já está no VeSTA
                  </button>
                ) : (
                  <button className="secondary-button" onClick={() => onBring(s.dir)}>
                    <Download size={14} />
                    Trazer para o VeSTA
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          tab !== 'opencode' && <div className="skills-empty">Nada para listar nesta IA.</div>
        )}
      </div>
    </section>
  );
}
