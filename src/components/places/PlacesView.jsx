// Onde rodam: the places where agents run with VeSTA closed (phase 1: this PC). The place's runner, its AIs, the
// standard folder with the commands to use it by hand, the agents installed there and the folder as a tree. Everything
// comes from the main process (electron/places); this screen only calls its methods.
import { useEffect, useState } from 'react';
import { Copy, Download, FolderOpen, RefreshCw } from 'lucide-react';
import { PROVIDERS } from '../../lib/constants';
import { ProviderIcon } from '../ProviderIcon';
import { agoLabel, describeSchedule, untilLabel } from '../../lib/agents';
import { folderTree } from '../../lib/places';
import { InstallModal } from './InstallModal';
import { PlaceDrawer } from './PlaceDrawer';

const AI_IDS = ['claude', 'codex', 'opencode', 'drael'];

export function PlacesView({ data, call, setData, notify, onOpenAgent }) {
  const [view, setView] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const [hover, setHover] = useState(null);
  const apply = (r) => {
    if (r?.places) setView(r);
    if (r?.state) setData(r.state);
    return r;
  };
  const load = () =>
    call('placesView')
      .then(apply)
      .catch(() => {});
  // The folder is read again while the screen is open: a run that ends there shows up by itself.
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, []);
  const act = async (method, args, message) => {
    try {
      apply(await call(method, args));
      if (message) notify(message);
      return true;
    } catch {
      return false;
    }
  };
  if (!view) return <div className="places-loading">Lendo os lugares…</div>;
  const place = view.places[0];
  const failed = place.agents.filter((x) => x.last?.status === 'error').length;
  const outdated = place.agents.filter((x) => x.outdated).length;
  const agentOf = (x) => (data.agents || []).find((a) => a.id === x.agentId);
  const now = Date.now();

  return (
    <div className="places">
      <aside className="places-list" aria-label="Lugares">
        <h3>LUGARES</h3>
        <div className="place-pick" aria-current="true">
          <span className="place-row">
            <i className={'place-dot ' + (place.agents.some((x) => x.running) ? 'busy' : 'on')} />
            <b>{place.name}</b>
            <span className="place-count">{place.agents.length}</span>
          </span>
          <small>{place.kind}</small>
          {(failed > 0 || outdated > 0 || place.runner.outdated) && (
            <span className="place-row">
              {failed > 0 && <span className="place-bad">✕ {failed} falhou</span>}
              {place.runner.outdated && <span className="place-flag">executor antigo</span>}
              {outdated > 0 && (
                <span className="place-flag">
                  {outdated} desatualizado{outdated > 1 ? 's' : ''}
                </span>
              )}
            </span>
          )}
        </div>
        <p className="places-soon">VPS por SSH chegam na próxima fase.</p>
      </aside>

      <section className="place" aria-label={place.name}>
        <header className="place-head">
          <i className="place-dot on" />
          <h2>{place.name}</h2>
          <span className="place-chip">{place.kind}</span>
          <div className="place-actions">
            <button className="secondary-button" onClick={load}>
              <RefreshCw size={14} />
              Atualizar a lista
            </button>
            <button className="secondary-button" onClick={() => call('placeOpen')}>
              <FolderOpen size={14} />
              Abrir a pasta
            </button>
          </div>
        </header>

        <div className="place-boxes">
          <div className="place-box">
            <h4>EXECUTOR</h4>
            <div className="place-big">{place.runner.installed?.version || '—'}</div>
            {!place.runner.installed ? (
              <small>Entra na pasta com o primeiro agent.</small>
            ) : place.runner.outdated ? (
              <>
                <small className="place-warn">Este VeSTA ({place.runner.latest.version}) tem um executor novo.</small>
                <button className="primary-button small" onClick={() => setDrawer({ kind: 'runner' })}>
                  Atualizar o executor
                </button>
              </>
            ) : (
              <small>Em dia com este VeSTA.</small>
            )}
          </div>
          <div className="place-box">
            <h4>IAS NESTE LUGAR</h4>
            <div className="place-ais">
              {AI_IDS.map((id) => (
                <div key={id} className={'place-ai' + (place.ais[id].installed ? '' : ' no')}>
                  <span>{place.ais[id].installed ? '✓' : '—'}</span>
                  {PROVIDERS[id]?.name || id}
                  <small>
                    {!place.ais[id].installed
                      ? 'não instalada (tela Conexões)'
                      : place.ais[id].authenticated === false
                        ? 'sem login'
                        : 'pronta'}
                  </small>
                </div>
              ))}
            </div>
          </div>
          <div className="place-box">
            <h4>
              PASTA PADRÃO
              <button
                className="secondary-button small"
                onClick={() => navigator.clipboard?.writeText(place.home).then(() => notify('Caminho copiado'))}
              >
                <Copy size={12} />
                Copiar
              </button>
            </h4>
            <code className="place-path">{place.home}</code>
            <h4>PARA MEXER SEM O VESTA</h4>
            <div className="place-cmds">
              {place.commands.map((c) => (
                <code key={c}>{c}</code>
              ))}
            </div>
          </div>
        </div>

        <div className="place-section">
          <h3>AGENTS INSTALADOS AQUI · {place.agents.length}</h3>
          <button className="primary-button" onClick={() => setInstalling(true)}>
            <Download size={15} />
            Instalar agents aqui
          </button>
        </div>
        {place.agents.length ? (
          <table className="place-table">
            <thead>
              <tr>
                <th>AGENT · AGENDADOR</th>
                <th>IA</th>
                <th>QUANDO</th>
                <th>ÚLTIMA EXECUÇÃO</th>
                <th>VERSÃO</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {place.agents.map((x) => {
                const a = agentOf(x);
                const err = x.last?.status === 'error';
                return (
                  <tr
                    key={x.slug}
                    data-slug={x.slug}
                    className={(err ? 'err' : '') + (hover === x.slug ? ' hl' : '')}
                    onMouseEnter={() => setHover(x.slug)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <td>
                      <button className="place-agent" onClick={() => a && onOpenAgent(a.id)}>
                        {x.name}
                      </button>
                      <code>{x.task || 'sem agendamento: só quando você pedir'}</code>
                    </td>
                    <td>
                      <span className="place-who">
                        <ProviderIcon id={x.provider} small />
                        {PROVIDERS[x.provider]?.name}
                      </span>
                    </td>
                    <td>
                      {describeSchedule(x.schedule)}
                      {x.next && <small>próxima {untilLabel(x.next, now)}</small>}
                    </td>
                    <td>
                      {x.running ? (
                        <span className="place-running">■ rodando · começou {agoLabel(x.running.at, now)}</span>
                      ) : x.last ? (
                        <>
                          {err ? <span className="place-bad">✕ falhou</span> : <span className="place-ok">✓ ok</span>}
                          <small>{agoLabel(x.last.at, now)}</small>
                          <p>{err ? x.last.error : x.last.summary || 'Terminou sem resumo.'}</p>
                        </>
                      ) : (
                        <small>Ainda não rodou.</small>
                      )}
                    </td>
                    <td>
                      {x.outdated ? (
                        <span className="place-flag">o VeSTA tem uma versão nova</span>
                      ) : (
                        <small>em dia</small>
                      )}
                      <small>instalado {agoLabel(x.updatedAt, now)}</small>
                    </td>
                    <td>
                      <div className="place-row-actions">
                        {x.outdated && a && (
                          <button className="primary-button small" onClick={() => setDrawer({ kind: 'update', x, a })}>
                            Atualizar
                          </button>
                        )}
                        <button
                          className="secondary-button small"
                          disabled={!!x.running || !a}
                          onClick={() => act('placeRun', { agentId: a.id }, x.name + ' começou neste PC')}
                        >
                          Rodar agora
                        </button>
                        <button
                          className="secondary-button small"
                          onClick={() => a && setDrawer({ kind: 'runs', x, a })}
                        >
                          Execuções
                        </button>
                        <button
                          className="secondary-button small ghost-danger"
                          disabled={!!x.running || !a}
                          onClick={() => setDrawer({ kind: 'remove', x, a })}
                        >
                          Remover
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="place-empty">
            Nenhum agent aqui ainda. Instale um para ele rodar pelo agendador do Windows, com o VeSTA fechado.
          </div>
        )}

        <div className="place-section">
          <h3>A PASTA · PASSE O MOUSE NUM AGENT</h3>
        </div>
        <pre className="place-tree">
          {folderTree(place).map(([key, line, note], i) => (
            <span key={i} className={key && key === hover ? 'hl' : ''}>
              {line}
              {note && <em>{'  # ' + note}</em>}
              {'\n'}
            </span>
          ))}
        </pre>
      </section>

      {installing && (
        <InstallModal
          place={place}
          agents={data.agents || []}
          call={call}
          onDone={(r, ok) => {
            apply(r);
            setInstalling(false);
            if (ok) notify(ok + ' agent' + (ok > 1 ? 's' : '') + ' instalado' + (ok > 1 ? 's' : '') + ' neste PC');
          }}
          onClose={() => setInstalling(false)}
        />
      )}
      {drawer && (
        <PlaceDrawer
          drawer={drawer}
          place={place}
          call={call}
          act={act}
          onClose={() => setDrawer(null)}
          onOpenAgent={onOpenAgent}
        />
      )}
    </div>
  );
}
