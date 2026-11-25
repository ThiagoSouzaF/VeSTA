// Tokens of the conversation, in the chat heading: the total, and opened, the parts (fresh input, cache, output, API
// price) and how many answers were counted.
import { Coins } from 'lucide-react';
import { chatTokens, tokenParts, tokensLabel } from '../lib/tokens';

export function ChatTokens({ chat }) {
  const t = chatTokens(chat);
  if (!t.counted) return null;
  const missing = t.answers - t.counted;
  return (
    <details className="chat-tokens">
      <summary aria-label={'Tokens desta conversa: ' + tokensLabel(t)}>
        <Coins size={12} />
        {tokensLabel(t)}
      </summary>
      <div className="chat-tokens-panel" role="group" aria-label="Tokens desta conversa">
        <dl>
          {tokenParts(t).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p>
          {t.counted === 1 ? '1 resposta contada' : t.counted + ' respostas contadas'}
          {missing > 0 ? ' (' + missing + ' de antes da contagem por conversa ficam de fora)' : ''}. O cache é contexto
          que a IA já tinha lido e reaproveita; conta como entrada, mas custa menos.
          {t.costUsd > 0
            ? ' O preço na API é o que a IA calcula pela tabela dela; numa assinatura, não é cobrado assim.'
            : ''}
        </p>
      </div>
    </details>
  );
}
