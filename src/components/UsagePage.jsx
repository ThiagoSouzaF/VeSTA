import { formatReset, fmtTokens, fmtCost } from '../lib/format';
import { useState, useEffect } from 'react';
import { useNow } from '../hooks/useNow';
import { AlertCircle } from 'lucide-react';
import { PROVIDERS } from '../lib/constants';
function UsageBar({ title, window: w, now }) {
  const pct = w?.utilization == null ? null : Math.round(w.utilization * 100),
    stale = w?.resetsAt && w.resetsAt <= now;
  return (
    <div className={'usage-bar-card ' + (pct >= 90 ? 'hot' : pct >= 70 ? 'warm' : '')}>
      <div className="usage-bar-head">
        <strong>{title}</strong>
        <span>{pct == null ? '—' : pct + '%'}</span>
      </div>
      <div className="usage-track">
        <div className="usage-fill" style={{ width: (stale ? 0 : pct || 0) + '%' }} />
      </div>
      <small>{w ? formatReset(w.resetsAt, now) : 'Sem dados ainda'}</small>
    </div>
  );
}
export function UsagePage({ call, usage }) {
  const [info, setInfo] = useState(null),
    now = useNow(true, 30000);
  useEffect(() => {
    let alive = true;
    call('usage')
      .then((r) => {
        if (alive) setInfo(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [usage]);
  const rl = info?.rateLimit || {},
    sum = (o) =>
      Object.values(o || {}).reduce(
        (a, p) => ({
          inputTokens: a.inputTokens + p.inputTokens,
          outputTokens: a.outputTokens + p.outputTokens,
          cacheTokens: a.cacheTokens + p.cacheTokens,
          costUsd: a.costUsd + p.costUsd,
        }),
        { inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsd: 0 }
      );
  const row = (key, name, p) => (
    <div className="usage-row" key={key}>
      <span>{name}</span>
      <span>{fmtTokens(p.inputTokens)} entrada</span>
      <span>{fmtTokens(p.outputTokens)} saída</span>
      <span>{fmtTokens(p.cacheTokens)} cache</span>
      <strong>{fmtCost(p.costUsd)}</strong>
    </div>
  );
  const today = Object.entries(info?.today || {});
  return (
    <div className="content-page usage-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">QUANTO JÁ USEI</div>
          <h1>Seu uso, à vista.</h1>
          <p>Janelas do plano Claude e gasto acumulado por IA.</p>
        </div>
      </div>
      <div className="usage-bars">
        <UsageBar title="Janela de 5 horas" window={rl.fiveHour} now={now} />
        <UsageBar title="Janela semanal" window={rl.sevenDay} now={now} />
      </div>
      <div className="info-card usage-note">
        <AlertCircle size={20} />
        <div>
          <p>
            Os dados de janela só atualizam depois que você envia uma mensagem pelo Claude.{' '}
            {rl.updatedAt
              ? 'Última atualização: ' + new Date(rl.updatedAt).toLocaleString('pt-BR') + '.'
              : 'Ainda não há leitura.'}
          </p>
        </div>
      </div>
      <section className="usage-section">
        <div className="context-label">HOJE</div>
        {today.length ? (
          today.map(([id, p]) => row(id, PROVIDERS[id]?.name || id, p))
        ) : (
          <p className="muted">Nenhum uso registrado hoje.</p>
        )}
      </section>
      <section className="usage-section">
        <div className="context-label">ÚLTIMOS DIAS</div>
        {info?.days?.length ? (
          info.days.map((d) => (
            <div className="usage-day" key={d.date}>
              <div className="usage-day-head">
                <strong>{d.date.split('-').reverse().join('/')}</strong>
                <span>{fmtCost(sum(d.providers).costUsd)}</span>
              </div>
              {Object.entries(d.providers).map(([id, p]) => row(d.date + id, PROVIDERS[id]?.name || id, p))}
            </div>
          ))
        ) : (
          <p className="muted">Sem histórico ainda.</p>
        )}
      </section>
      <p className="fine-print">Custo do ChatGPT (Codex) não é informado pelo CLI; apenas tokens são somados.</p>
    </div>
  );
}
