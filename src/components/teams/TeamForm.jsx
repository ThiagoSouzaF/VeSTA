// Creating or editing a team: the project, the goal, who is in it (role, AI, model, whether it edits, the lead) and
// the limits (agents at once, tokens a day, turns per start). The rules that check it live in shared/teams.cjs.
// With a VPS connected (Onde rodam), each member also says where it runs: this PC, or the VPS (its turns go there by
// SSH, with the AIs found there; the Drael only on this PC).
import { useState } from 'react';
import { Crown, FileUp, Plus, Sparkles, X } from 'lucide-react';
import { PROVIDERS } from '../../lib/constants';
import { modelLabel } from '../../lib/format';
import { MAX_MEMBERS, MAX_SOUL, PARALLEL, TEMPLATES, blankTeam } from '../../lib/teams';

// A .md (or .txt) chosen by the person, read here: its text goes into the field.
function readFile(e, onText) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  file.text().then((t) => onText(t.slice(0, MAX_SOUL)));
}

const ORDER = ['claude', 'codex', 'opencode', 'drael'];
const BUDGETS = [
  [500000, '500 mil'],
  [2000000, '2 milhões'],
  [5000000, '5 milhões'],
  [0, 'Sem teto'],
];

export function TeamForm({ initial, isNew, projects, integrations, places = [], onSave, onCancel }) {
  const [f, setF] = useState(initial);
  // The member whose soul is open below its row.
  const [soulOf, setSoulOf] = useState(null);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const setMember = (i, patch) =>
    setF((x) => ({ ...x, members: x.members.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const lead = (i) => setF((x) => ({ ...x, members: x.members.map((m, j) => ({ ...m, lead: j === i })) }));
  const drop = (i) =>
    setF((x) => {
      const members = x.members.filter((_, j) => j !== i);
      if (!members.some((m) => m.lead) && members[0]) members[0] = { ...members[0], lead: true };
      return { ...x, members };
    });
  const add = () =>
    setF((x) => ({
      ...x,
      members: [
        ...x.members,
        {
          name: 'Agent ' + (x.members.length + 1),
          role: '',
          provider: ORDER.find((p) => integrations[p]?.installed) || 'claude',
          model: '',
          mode: 'edit',
          lead: false,
          place: 'pc',
        },
      ],
    }));
  const ready = f.name.trim() && f.projectId && f.goal.trim() && f.members.length >= 2;
  return (
    <form
      className="team-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSave(f);
      }}
    >
      <div className="team-form-head">
        <h2>{isNew ? 'Nova equipe' : 'Editar ' + initial.name}</h2>
        {isNew && (
          <div className="team-templates" role="group" aria-label="Começar de um modelo">
            {Object.entries(TEMPLATES).map(([id, t]) => (
              <button
                key={id}
                type="button"
                data-template={id}
                onClick={() =>
                  setF((x) => ({ ...blankTeam(integrations, id, x.projectId), name: x.name, goal: x.goal }))
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="team-form-grid">
        <label className="team-field">
          <span>NOME</span>
          <input
            value={f.name}
            maxLength={60}
            autoFocus={isNew}
            placeholder="Ex.: Equipe do site"
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <label className="team-field">
          <span>PROJETO</span>
          <select value={f.projectId || ''} onChange={(e) => set({ projectId: e.target.value })}>
            <option value="">Escolha um projeto</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="team-field">
        <span>OBJETIVO</span>
        <textarea
          value={f.goal}
          rows={3}
          maxLength={4000}
          placeholder="O que a equipe deve entregar, e como saber que terminou."
          onChange={(e) => set({ goal: e.target.value })}
        />
      </label>

      <div className="team-field">
        <span>
          CONTEXTO DA EQUIPE{' '}
          <small>opcional: o que todos devem saber (stack, convenções, links, o que não mexer)</small>
          <span className="team-file">
            <FileUp size={12} />
            Carregar .md
            <input
              type="file"
              accept=".md,.txt,text/markdown,text/plain"
              onChange={(e) => readFile(e, (t) => set({ context: t }))}
            />
          </span>
        </span>
        <textarea
          value={f.context || ''}
          rows={3}
          maxLength={MAX_SOUL}
          placeholder="Ex.: Go 1.23 com chi e sqlc; testes com go test ./...; nunca mexer em migrations antigas."
          aria-label="Contexto da equipe"
          onChange={(e) => set({ context: e.target.value })}
        />
      </div>

      <div className="team-field">
        <span>
          QUEM ESTÁ NA EQUIPE{' '}
          <small>
            o líder planeja e distribui; quem edita ganha uma branch própria
            {places.length ? '; numa VPS, trabalha numa pasta dele lá' : ''}
          </small>
        </span>
        <div className="team-members">
          {f.members.map((m, i) => {
            const models = integrations[m.provider]?.models || [];
            const at = m.place && m.place !== 'pc' ? places.find((p) => p.id === m.place) : null;
            const has = (id) => (at ? id !== 'drael' && !!at.ais?.[id] : !!integrations[id]?.installed);
            const soulOpen = soulOf === i;
            return (
              <div className="team-member" key={i}>
                <div className={'team-member-row' + (places.length ? ' placed' : '')} data-member={i}>
                  <button
                    type="button"
                    className={'team-lead' + (m.lead ? ' on' : '')}
                    aria-pressed={!!m.lead}
                    title={m.lead ? 'Líder' : 'Tornar líder'}
                    aria-label={(m.lead ? 'Líder: ' : 'Tornar líder: ') + m.name}
                    onClick={() => lead(i)}
                  >
                    <Crown size={14} />
                  </button>
                  <input
                    className="team-member-name"
                    value={m.name}
                    maxLength={30}
                    aria-label="Nome do agent"
                    onChange={(e) => setMember(i, { name: e.target.value })}
                  />
                  <input
                    className="team-member-role"
                    value={m.role}
                    maxLength={120}
                    placeholder="Papel: o que ele faz"
                    aria-label={'Papel de ' + m.name}
                    onChange={(e) => setMember(i, { role: e.target.value })}
                  />
                  <select
                    value={m.provider}
                    aria-label={'IA de ' + m.name}
                    onChange={(e) => setMember(i, { provider: e.target.value, model: '' })}
                  >
                    {ORDER.map((id) => (
                      <option key={id} value={id} disabled={!has(id) && m.provider !== id}>
                        {PROVIDERS[id].name}
                        {has(id) ? '' : at ? ' (não está lá)' : ' (não instalada)'}
                      </option>
                    ))}
                  </select>
                  <select
                    value={m.model || ''}
                    aria-label={'Modelo de ' + m.name}
                    onChange={(e) => setMember(i, { model: e.target.value })}
                  >
                    <option value="">Modelo padrão</option>
                    {models.map((x) => (
                      <option key={x} value={x}>
                        {modelLabel(x)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={m.mode}
                    aria-label={'O que ' + m.name + ' pode fazer'}
                    onChange={(e) => setMember(i, { mode: e.target.value })}
                  >
                    <option value="edit">Edita</option>
                    <option value="read">Só lê</option>
                  </select>
                  {places.length > 0 && (
                    <select
                      value={m.place || 'pc'}
                      aria-label={'Onde ' + m.name + ' roda'}
                      data-field="place"
                      onChange={(e) => setMember(i, { place: e.target.value })}
                    >
                      <option value="pc">Este PC</option>
                      {places.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.online === false ? ' (fora do ar)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    className={'team-soul-toggle' + (m.soul ? ' has' : '') + (soulOpen ? ' on' : '')}
                    aria-pressed={soulOpen}
                    aria-label={'Alma de ' + m.name}
                    title={m.soul ? 'Alma de ' + m.name + ' (preenchida)' : 'Dar uma alma a ' + m.name}
                    onClick={() => setSoulOf(soulOpen ? null : i)}
                  >
                    <Sparkles size={14} />
                  </button>
                  <button
                    type="button"
                    className="team-drop"
                    aria-label={'Tirar ' + m.name}
                    disabled={f.members.length <= 2}
                    onClick={() => drop(i)}
                  >
                    <X size={14} />
                  </button>
                </div>
                {soulOpen && (
                  <div className="team-soul" data-soul={i}>
                    <span>
                      ALMA DE {m.name.toUpperCase()}{' '}
                      <small>quem é, como pensa e trabalha, o que sabe, o que nunca faz (como um SOUL.md)</small>
                      <span className="team-file">
                        <FileUp size={12} />
                        Carregar .md
                        <input
                          type="file"
                          accept=".md,.txt,text/markdown,text/plain"
                          onChange={(e) => readFile(e, (t) => setMember(i, { soul: t }))}
                        />
                      </span>
                    </span>
                    <textarea
                      value={m.soul || ''}
                      rows={8}
                      maxLength={MAX_SOUL}
                      autoFocus
                      aria-label={'Alma de ' + m.name}
                      placeholder={
                        'Ex.: Você é ' +
                        m.name +
                        ', direto e cuidadoso. Prefere mudanças pequenas e testadas. Antes de mexer em algo grande, pergunta ao líder. Nunca apaga testes para fazê-los passar.'
                      }
                      onChange={(e) => setMember(i, { soul: e.target.value })}
                    />
                    <small>
                      {(m.soul || '').length.toLocaleString('pt-BR')} de {MAX_SOUL.toLocaleString('pt-BR')} caracteres ·
                      vai em todo turno de {m.name}
                    </small>
                  </div>
                )}
              </div>
            );
          })}
          {f.members.length < MAX_MEMBERS && (
            <button type="button" className="team-add" onClick={add}>
              <Plus size={14} />
              Mais um agent
            </button>
          )}
        </div>
      </div>

      <div className="team-form-grid three">
        <label className="team-field">
          <span>AO MESMO TEMPO</span>
          <select value={f.maxParallel} onChange={(e) => set({ maxParallel: Number(e.target.value) })}>
            {PARALLEL.map((n) => (
              <option key={n} value={n}>
                {n} agent{n === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </label>
        <label className="team-field">
          <span>TETO DE TOKENS POR DIA</span>
          <select value={f.budget} onChange={(e) => set({ budget: Number(e.target.value) })}>
            {!BUDGETS.some(([v]) => v === f.budget) && (
              <option value={f.budget}>{f.budget.toLocaleString('pt-BR')}</option>
            )}
            {BUDGETS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="team-field">
          <span>TURNOS POR RODADA</span>
          <input
            type="number"
            min={4}
            max={200}
            value={f.maxTurns}
            onChange={(e) => set({ maxTurns: Number(e.target.value) })}
          />
        </label>
      </div>
      <label className="team-check">
        <input type="checkbox" checked={f.memory !== false} onChange={(e) => set({ memory: e.target.checked })} />
        Usar a memória do VeSTA
      </label>
      <p className="team-note">
        Nada é publicado: juntar as branches no projeto e qualquer push esperam o seu sim. A equipe só trabalha com o
        VeSTA aberto (é ele que leva as mensagens, também para quem está numa VPS) e pausa sozinha no teto de tokens ou
        de turnos.
      </p>
      <div className="team-form-actions">
        <button type="button" className="team-btn" onClick={onCancel}>
          Cancelar
        </button>
        <button className="team-btn ink" disabled={!ready} data-action="save">
          {isNew ? 'Criar equipe' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}
