// Skills → Adicionar: where the skill comes from (file, paste, GitHub link, or an AI's own skill), which ones to bring,
// who adapts them (or keep as they came), then a side-by-side review before anything reaches the library.
// The scan and the drafts live in the main process; drafts survive leaving this screen (not a restart of the app).
import { useEffect, useMemo, useState } from 'react';
import {
  FileText,
  ClipboardPaste,
  Github,
  FolderOpen,
  Search,
  TriangleAlert,
  LoaderCircle,
  Check,
  X,
  RotateCcw,
  Pencil,
} from 'lucide-react';
import { fmt } from '../../lib/skills';
import { modelLabel } from '../../lib/format';
import { ModeSeg, HealthTag, HealthList } from './SkillBits';

const STEPS = ['De onde vem', 'Quais skills', 'Quem adapta', 'Revisar e salvar'];
const ADAPTERS = [
  ['claude', 'Claude', 'bom em reescrever instruções'],
  ['codex', 'ChatGPT (Codex)', 'usa o limite do plano do ChatGPT'],
  ['opencode', 'OpenCode', 'cobrança por token na API'],
  ['drael', 'Drael', 'só lê, também serve para adaptar'],
];
const STATUS = { waiting: 'na fila', running: 'adaptando', ready: 'pronta', error: 'falhou' };

