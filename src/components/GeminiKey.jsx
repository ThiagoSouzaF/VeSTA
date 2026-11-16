import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { action } from '../lib/api';
import { ExternalLink } from './ExternalLink';

// The Gemini API key, in the Gemini card of Conexões. The key goes to the main process, which seals it on this
// computer; the interface only learns whether one is saved (`keySaved`) and never shows it back.
export function GeminiKey({ integration, call, setIntegrations, notify }) {
  const [key, setKey] = useState('');
  const saved = !!integration?.keySaved;
  return (
    <div className="gemini-key">
      <span>CHAVE DO GOOGLE AI STUDIO</span>
      <p>
        O Google não aceita mais o login pessoal do Google no Gemini CLI. Crie uma chave gratuita em{' '}
        <ExternalLink href="https://aistudio.google.com/apikey" call={call}>
          aistudio.google.com/apikey
        </ExternalLink>{' '}
        e cole aqui. Ela fica guardada só neste computador, protegida pelo Windows.
      </p>
      {saved ? (
        <div className="gemini-key-row">
          <span className="gemini-key-saved">
            <KeyRound size={13} /> Chave salva neste computador
          </span>
          <button
            className="text-button"
            onClick={action(async () => {
              setIntegrations(await call('removeGeminiKey'));
              notify('Chave do Gemini removida');
            })}
          >
            Remover
          </button>
        </div>
      ) : (
        <form
          className="gemini-key-row"
          onSubmit={(e) => {
            e.preventDefault();
            action(async () => {
              setIntegrations(await call('saveGeminiKey', { key }));
              setKey('');
              notify('Chave do Gemini salva');
            })();
          }}
        >
          <input
            aria-label="Chave do Gemini"
            placeholder="Cole a chave (AIza…)"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button className="secondary-button" type="submit" disabled={!key.trim()}>
            Salvar
          </button>
        </form>
      )}
    </div>
  );
}
