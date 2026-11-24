// The test of a skill proposal (refine/trial.cjs): while it runs, the step; then who won each request (the judge did
// not know which answer was which) and how often the description makes the AI pick the skill when it should.
import { PROVIDERS } from '../../lib/constants';

const WINNER = { proposta: 'proposta', atual: 'versão em uso', empate: 'empate' };

export function verdict(test) {
  const w = test.wins || { proposta: 0, atual: 0, empate: 0 };
  const n = w.proposta + w.atual + w.empate;
  if (!n) return '';
  if (w.proposta > w.atual) return 'A proposta saiu melhor em ' + w.proposta + ' de ' + n;
  if (w.atual > w.proposta) return 'A versão em uso saiu melhor em ' + w.atual + ' de ' + n;
  return 'Empate entre as duas versões (' + n + ' pedidos)';
}

export function TrialResult({ test }) {
  if (test.status === 'running')
    return (
      <p className="refine-trial running" data-trial="running" aria-live="polite">
        Testando com {PROVIDERS[test.provider]?.name || 'a IA'}: {test.step || 'começando'}…
      </p>
    );
  if (test.status === 'error')
    return (
      <p className="refine-trial error" data-trial="error">
        O teste falhou: {test.error}
      </p>
    );
  const t = test.triggers;
  const missed = (t?.misses || []).filter((m) => !m.proposta);
  return (
    <div className="refine-trial" data-trial="done">
      <b>{verdict(test)}.</b>
      <ol>
        {(test.cases || []).map((c, i) => (
          <li key={i} data-winner={c.winner}>
            <span className="refine-trial-ask">{c.pedido}</span>
            <span className={'refine-trial-win ' + c.winner}>{WINNER[c.winner]}</span>
            {c.motivo && <small>{c.motivo}</small>}
          </li>
        ))}
      </ol>
      {t && (
        <p className="refine-trial-triggers" data-triggers={t.proposta + '/' + t.total}>
          Descrição: a IA escolheria a skill certo em{' '}
          {t.same ? (
            <b>
              {t.atual} de {t.total}
            </b>
          ) : (
            <>
              <b>
                {t.atual} de {t.total}
              </b>{' '}
              pedidos com a descrição em uso e{' '}
              <b>
                {t.proposta} de {t.total}
              </b>{' '}
              com a proposta
            </>
          )}
          {t.same ? ' pedidos (a proposta não muda a descrição)' : ''}.
          {missed.length > 0 && (
            <span className="refine-trial-misses">
              {' '}
              {t.same ? 'Errou' : 'Com a proposta, errou'}:{' '}
              {missed.map((m) => '"' + m.pedido + '" (' + (m.deve ? 'devia usar' : 'não devia usar') + ')').join('; ')}.
            </span>
          )}
        </p>
      )}
    </div>
  );
}