export function AddSkill({ seed, skills, call, setData, notify, integrations, onSaved }) {
  const [step, setStep] = useState(skills.drafts.length && !seed ? 3 : 0);
  const [src, setSrc] = useState(seed?.kind === 'github' ? 'link' : 'paste');
  const [text, setText] = useState('');
  const [url, setUrl] = useState(seed?.url || '');
  const [scan, setScan] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const installed = ADAPTERS.filter(([id]) => integrations?.[id]?.installed);
  const [ai, setAi] = useState(installed[0]?.[0] || 'claude');
  const [model, setModel] = useState('');
  const [lang, setLang] = useState('pt-BR');

  async function runScan(input) {
    setBusy(true);
    try {
      const r = await call('skillsScan', input);
      if (!r) return;
      setScan(r);
      // Skills already in VeSTA start unchecked: bringing them again replaces the current version.
      const fresh = r.candidates.filter((c) => !c.exists);
      setPicked(new Set((fresh.length ? fresh : r.candidates).map((c) => c.key)));
      setStep(r.candidates.length > 1 ? 1 : 2);
    } catch {
    } finally {
      setBusy(false);
    }
  }
  // Brought from Na sua IA, or "Atualizar do GitHub": the reading starts at once.
  useEffect(() => {
    if (seed?.kind === 'native') runScan({ kind: 'native', dir: seed.dir });
    if (seed?.kind === 'github' && seed.url) runScan({ kind: 'github', url: seed.url });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only for the seed this wizard was opened with
  }, []);

  const chosen = scan ? scan.candidates.filter((c) => picked.has(c.key)) : [];
  async function start(adapt) {
    setBusy(true);
    try {
      const args = { scanId: scan.scanId, keys: [...picked] };
      const r = await call(adapt ? 'skillsAdapt' : 'skillsKeep', adapt ? { ...args, provider: ai, model, lang } : args);
      setData(r.state);
      setStep(3);
    } catch {
    } finally {
      setBusy(false);
    }
  }
  const at = Math.min(step, 3);
  return (
    <section className="skills-wizard" role="tabpanel" aria-label="Adicionar">
      <ol className="skills-steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i === at ? 'on' : i < at ? 'done' : ''}>
            {label}
          </li>
        ))}
      </ol>
      <div className="skills-panel">
        {step === 0 && (
          <>
            <h3>De onde vem a skill?</h3>
            <p className="skills-hint">
              Um arquivo SKILL.md (ou a pasta dele), o texto colado, ou um link do GitHub. Um repositório com várias
              skills deixa você escolher quais.
            </p>
            <div className="skills-src-pick" role="group" aria-label="Origem">
              {[
                ['file', FileText, 'Arquivo', 'SKILL.md, .md ou a pasta'],
                ['paste', ClipboardPaste, 'Colar', 'o conteúdo da skill'],
                ['link', Github, 'Link do GitHub', 'uma skill ou um repositório'],
              ].map(([id, Icon, label, hint]) => (
                <button key={id} aria-pressed={src === id} data-src={id} onClick={() => setSrc(id)}>
                  <Icon size={16} />
                  <b>{label}</b>
                  <small>{hint}</small>
                </button>
              ))}
            </div>
            {src === 'file' && (
              <div className="skills-drop">
                <button className="secondary-button" disabled={busy} onClick={() => runScan({ kind: 'file' })}>
                  <FileText size={14} />
                  Escolher arquivo
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => runScan({ kind: 'file', folder: true })}
                >
                  <FolderOpen size={14} />
                  Escolher pasta
                </button>
              </div>
            )}
            {src === 'paste' && (
              <div className="skills-field">
                <label htmlFor="skill-paste">CONTEÚDO</label>
                <textarea
                  id="skill-paste"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={'---\nname: minha-skill\ndescription: O que faz e quando usar.\n---\n\n# Minha skill\n…'}
                  spellCheck={false}
                />
              </div>
            )}
            {src === 'link' && (
              <div className="skills-field">
                <label htmlFor="skill-link">LINK</label>
                <input
                  id="skill-link"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/dono/repositorio/tree/main/skills"
                />
                <p className="skills-hint">
                  Repositório público: baixa direto. Privado: usa o login do GitHub CLI (gh) que você já tem.
                </p>
              </div>
            )}
            <div className="skills-foot">
              {skills.drafts.length > 0 && (
                <button className="secondary-button left" onClick={() => setStep(3)}>
                  Revisar {skills.drafts.length} pendente{skills.drafts.length > 1 ? 's' : ''}
                </button>
              )}
              {src !== 'file' && (
                <button
                  className="primary-button"
                  disabled={busy || (src === 'paste' ? !text.trim() : !url.trim())}
                  onClick={() => runScan(src === 'paste' ? { kind: 'paste', text } : { kind: 'github', url })}
                >
                  {busy && <LoaderCircle size={14} className="spin" />}
                  {busy ? 'Lendo…' : 'Continuar'}
                </button>
              )}
            </div>
          </>
        )}
        {step === 1 && scan && (
          <PickStep
            scan={scan}
            picked={picked}
            setPicked={setPicked}
            filter={filter}
            setFilter={setFilter}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && scan && (
          <>
            <h3>Quem lê e adapta?</h3>
            <p className="skills-hint">
              A IA escolhida lê cada skill e reescreve para funcionar em todas as IAs do VeSTA: troca ferramentas de um
              produto só por instruções gerais e marca onde a skill não funciona. Você revisa antes de salvar.
            </p>
            <ul className="skills-chosen">
              {chosen.map((c) => (
                <li key={c.key}>
                  <b className="mono">/{c.name}</b>
                  {c.exists && <span className="skill-tag warn">substitui a do VeSTA</span>}
                  {c.hasScripts && <span className="skill-tag warn">tem scripts</span>}
                  <HealthTag health={c.health} />
                </li>
              ))}
            </ul>
            {chosen.map((c) => (
              <HealthList
                key={c.key}
                health={c.health}
                title={chosen.length > 1 ? 'VERIFICAÇÃO · /' + c.name : 'VERIFICAÇÃO'}
              />
            ))}
            {chosen.some((c) => c.health?.length) && (
              <p className="skills-hint">
                Ao adaptar, a IA recebe essa lista e corrige o que der. Na revisão você vê o que ainda ficou.
              </p>
            )}
            {installed.length ? (
              <div className="skills-ai-pick" role="group" aria-label="IA que adapta">
                {installed.map(([id, name, why]) => (
                  <button
                    key={id}
                    aria-pressed={ai === id}
                    data-ai={id}
                    onClick={() => {
                      setAi(id);
                      setModel('');
                    }}
                  >
                    <b>{name}</b>
                    <small>{why}</small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="skills-warn">
                <TriangleAlert size={16} />
                Nenhuma IA instalada para adaptar. Você ainda pode salvar a skill como veio.
              </p>
            )}
            <div className="skills-row">
              {installed.length > 0 && integrations?.[ai]?.models?.length > 0 && (
                <div className="skills-field">
                  <label htmlFor="skill-model">MODELO</label>
                  <select id="skill-model" value={model} onChange={(e) => setModel(e.target.value)}>
                    <option value="">Padrão da IA</option>
                    {integrations[ai].models.map((m) => (
                      <option key={m} value={m}>
                        {modelLabel(m)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="skills-field">
                <label htmlFor="skill-lang">IDIOMA DA SKILL ADAPTADA</label>
                <select id="skill-lang" value={lang} onChange={(e) => setLang(e.target.value)}>
                  <option value="pt-BR">Português do Brasil</option>
                  <option value="keep">Manter o original</option>
                </select>
              </div>
            </div>
            <p className="skills-hint">
              Custo estimado: ~{fmt(chosen.reduce((a, c) => a + c.tokens * 2 + 2500, 0))} tokens, uma vez só (
              {chosen.length} skill{chosen.length > 1 ? 's' : ''}). Usar a skill depois não repete esse custo.
            </p>
            <div className="skills-foot">
              <button className="secondary-button left" onClick={() => setStep(scan.candidates.length > 1 ? 1 : 0)}>
                Voltar
              </button>
              <button className="secondary-button" disabled={busy || !chosen.length} onClick={() => start(false)}>
                Salvar sem adaptar
              </button>
              <button
                className="primary-button"
                disabled={busy || !chosen.length || !installed.length}
                onClick={() => start(true)}
              >
                Adaptar
              </button>
            </div>
          </>
        )}
        {step === 3 && (
          <ReviewStep
            drafts={skills.drafts}
            call={call}
            setData={setData}
            notify={notify}
            installed={installed}
            onAddMore={() => {
              setScan(null);
              setStep(0);
            }}
            onSaved={onSaved}
          />
        )}
      </div>
    </section>
  );
}

function PickStep({ scan, picked, setPicked, filter, setFilter, onBack, onNext }) {
  const q = filter.trim().toLowerCase();
  const shown = scan.candidates.filter((c) => !q || c.name.includes(q) || c.description.toLowerCase().includes(q));
  const scripts = scan.candidates.some((c) => picked.has(c.key) && c.hasScripts);
  const toggle = (key) =>
    setPicked((p) => {
      const n = new Set(p);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  return (
    <>
      <h3>Quais skills trazer?</h3>
      <p className="skills-hint">
        {scan.candidates.length} skills em <span className="mono">{scan.label}</span>
        {scan.truncated ? ' (o repositório é grande: o GitHub mostrou só parte dele)' : ''}.
        {scan.candidates[0]?.license
          ? ' Licença ' + scan.candidates[0].license + ': o crédito fica guardado em cada uma.'
          : ''}
      </p>
      <label className="skills-search wide">
        <Search size={15} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar"
          aria-label="Filtrar skills encontradas"
        />
      </label>
      <div className="skills-pick-list">
        {shown.map((c) => (
          <label key={c.key} className="skills-pick">
            <input type="checkbox" checked={picked.has(c.key)} onChange={() => toggle(c.key)} data-pick={c.name} />
            <span className="skill-name">{c.name}</span>
            <span className="skill-desc">{c.description || 'Sem descrição.'}</span>
            <span className="skills-pick-tags">
              {c.exists && <span className="skill-tag">já no VeSTA</span>}
              {c.hasScripts && <span className="skill-tag warn">tem scripts</span>}
              <HealthTag health={c.health} />
              <span className="skill-tag">~{fmt(c.tokens)} tk</span>
            </span>
          </label>
        ))}
      </div>
      {scripts && (
        <p className="skills-warn">
          <TriangleAlert size={16} />
          <span>
            Skills com scripts trazem código junto. O VeSTA guarda os scripts, mas <b>nunca</b> os roda sozinho: a IA só
            executa se você permitir, como qualquer comando.
          </span>
        </p>
      )}
      <div className="skills-foot">
        <button className="secondary-button left" onClick={onBack}>
          Voltar
        </button>
        <button className="primary-button" disabled={!picked.size} onClick={onNext}>
          Continuar com {picked.size}
        </button>
      </div>
    </>
  );
}

function ReviewStep({ drafts, call, setData, notify, installed, onAddMore, onSaved }) {
  const [sel, setSel] = useState(drafts[0]?.id || null);
  const [doc, setDoc] = useState(null);
  const [edit, setEdit] = useState(null);
  const [redoAi, setRedoAi] = useState('');
  const current = drafts.find((d) => d.id === sel) || drafts[0] || null;
  const ready = drafts.filter((d) => d.status === 'ready');
  const pending = drafts.filter((d) => d.status === 'waiting' || d.status === 'running').length;
  const readyKey = current ? current.id + current.status + current.tokens + current.name : '';
  useEffect(() => {
    setDoc(null);
    setEdit(null);
    if (current?.status !== 'ready') return;
    call('skillsDraftRead', { id: current.id })
      .then(setDoc)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reread when the draft itself changes
  }, [readyKey]);
  const act = async (method, args, message) => {
    try {
      const r = await call(method, args);
      setData(r.state);
      if (message) notify(message);
      return r.result;
    } catch {}
  };
  const conflict = useMemo(() => ready.some((d) => d.exists), [ready]);
  if (!drafts.length)
    return (
      <div className="skills-empty">
        Nada esperando revisão.{' '}
        <button className="text-link" onClick={onAddMore}>
          Adicionar uma skill
        </button>
      </div>
    );
  return (
    <>
      <h3>Revisar e salvar</h3>
      <p className="skills-hint">
        {pending
          ? 'A IA está lendo as skills. Pode sair desta tela: o trabalho continua.'
          : 'Original à esquerda, a versão que as IAs vão receber à direita. Nada fica ativo antes de você salvar.'}
      </p>
      <div className="skills-progress">
        {drafts.map((d) => (
          <button
            key={d.id}
            className={'skills-prow ' + d.status + (current?.id === d.id ? ' on' : '')}
            onClick={() => setSel(d.id)}
            data-draft={d.name}
          >
            {d.status === 'ready' ? (
              <Check size={14} />
            ) : d.status === 'error' ? (
              <TriangleAlert size={14} />
            ) : (
              <LoaderCircle size={14} className="spin" />
            )}
            <b className="mono">/{d.name}</b>
            <span>{STATUS[d.status]}</span>
          </button>
        ))}
      </div>
      {current?.status === 'error' && <p className="skills-warn">{current.error}</p>}
      {current?.status === 'ready' && doc && (
        <>
          {edit !== null ? (
            <textarea
              className="skill-editor"
              value={edit}
              onChange={(e) => setEdit(e.target.value)}
              aria-label="Texto da skill"
              spellCheck={false}
            />
          ) : (
            <div className="skills-diff">
              <div>
                <h4>
                  ORIGINAL <span>{current.source?.label}</span>
                </h4>
                <pre>{doc.original}</pre>
              </div>
              <div>
                <h4>
                  {current.compat ? 'ADAPTADA' : 'COMO VEIO'} <span>~{fmt(current.tokens)} tokens</span>
                </h4>
                <pre>{doc.text}</pre>
              </div>
            </div>
          )}
          {current.changes.length > 0 && (
            <ul className="skill-changes">
              {current.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
          <HealthList
            health={current.health}
            title="O QUE A VERIFICAÇÃO AINDA APONTA"
            clean="A verificação não achou nada a corrigir nesta versão."
          />
          {current.compat && Object.entries(current.compat).some(([, v]) => v !== 'ok') && (
            <p className="skills-hint">
              Não funciona em:{' '}
              {Object.entries(current.compat)
                .filter(([, v]) => v !== 'ok')
                .map(([k, v]) => k + ' (' + v + ')')
                .join(', ')}
            </p>
          )}
          <div className="skills-row">
            <div className="skills-field">
              <label>QUANDO USAR</label>
              <ModeSeg
                value={doc.mode || 'auto'}
                onChange={(mode) =>
                  act('skillsDraftUpdate', { id: current.id, mode }).then(() => setDoc({ ...doc, mode }))
                }
              />
            </div>
            {current.exists && (
              <div className="skills-field">
                <label htmlFor="skill-rename">NOME (JÁ EXISTE /{current.name})</label>
                <input
                  id="skill-rename"
                  defaultValue={current.name}
                  onBlur={(e) =>
                    e.target.value !== current.name &&
                    act('skillsDraftUpdate', { id: current.id, name: e.target.value })
                  }
                />
              </div>
            )}
          </div>
        </>
      )}
      <div className="skills-foot">
        <button className="secondary-button left" onClick={onAddMore}>
          Adicionar outra
        </button>
        {current && current.status !== 'running' && (
          <button
            className="secondary-button"
            onClick={() => act('skillsDiscard', { ids: [current.id] }, 'Descartada')}
          >
            <X size={14} />
            Descartar
          </button>
        )}
        {current && ['ready', 'error'].includes(current.status) && installed.length > 0 && (
          <span className="skills-redo">
            <select value={redoAi} onChange={(e) => setRedoAi(e.target.value)} aria-label="Refazer com">
              <option value="">Refazer com…</option>
              {installed.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <button
              className="secondary-button"
              disabled={!redoAi}
              onClick={() => act('skillsRedo', { id: current.id, provider: redoAi }).then(() => setRedoAi(''))}
            >
              <RotateCcw size={14} />
              Refazer
            </button>
          </span>
        )}
        {current?.status === 'ready' &&
          doc &&
          (edit === null ? (
            <button className="secondary-button" onClick={() => setEdit(doc.text)}>
              <Pencil size={14} />
              Editar à mão
            </button>
          ) : (
            <button
              className="secondary-button"
              onClick={() =>
                act('skillsDraftUpdate', { id: current.id, text: edit }).then(() => {
                  setDoc({ ...doc, text: edit });
                  setEdit(null);
                })
              }
            >
              <Check size={14} />
              Usar este texto
            </button>
          ))}
        <button
          className="primary-button"
          disabled={!ready.length || edit !== null}
          title={conflict ? 'As que já existem no VeSTA são substituídas' : undefined}
          onClick={async () => {
            const names = await act('skillsSaveDrafts', { ids: ready.map((d) => d.id), replace: true });
            if (names?.length) {
              notify(names.length > 1 ? names.length + ' skills salvas' : 'Skill /' + names[0] + ' salva');
              onSaved(names);
            }
          }}
        >
          Salvar {ready.length || ''} skill{ready.length === 1 ? '' : 's'}
        </button>
      </div>
    </>
  );
}
