import { formatReset, fmtTokens, fmtCost } from '../lib/format';
import { useState, useEffect } from 'react';
import { useNow } from '../hooks/useNow';
import { RefreshCw } from 'lucide-react';
import { PROVIDERS } from '../lib/constants';
import { ProviderIcon } from './ProviderIcon';
import { windowPercent, USAGE_PROVIDERS } from '../lib/usageView';
import { action } from '../lib/api';
import { Chapter } from './Chapter';
import { totalTokens } from '../lib/tokens';
import { CountUp } from './bits/CountUp';

function UsageBar({ window: w, now }) {
  const pct = windowPercent(w, now);
  return (
    <div className={'usage-bar-card ' + (pct >= 90 ? 'hot' : pct >= 70 ? 'warm' : '')}>
      <div className="usage-bar-head">
        <strong>{w.label}</strong>
        <span>
          {w.utilization == null ? (
            '—'
          ) : (
            <>
              <CountUp to={Math.round(w.utilization * 100)} />%
            </>
          )}
        </span>
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
      <strong data-total>{fmtTokens(totalTokens(t))} tokens</strong>
      <span>{fmtTokens(t.inputTokens)} entrada nova</span>
      <span>{fmtTokens(t.cacheTokens)} do cache</span>
      <span>{fmtTokens(t.outputTokens)} saída</span>
      <span>{t.turns === 1 ? '1 resposta' : t.turns + ' respostas'}</span>
      {showCost ? (
        <strong title="Preço de tabela da API, calculado pela própria IA; numa assinatura, não é o que você paga">
          {fmtCost(t.costUsd)} na API
        </strong>
      ) : (
        <strong className="muted">sem custo</strong>
      )}
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
          <Chapter n={6} title="USO" />
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
      <p className="usage-note">
        Contam todas as respostas, inclusive as que o VeSTA pede sozinho (agents, revisões do refino, consolidação da
        memória, adaptação de skills). <strong>Entrada nova</strong> é o que a IA leu pela primeira vez;{' '}
        <strong>do cache</strong> é o contexto que ela já tinha lido (o histórico, as instruções) e reaproveita: conta
        como entrada, mas custa bem menos. <strong>Saída</strong> inclui o raciocínio. O valor <strong>na API</strong> é
        o preço de tabela que a própria IA calcula; numa assinatura (Claude Pro/Max, ChatGPT), você não paga por
        mensagem, e o que vale são as janelas acima. Cada conversa mostra os tokens dela no cabeçalho e em cada
        resposta.
      </p>
    </div>
  );
}
