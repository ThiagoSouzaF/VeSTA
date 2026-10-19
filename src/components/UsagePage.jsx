import { formatReset, fmtTokens, fmtCost } from '../lib/format';
import { useState, useEffect } from 'react';
import { useNow } from '../hooks/useNow';
import { RefreshCw } from 'lucide-react';
import { PROVIDERS } from '../lib/constants';
import { ProviderIcon } from './ProviderIcon';
import { windowPercent, USAGE_PROVIDERS } from '../lib/usageView';
import { action } from '../lib/api';
import { Chapter } from './Chapter';

function UsageBar({ window: w, now }) {
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
function Totals({ label, t, showCost }) {
  return (
    <div className="usage-row">
      <span>{label}</span>
      <span>{fmtTokens(t.inputTokens)} entrada</span>
      <span>{fmtTokens(t.outputTokens)} saída</span>
      <span>{fmtTokens(t.cacheTokens)} cache</span>
      {showCost ? <strong>{fmtCost(t.costUsd)}</strong> : <strong className="muted">sem custo</strong>}
    </div>
  );
}
function ProviderSection({ id, info, rate, now, error }) {
  const meta = USAGE_PROVIDERS[id],
    windows = rate?.windows || [],
    used = info && (info.week.turns > 0 || info.today.turns > 0);
  return (
    <section className="usage-provider" data-provider={id}>
      <div className="usage-provider-head">
        <ProviderIcon id={id} />
        <div>
          <h2>{PROVIDERS[id].name}</h2>
          <small>{PROVIDERS[id].engine}</small>
        </div>
        {rate?.planType && <span className="usage-chip">Plano {rate.planType}</span>}
        {rate?.credits?.hasCredits && !rate.credits.unlimited && rate.credits.balance != null && (
          <span className="usage-chip">Créditos: {rate.credits.balance}</span>
        )}
      </div>
      {meta.windows ? (
        <>
          {windows.length ? (
            <div className="usage-bars">
              {windows.map((w) => (
                <UsageBar key={w.id} window={w} now={now} />
              ))}
            </div>
          ) : (
            <p className="muted usage-empty">Sem leitura das janelas ainda.</p>
          )}
          <small className="usage-source">
            {meta.windows}{' '}
            {rate?.updatedAt ? 'Última leitura: ' + new Date(rate.updatedAt).toLocaleString('pt-BR') + '.' : ''}
            {error ? ' Não foi possível ler agora: ' + error : ''}
          </small>
        </>
      ) : (
        <p className="muted usage-empty">Esta IA não informa janelas de limite; só tokens e custo são contados.</p>
      )}
      {used ? (
        <div className="usage-totals">
          <Totals label="Hoje" t={info.today} showCost={info.hasCost} />
          <Totals label="Últimos 7 dias" t={info.week} showCost={info.hasCost} />
        </div>
      ) : (
        <p className="muted usage-empty">Nenhum uso registrado nos últimos 7 dias.</p>
      )}
    </section>
  );
}
export function UsagePage({ call, usage }) {
  const [info, setInfo] = useState(null),
    [reading, setReading] = useState(false),
    [errors, setErrors] = useState({}),
    now = useNow(true, 30000);
  const refresh = (force = false) => {
    setReading(true);
    return call('refreshUsage', { force })
      .then((r) => {
        setInfo(r);
        setErrors(r.refreshError || {});
      })
      .catch(() => {})
      .finally(() => setReading(false));
  };
  // Opening the tab asks the CLIs that can report their windows (Codex) without needing a chat turn.
  useEffect(() => {
    refresh();
  }, []);
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
  return (
    <div className="content-page usage-page">
      <div className="page-heading">
        <div>
          <Chapter n={5} title="USO" />
          <div className="eyebrow">QUANTO JÁ USEI</div>
          <h1>Seu uso, à vista.</h1>
          <p>Janelas do plano, tokens e custo, separados por IA.</p>
        </div>
        <button className="secondary-button" disabled={reading} onClick={action(() => refresh(true))}>
          <RefreshCw size={15} className={reading ? 'spin' : ''} />
          Atualizar
        </button>
      </div>
      {USAGE_PROVIDERS.order.map((id) => (
        <ProviderSection
          key={id}
          id={id}
          info={info?.byProvider?.[id]}
          rate={info?.rateLimit?.[id]}
          now={now}
          error={errors[id]}
        />
      ))}
    </div>
  );
}
