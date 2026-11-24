// Skills: the library every AI shares (tiles by origin + a drawer with the detail), what each AI already has, and the
// step-by-step import. The library lives in the main process (electron/skills); this screen only calls its methods.
import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Chapter } from '../Chapter';
import { budget, fmt } from '../../lib/skills';
import { SkillLibrary } from './SkillLibrary';
import { NativeSkills } from './NativeSkills';
import { AddSkill } from './AddSkill';
import { TabInk } from '../TabInk';

export function SkillsPage({ data, call, setData, notify, integrations, onTry, onOpenRefine }) {
  const skills = data.skills || { list: [], drafts: [] };
  // An import still waiting for review opens the Adicionar tab first.
  const [tab, setTab] = useState(() => (skills.drafts.length ? 'add' : 'lib'));
  const [seed, setSeed] = useState(null); // what Adicionar starts from: { kind: 'native', dir } | { kind: 'github', url }
  const [selected, setSelected] = useState(null);
  const [nativeCount, setNativeCount] = useState(null);
  const b = useMemo(() => budget(skills.list), [skills.list]);
  useEffect(() => {
    call('skillsNative')
      .then((n) => setNativeCount(n.claude.length + n.codex.length + n.opencode.length))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- counted once per visit
  }, []);
  const startAdd = (from = null) => {
    setSeed(from);
    setTab('add');
  };
  const TABS = [
    ['lib', 'No VeSTA', skills.list.length],
    ['native', 'Na sua IA', nativeCount],
    ['add', 'Adicionar', skills.drafts.length || null],
  ];
  return (
    <div className="content-page skills-page">
      <div className="page-heading">
        <div>
          <Chapter n={5} title="SKILLS" />
          <div className="eyebrow">ENSINE UMA VEZ</div>
          <h1>Todas as IAs sabem.</h1>
          <p>
            Receitas de trabalho que o VeSTA entrega ao Claude, ao ChatGPT, ao OpenCode e ao Drael, como faz com a
            memória. Chame no chat com <b className="mono">/nome</b>, ou deixe a IA usar quando fizer sentido.
          </p>
        </div>
        <button className="primary-button" onClick={() => startAdd()}>
          <Plus size={16} />
          Adicionar skill
        </button>
      </div>
      <div className="skills-budget" aria-label="Custo das skills">
        <span>
          <b>{b.on}</b> ativas
        </span>
        <span>
          Lista enviada no começo de cada sessão: <b>~{fmt(b.catalog)}</b> tokens
        </span>
        <span>Texto completo: só quando a skill é usada</span>
      </div>
      <div className="skills-tabs tab-ink-host" role="tablist" aria-label="Skills">
        {TABS.map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} data-tab={id} onClick={() => setTab(id)}>
            {id === 'add' && <Plus size={14} />}
            {label}
            {n !== null && n !== undefined && <span className="skills-n">{n}</span>}
          </button>
        ))}
        <TabInk active="[aria-selected='true']" value={tab} />
      </div>
      {tab === 'lib' && (
        <SkillLibrary
          data={data}
          integrations={integrations}
          onOpenRefine={onOpenRefine}
          skills={skills}
          call={call}
          setData={setData}
          notify={notify}
          selected={selected}
          setSelected={setSelected}
          onAdd={startAdd}
          onTry={onTry}
        />
      )}
      {tab === 'native' && <NativeSkills call={call} onBring={(dir) => startAdd({ kind: 'native', dir })} />}
      {tab === 'add' && (
        <AddSkill
          key={seed ? JSON.stringify(seed) : 'add'}
          seed={seed}
          skills={skills}
          call={call}
          setData={setData}
          notify={notify}
          integrations={integrations}
          onSaved={(names) => {
            setSeed(null);
            setSelected(names[0] || null);
            setTab('lib');
          }}
        />
      )}
    </div>
  );
}
