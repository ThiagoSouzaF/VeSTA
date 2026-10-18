import { X, Check, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
const PERMISSION_STATUS = {
  allowed: 'Permitido',
  always: 'Permitido e lembrado nesta conversa',
  auto: 'Permitido pela regra desta conversa',
  denied: 'Negado',
  expired: 'Expirou sem resposta',
  cancelled: 'Cancelado',
};
// Requests from the agent or one of its subagents; pending ones wait for a click here.
export function Permissions({ permissions, providerName, onAnswer }) {
  if (!permissions?.length) return null;
  return (
    <div className="permissions">
      {permissions.map((p) =>
        p.status === 'pending' ? (
          <div className="permission-card" role="alert" key={p.id}>
            <div className="permission-head">
              <ShieldAlert size={17} />
              <div>
                <strong>
                  {p.subagent ? (
                    <>
                      Subagente <em>{p.subagent}</em> pede permissão
                    </>
                  ) : (
                    <>{providerName} pede permissão</>
                  )}
                </strong>
                <span>{p.title}</span>
              </div>
            </div>
            {p.command && <pre className="permission-command">{p.command}</pre>}
            {p.detail && <p className="permission-detail">{p.detail}</p>}
            <div className="permission-actions">
              <button className="primary-button" onClick={() => onAnswer(p.id, 'once')}>
                <Check size={14} />
                Permitir
              </button>
              <button
                className="secondary-button"
                title={'Não perguntar de novo nesta conversa para ' + p.rule}
                onClick={() => onAnswer(p.id, 'always')}
              >
                Sempre nesta conversa<small>{p.rule}</small>
              </button>
              <button className="secondary-button deny" onClick={() => onAnswer(p.id, 'deny')}>
                <X size={14} />
                Negar
              </button>
            </div>
          </div>
        ) : (
          <div className={'permission-line ' + p.status} key={p.id}>
            {['denied', 'expired', 'cancelled'].includes(p.status) ? <ShieldX size={12} /> : <ShieldCheck size={12} />}
            <span>{PERMISSION_STATUS[p.status] || p.status}</span>
            <code>{p.command || p.title}</code>
            {p.subagent && <small>{p.subagent}</small>}
          </div>
        )
      )}
    </div>
  );
}
