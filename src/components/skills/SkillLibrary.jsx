// Skills → No VeSTA: tiles grouped by origin, search and filters; a click opens the skill in the drawer.
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { FILTERS, costLevel, filterSkills, groupBySource } from '../../lib/skills';
import { AiBadges } from './SkillBits';
import { SkillDrawer } from './SkillDrawer';
import { usePresence, EXIT } from '../../hooks/usePresence';

export function SkillLibrary({ skills, call, setData, notify, selected, setSelected, onAdd, onTry }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const groups = useMemo(
    () => groupBySource(filterSkills(skills.list, { query, filter })),
    [skills.list, query, filter]
  );
  const current = skills.list.find((s) => s.name === selected) || null;
  const [drawn, drawerState] = usePresence(current, EXIT.panel);
  if (!skills.list.length)
    return (
      <div className="skills-empty">
        <p>
          Nenhuma skill no VeSTA ainda. Traga uma do GitHub, cole o texto de um SKILL.md ou use uma que o Claude ou o
          Codex já têm.
        </p>
        <button className="primary-button" onClick={() => onAdd()}>
          Adicionar a primeira
        </button>
      </div>
    );
  return (
    <section role="tabpanel" aria-label="No VeSTA">
      <div className="skills-bar">
        <label className="skills-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar skill pelo nome ou descrição"
            aria-label="Buscar skill"
          />
        </label>
        <div className="skills-filter" role="group" aria-label="Filtrar">
          {FILTERS.map(([id, label]) => (
            <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {groups.map((g) => (
        <section key={g.label} className="skill-group" aria-label={g.label}>
          <header>
            <b>{g.label}</b>
            <span>
              {g.items.length} skill{g.items.length > 1 ? 's' : ''}
              {g.license ? ' · ' + g.license : ''}
            </span>
          </header>
          <div className="skill-tiles">
            {g.items.map((s) => (
              <button
                key={s.name}
                className={'skill-tile' + (s.enabled ? '' : ' disabled') + (s.name === selected ? ' selected' : '')}
                data-skill={s.name}
                onClick={() => setSelected(s.name)}
              >
                <span className="skill-tile-top">
                  <span className="skill-name">/{s.name}</span>
                  {!s.enabled ? (
                    <span className="skill-tag">desligada</span>
                  ) : costLevel(s) === 3 ? (
                    <span className="skill-tag warn">custo alto</span>
                  ) : s.mode === 'slash' ? (
                    <span className="skill-tag">só com /</span>
                  ) : null}
                </span>
                <span className="skill-desc">{s.description || 'Sem descrição.'}</span>
                <span className="skill-tile-foot">
                  <AiBadges skill={s} />
                  <span className="skill-tag">{s.uses ? s.uses + (s.uses > 1 ? ' usos' : ' uso') : 'nunca usada'}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {!groups.length && (
        <div className="skills-empty">
          Nenhuma skill com “{query}”.{' '}
          <button className="text-link" onClick={() => onAdd()}>
            Adicionar uma
          </button>
        </div>
      )}
      {drawn && (
        <SkillDrawer
          key={drawn.name}
          state={drawerState}
          skill={drawn}
          call={call}
          setData={setData}
          notify={notify}
          onClose={() => setSelected(null)}
          onTry={onTry}
          onUpdate={(url) => onAdd({ kind: 'github', url })}
        />
      )}
    </section>
  );
}
