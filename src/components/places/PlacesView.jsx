// Onde rodam: the places where agents run with VeSTA closed — this PC and each VPS reached by SSH. Two views:
// Lugares (one place at a time: its runner, its AIs, the standard folder with the commands to use it by hand, the agents
// installed there and the folder as a tree) and Mapa (every place side by side, with the teams and the wires).
// Everything comes from the main process (electron/places); this screen only calls its methods.
import { useEffect, useState } from 'react';
import { Copy, Download, FolderOpen, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { PROVIDERS } from '../../lib/constants';
import { ProviderIcon } from '../ProviderIcon';
import { TabInk } from '../TabInk';
import { agoLabel, describeSchedule, untilLabel } from '../../lib/agents';
import { folderTree } from '../../lib/places';
import { InstallModal } from './InstallModal';
import { PlaceDrawer } from './PlaceDrawer';
import { PlacesMap } from './PlacesMap';
import { Switch } from '../skills/SkillBits';

const AI_IDS = ['claude', 'codex', 'opencode', 'drael'];

export function PlacesView({ data, call, setData, notify, onOpenAgent }) {
  const [view, setView] = useState(null);
  const [mode, setMode] = useState('list');
  const [current, setCurrent] = useState('pc');
  const [installing, setInstalling] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const [hover, setHover] = useState(null);
  const [reading, setReading] = useState(false);
  const apply = (r) => {
    if (r?.places) setView(r);
    if (r?.state) setData(r.state);
    return r;
  };
  const load = () =>
    call('placesView')
      .then(apply)
      .catch(() => {});
  // The places are read again while the screen is open: a run that ends shows up by itself (a VPS on its own pace).
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, []);
  const act = async (method, args, message) => {
    try {
      const r = apply(await call(method, args));
      if (message) notify(message);
      return r || true;
    } catch {
      return false;
    }
  };
  if (!view) return <div className="places-loading">Lendo os lugares…</div>;
  const place = view.places.find((p) => p.id === current) || view.places[0];
  const here = { placeId: place.id };
  const off = !place.online;
  const agentOf = (x) => (data.agents || []).find((a) => a.id === x.agentId);
  const now = Date.now();
  // Changes going by themselves (one switch for every place) and "Atualizar todos".
  const auto = view.places[0]?.auto !== false;
  const pending = view.places
    .filter((p) => p.online)
    .reduce((n, p) => n + p.agents.filter((x) => x.outdated).length, 0);
  const updateAll = async () => {
    const r = await act('placeUpdateAll', {});
    if (r?.updated != null)
      notify(
        r.updated +
          ' atualizado' +
          (r.updated === 1 ? '' : 's') +
          (r.failed ? ' · ' + r.failed + ' não deu (veja o lugar)' : '')
      );
  };
  const refresh = async () => {
    setReading(true);
    await act('placeRefresh', here, place.remote ? place.name + ' lida agora' : null);
    setReading(false);
  };

  return (
    <div className="places-wrap">
      <div className="places-modes tab-ink-host" role="tablist" aria-label="Lugares ou mapa">
        {[
          ['list', 'Lugares', 'um de cada vez'],
          ['map', 'Mapa', 'equipes por lugar'],
        ].map(([id, label, sub]) => (
          <button key={id} role="tab" aria-selected={mode === id} data-mode={id} onClick={() => setMode(id)}>
            {label}
            <small>{sub}</small>
          </button>
        ))}
        <TabInk active="[aria-selected='true']" value={mode} />
      </div>

      {mode === 'map' ? (
        <PlacesMap
          places={view.places}
          data={data}
          onOpenPlace={(id) => {
            setCurrent(id);
            setMode('list');
          }}
        />
      ) : (
        <div className="places">
          <aside className="places-list" aria-label="Lugares">
            <h3>LUGARES</h3>
            {view.places.map((p) => (
              <PlacePick key={p.id} p={p} active={p.id === place.id} onPick={() => setCurrent(p.id)} />
            ))}
            <button className="place-add" onClick={() => setDrawer({ kind: 'connect' })}>
              <Plus size={14} />
              Conectar uma VPS
            </button>
            <div className="places-auto" data-auto={auto ? 'on' : 'off'}>
              <span>
                <b>Levar mudanças sozinho</b>
                <small>
                  {auto
                    ? 'Mudou o pedido, as lições ou as skills de um agent: os lugares dele recebem na próxima leitura (uma VPS fora do ar, quando voltar).'
                    : 'As mudanças esperam você clicar em Atualizar em cada lugar.'}
                </small>
              </span>
              <Switch
                on={auto}
                label="Levar mudanças sozinho"
                onChange={(on) =>
                  act(
                    'placeAuto',
                    { on },
                    on ? 'As mudanças vão sozinhas para os lugares' : 'As mudanças esperam o Atualizar'
                  )
                }
              />
            </div>
            {pending > 0 && (
              <button className="secondary-button place-all" onClick={updateAll}>
                <RefreshCw size={13} />
                Atualizar todos ({pending})
              </button>
            )}
          </aside>

          <section className="place" aria-label={place.name} data-place={place.id}>
            <header className="place-head">
              <i className={'place-dot ' + (off ? 'off' : 'on')} />
              <h2>{place.name}</h2>
              <span className="place-chip">{place.kind}</span>
              {place.remote && <span className="place-chip mono">{place.host}</span>}
              <div className="place-actions">
                <button className="secondary-button" onClick={refresh} disabled={reading}>
                  <RefreshCw size={14} className={reading ? 'spin' : ''} />
                  {reading ? 'Lendo…' : 'Atualizar a lista'}
                </button>
                {place.remote ? (
                  <button className="secondary-button ghost-danger" onClick={() => setDrawer({ kind: 'forget' })}>
                    <Trash2 size={14} />
                    Esquecer este lugar
                  </button>
                ) : (
                  <button className="secondary-button" onClick={() => call('placeOpen')}>
                    <FolderOpen size={14} />
                    Abrir a pasta
                  </button>
                )}
              </div>
            </header>
            {off && (
              <div className="place-offline" role="status">
                <span className="place-bad">✕ fora do ar</span>
                Sem conexão com {place.host}: {place.error.replace(/\.$/, '')}. A lista abaixo é a última que o VeSTA
                leu{place.readAt ? ', ' + agoLabel(place.readAt, now) : ''}.
              </div>
            )}
            {place.remote && place.scheduler === 'systemd' && place.linger === false && !off && (
              <div className="place-note">
                Sem <code>enable-linger</code>, o systemd para os agents quando você sai do servidor. Rode lá uma vez:{' '}
                <code>sudo loginctl enable-linger {place.host.split('@')[0]}</code>
              </div>
            )}

            <div className="place-boxes">
              <div className="place-box">
                <h4>EXECUTOR</h4>
                <div className="place-big">{place.runner.installed?.version || '—'}</div>
                {!place.runner.installed ? (
                  <small>Entra na pasta com o primeiro agent.</small>
                ) : place.runner.outdated ? (
                  <>
                    <small className="place-warn">
                      Este VeSTA ({place.runner.latest.version}) tem um executor novo.
                    </small>
                    <button
                      className="primary-button small"
                      disabled={off}
                      onClick={() => setDrawer({ kind: 'runner' })}
                    >
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
                  {AI_IDS.map((id) => {
                    const ai = place.ais[id];
                    return (
                      <div key={id} className={'place-ai' + (ai.installed ? '' : ' no')} data-ai={id}>
                        <span>{ai.installed ? '✓' : '—'}</span>
                        {PROVIDERS[id]?.name || id}
                        <small>
                          {ai.note ||
                            (!ai.installed
                              ? place.remote
                                ? 'instale lá e faça o login'
                                : 'não instalada (tela Conexões)'
                              : ai.authenticated === false
                                ? 'sem login'
                                : place.remote
                                  ? 'encontrada'
                                  : 'pronta')}
                        </small>
                      </div>
                    );
                  })}
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
              <button className="primary-button" disabled={off} onClick={() => setInstalling(true)}>
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
                              {err ? (
                                <span className="place-bad">✕ falhou</span>
                              ) : (
                                <span className="place-ok">✓ ok</span>
                              )}
                              <small>{agoLabel(x.last.at, now)}</small>
                              <p>{err ? x.last.error : x.last.summary || 'Terminou sem resumo.'}</p>
                            </>
                          ) : (
                            <small>Ainda não rodou.</small>
                          )}
                        </td>
                        <td>
                          {x.outdated ? (
                            <span className="place-flag">
                              {auto && !off && !a?.places?.[place.id]?.autoError
                                ? 'indo sozinho na próxima leitura'
                                : 'o VeSTA tem uma versão nova'}
                            </span>
                          ) : (
                            <small>em dia</small>
                          )}
                          {x.outdated && a?.places?.[place.id]?.autoError && (
                            <small className="place-warn">{a.places[place.id].autoError}</small>
                          )}
                          <small>instalado {agoLabel(x.updatedAt, now)}</small>
                        </td>
                        <td>
                          <div className="place-row-actions">
                            {x.outdated && a && (
                              <button
                                className="primary-button small"
                                disabled={off}
                                onClick={() => setDrawer({ kind: 'update', x, a })}
                              >
                                Atualizar
                              </button>
                            )}
                            <button
                              className="secondary-button small"
                              disabled={!!x.running || !a || off}
                              onClick={() =>
                                act(
                                  'placeRun',
                                  { ...here, agentId: a.id },
                                  x.name + (place.remote ? ' começou em ' + place.name : ' começou neste PC')
                                )
                              }
                            >
                              Rodar agora
                            </button>
                            <button
                              className="secondary-button small"
                              disabled={!a || off}
                              onClick={() => a && setDrawer({ kind: 'runs', x, a })}
                            >
                              Execuções
                            </button>
                            <button
                              className="secondary-button small ghost-danger"
                              disabled={!!x.running || !a || off}
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
                Nenhum agent aqui ainda.{' '}
                {place.remote
                  ? 'Instale um para ele rodar pelo agendador da VPS, com o VeSTA e o seu PC desligados.'
                  : 'Instale um para ele rodar pelo agendador do Windows, com o VeSTA fechado.'}
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
        </div>
      )}

      {installing && (
        <InstallModal
          place={place}
          agents={data.agents || []}
          call={call}
          onDone={(r, ok) => {
            apply(r);
            setInstalling(false);
            if (ok)
              notify(
                ok +
                  ' agent' +
                  (ok > 1 ? 's' : '') +
                  ' instalado' +
                  (ok > 1 ? 's' : '') +
                  (place.remote ? ' em ' + place.name : ' neste PC')
              );
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
          onConnected={(id) => {
            setCurrent(id);
            setDrawer(null);
          }}
          onForgotten={() => {
            setCurrent('pc');
            setDrawer(null);
          }}
        />
      )}
    </div>
  );
}

function PlacePick({ p, active, onPick }) {
  const failed = p.agents.filter((x) => x.last?.status === 'error').length;
  const outdated = p.agents.filter((x) => x.outdated).length;
  const busy = p.agents.some((x) => x.running);
  return (
    <button className="place-pick" aria-current={active} data-place={p.id} onClick={onPick}>
      <span className="place-row">
        <i className={'place-dot ' + (!p.online ? 'off' : busy ? 'busy' : 'on')} />
        <b>{p.name}</b>
        <span className="place-count">{p.agents.length}</span>
      </span>
      <small>{p.kind}</small>
      {p.remote && <small>{p.online ? 'online · lida ' + agoLabel(p.readAt, Date.now()) : 'fora do ar'}</small>}
      {(failed > 0 || outdated > 0 || p.runner.outdated || !p.online) && (
        <span className="place-row">
          {!p.online && <span className="place-bad">✕ fora do ar</span>}
          {failed > 0 && <span className="place-bad">✕ {failed} falhou</span>}
          {p.runner.outdated && <span className="place-flag">executor antigo</span>}
          {outdated > 0 && (
            <span className="place-flag">
              {outdated} desatualizado{outdated > 1 ? 's' : ''}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
