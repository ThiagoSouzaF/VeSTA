import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ProviderIcon } from '../../../src/components/ProviderIcon';
import { PROVIDERS } from '../../../src/lib/constants';
import { USAGE_PROVIDERS, windowPercent } from '../../../src/lib/usageView';
import { fmtCost, fmtTokens, formatReset } from '../../../src/lib/format';
import { useNow } from '../../../src/hooks/useNow';

function Bar({ w, now }) {
  const pct = windowPercent(w, now);
  return (
    <div className={'usage-bar-card ' + (pct >= 90 ? 'hot' : pct >= 70 ? 'warm' : '')}>
      <div className="usage-bar-head">
        <strong>{w.label}</strong>
        <span>{w.utilization == null ? '—' : Math.round(w.utilization * 100) + '%'}</span>
      </div>
      <div className="usage-track">
        <div className="usage-fill" style={{ width: (pct || 0) + '%' }} />
      </div>
      <small>{formatReset(w.resetsAt, now)}</small>
    </div>
  );
}
export function UsageScreen({ call }) {
  const [info, setInfo] = useState(null),
    [reading, setReading] = useState(false),
    [error, setError] = useState(''),
    now = useNow(true, 30000);
  const refresh = (force = false) => {
    setReading(true);
    return call('refreshUsage', { force })
      .then((r) => {
        setInfo(r);
        setError('');
      })
      .catch((e) => setError(e.message))
      .finally(() => setReading(false));
  };
  useEffect(() => {
    refresh();
  }, []);
  return (
    <>
      <div className="section-head">
        <h2>Uso das suas IAs</h2>
        <button className="btn small" disabled={reading} onClick={() => refresh(true)}>
          <RefreshCw size={14} className={reading ? 'spin' : ''} /> Atualizar
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {USAGE_PROVIDERS.order.map((id) => {
        const rate = info?.rateLimit?.[id],
          p = info?.byProvider?.[id],
          windows = rate?.windows || [];
        if (!windows.length && !(p && (p.week.turns || p.today.turns))) return null;
        return (
          <section className="usage-card" key={id} data-provider={id}>
            <header>
              <ProviderIcon id={id} small />
              <strong>{PROVIDERS[id].name}</strong>
              {rate?.planType && <span className="badge">Plano {rate.planType}</span>}
            </header>
            {windows.map((w) => (
              <Bar key={w.id} w={w} now={now} />
            ))}
            {p && (
              <dl className="totals">
                <dt>Hoje</dt>
                <dd>
                  {fmtTokens(p.today.inputTokens + p.today.outputTokens)} tokens ·{' '}
                  {p.hasCost ? fmtCost(p.today.costUsd) : 'sem custo'}
                </dd>
                <dt>7 dias</dt>
                <dd>
                  {fmtTokens(p.week.inputTokens + p.week.outputTokens)} tokens ·{' '}
                  {p.hasCost ? fmtCost(p.week.costUsd) : 'sem custo'}
                </dd>
              </dl>
            )}
          </section>
        );
      })}
      {info && !Object.keys(info.byProvider || {}).length && (
        <p className="muted center">Nenhum uso registrado ainda.</p>
      )}
    </>
  );
}
