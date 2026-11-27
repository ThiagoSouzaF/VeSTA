// The side drawer of a place: an agent's runs there (read from its folder), updating or removing it, updating the
// place's runner, connecting a VPS and forgetting one. Each change says what VeSTA will do before the person confirms.
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { agoLabel, duration } from '../../lib/agents';
import { fmtTokens } from '../../lib/tokens';
import { ConnectForm } from './ConnectForm';

export function PlaceDrawer({ drawer, place, call, act, onClose, onOpenAgent, onConnected, onForgotten }) {
  const { kind, x, a } = drawer;
  const [runs, setRuns] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (kind !== 'runs') return;
    call('placeRuns', { agentId: a.id, placeId: place.id })
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [kind, a, call, place.id]);
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy, onClose]);
  const confirm = async (method, args, message, then = onClose) => {
    setBusy(true);
    const r = await act(method, { placeId: place.id, ...args }, message);
    setBusy(false);
    if (r) then(r);
  };
  const win = place.home.includes('\\');
  const folder = x && place.home + (win ? '\\agents\\' : '/agents/') + x.slug;
  const where = place.remote ? 'Em ' + place.name : 'Neste PC';
  const inPlace = place.remote ? 'em ' + place.name : 'neste PC';
  const head = {
    runs: ['Execuções de ' + x?.name, where + ' · lidas de ' + folder + (win ? '\\runs' : '/runs')],
    update: ['Atualizar ' + x?.name, where + ': troca o pedido, as lições e as skills pela versão de agora do VeSTA.'],
    remove: [
      'Remover ' + x?.name,
      (place.remote ? 'De ' + place.name : 'Deste PC') +
        '. O agent continua no VeSTA e volta a rodar com o VeSTA aberto, se não estiver em outro lugar.',
    ],
    runner: [
      'Atualizar o executor',
      where + ': ' + (place.runner.installed?.version || '—') + ' → ' + place.runner.latest.version,
    ],
    connect: ['Conectar uma VPS', 'Por SSH, com as chaves que você já usa (~/.ssh). O VeSTA não guarda senha.'],
    forget: [
      'Esquecer ' + place.name,
      'O VeSTA para de ler este lugar. Os agents dele voltam a rodar com o VeSTA aberto.',
    ],
  }[kind];
  const mine = (place.agents || []).filter((y) => y.agentId);

  return (
    <>
      <div className="skill-drawer-scrim" onClick={() => !busy && onClose()} />
      <aside className="agent-drawer place-drawer" aria-label={head[0]}>
        <div className="agent-drawer-head">
          <div>
            <h2>{head[0]}</h2>
            <p>{head[1]}</p>
          </div>
          <button className="icon-button" aria-label="Fechar" onClick={onClose} disabled={busy}>
            <X size={16} />
          </button>
        </div>

        {kind === 'runs' &&
          (runs === null ? (
            <p className="muted">Lendo…</p>
          ) : !runs.length ? (
            <p className="muted">Ainda não rodou {inPlace}.</p>
          ) : (
            <>
              <p className="pd-note">
                As lições que ele escreveu aqui já foram para o diário do agent e esperam o seu sim em{' '}
                <button className="text-button" onClick={() => onOpenAgent(a.id)}>
                  {a.name} → Aprendeu
                </button>
                .
              </p>
              <ol className="pd-runs">
                {runs.map((r) => (
                  <li key={r.id} className={r.status === 'error' ? 'err' : ''}>
                    <div className="pd-run-top">
                      <span>{agoLabel(r.at, Date.now())}</span>
                      <span>{duration(r)}</span>
                      {r.usage && <span>{fmtTokens(r.usage.input + r.usage.cached + r.usage.output)} tokens</span>}
                      <span>{r.trigger === 'manual' ? 'você pediu' : 'agenda'}</span>
                      {r.status === 'error' ? <b className="place-bad">✕ falhou</b> : <b className="place-ok">✓ ok</b>}
                    </div>
                    <p>{r.status === 'error' ? r.error : r.summary || 'Terminou sem resumo.'}</p>
                    {r.text && (
                      <details>
                        <summary>Resposta inteira</summary>
                        <pre>{r.text}</pre>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            </>
          ))}

        {kind === 'update' && (
          <>
            <Steps
              list={[
                ['Trazer as execuções que ainda não estão no diário', ''],
                ['Reescrever agent.json e skills/', folder],
                ['Refazer a tarefa do agendador', x.task || 'sem tarefa: roda quando você pedir'],
              ]}
            />
            <p className="pd-note">As execuções e a pasta work/ ficam como estão.</p>
            <div className="pd-foot">
              <button className="secondary-button" onClick={onClose} disabled={busy}>
                Cancelar
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => confirm('placeUpdate', { agentId: a.id }, x.name + ' atualizado ' + inPlace)}
              >
                {busy ? 'Atualizando…' : 'Atualizar'}
              </button>
            </div>
          </>
        )}

        {kind === 'remove' && (
          <>
            <Steps
              list={[
                ['Trazer as execuções que ainda não estão no diário', ''],
                ['Apagar a tarefa do agendador', x.task || 'não tem'],
                ['Apagar a pasta do agent', folder],
              ]}
            />
            <div className="pd-foot">
              <button className="secondary-button" onClick={onClose} disabled={busy}>
                Cancelar
              </button>
              <button
                className="primary-button danger"
                disabled={busy}
                onClick={() =>
                  confirm(
                    'placeRemove',
                    { agentId: a.id },
                    x.name + ' removido ' + (place.remote ? 'de ' + place.name : 'deste PC')
                  )
                }
              >
                {busy ? 'Removendo…' : 'Remover'}
              </button>
            </div>
          </>
        )}

        {kind === 'runner' && (
          <>
            <Steps
              list={[
                [
                  place.remote ? 'Enviar o executor novo por SSH' : 'Copiar o executor novo para a pasta',
                  place.home + (win ? '\\runner' : '/runner'),
                ],
                ['Os agents e as tarefas ficam como estão', ''],
              ]}
            />
            <p className="pd-note">Quem estiver rodando agora termina com o executor antigo.</p>
            <div className="pd-foot">
              <button className="secondary-button" onClick={onClose} disabled={busy}>
                Cancelar
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => confirm('placeRunner', {}, 'Executor atualizado')}
              >
                Atualizar
              </button>
            </div>
          </>
        )}

        {kind === 'connect' && (
          <ConnectForm act={act} busy={busy} setBusy={setBusy} onClose={onClose} onConnected={onConnected} />
        )}

        {kind === 'forget' && (
          <>
            <Steps
              list={[
                ['Trazer as execuções que ainda não estão no diário', ''],
                ...(mine.length
                  ? [['Remover os agents de lá: ' + mine.map((y) => y.name).join(', '), place.address]]
                  : []),
                ['Tirar ' + place.name + ' da lista de lugares', ''],
              ]}
            />
            <p className="pd-note">
              A pasta do executor fica no servidor. Para apagar também: <code>rm -rf {place.home}</code>
            </p>
            <div className="pd-foot">
              <button className="secondary-button" onClick={onClose} disabled={busy}>
                Cancelar
              </button>
              <button
                className="primary-button danger"
                disabled={busy}
                onClick={() => confirm('placeForget', {}, place.name + ' esquecida', (r) => onForgotten(r))}
              >
                {busy ? 'Esquecendo…' : 'Esquecer'}
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function Steps({ list }) {
  return (
    <ol className="pi-steps plan">
      {list.map(([text, code], i) => (
        <li key={text}>
          <span>{i + 1}</span>
          <div>
            {text}
            {code && <code>{code}</code>}
          </div>
        </li>
      ))}
    </ol>
  );
}
