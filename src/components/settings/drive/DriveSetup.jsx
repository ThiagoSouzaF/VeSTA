import { useState } from 'react';
import { FileJson, ChevronDown } from 'lucide-react';
import { ExternalLink } from '../../ExternalLink';
import { action } from '../../../lib/api';

const LINKS = {
  project: 'https://console.cloud.google.com/projectcreate',
  api: 'https://console.cloud.google.com/apis/library/drive.googleapis.com',
  auth: 'https://console.cloud.google.com/auth/overview',
  audience: 'https://console.cloud.google.com/auth/audience',
  clients: 'https://console.cloud.google.com/auth/clients',
};
// Each step is a list of parts: plain text, { link, text } (opens in the browser) or { strong }.
const STEPS = [
  [{ link: 'project', text: 'Crie um projeto' }, ' chamado VeSTA.'],
  [{ link: 'api', text: 'Ative a Google Drive API' }, ' nesse projeto.'],
  [
    'Em ',
    { link: 'auth', text: 'Google Auth Platform' },
    ', clique em Começar: nome do app “VeSTA”, seu e-mail, público ',
    { strong: 'Externo' },
    '. Depois, em ',
    { link: 'audience', text: 'Público-alvo' },
    ', clique em ',
    { strong: 'Publicar app' },
    ' (em teste, o acesso expira a cada 7 dias).',
  ],
  [
    'Em ',
    { link: 'clients', text: 'Clientes' },
    ', crie um cliente do tipo ',
    { strong: 'App para computador' },
    ' e baixe o JSON.',
  ],
  ['Escolha esse JSON aqui e clique em Conectar.'],
];

const Part = ({ part, call }) =>
  typeof part === 'string' ? (
    part
  ) : part.strong ? (
    <strong>{part.strong}</strong>
  ) : (
    <ExternalLink call={call} href={LINKS[part.link]}>
      {part.text}
    </ExternalLink>
  );

// The OAuth client is the person's own (a free Google Cloud project): VeSTA has no server and keeps no keys of its own.
export function DriveSetup({ call, setStatus }) {
  const [id, setId] = useState(''),
    [secret, setSecret] = useState('');
  return (
    <div className="drive-setup">
      <p className="backup-note">
        O VeSTA envia os backups direto para o seu Google Drive, numa pasta “VeSTA backups”, e só enxerga os arquivos
        que ele mesmo criou. Para isso, crie uma vez (uns 5 minutos) a sua chave de acesso no Google Cloud, de graça:
      </p>
      <ol className="drive-steps">
        {STEPS.map((parts, i) => (
          <li key={i}>
            {parts.map((part, j) => (
              <Part part={part} call={call} key={j} />
            ))}
          </li>
        ))}
      </ol>
      <div className="row backup-actions">
        <button className="primary-button" onClick={action(async () => setStatus(await call('driveSetClient')))}>
          <FileJson size={15} />
          Escolher o JSON do cliente
        </button>
      </div>
      <details className="drive-paste">
        <summary>
          <ChevronDown size={13} /> Ou cole o ID e a chave secreta
        </summary>
        <div className="drive-paste-fields">
          <input
            aria-label="ID do cliente"
            placeholder="ID do cliente (…apps.googleusercontent.com)"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
          <input
            aria-label="Chave secreta do cliente"
            placeholder="Chave secreta (GOCSPX-…)"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <button
            className="secondary-button"
            disabled={!id || !secret}
            onClick={action(async () => {
              setStatus(await call('driveSetClient', { clientId: id, clientSecret: secret }));
              setSecret('');
            })}
          >
            Salvar
          </button>
        </div>
      </details>
      <p className="backup-note">
        Em outro computador, use o mesmo JSON e a mesma conta do Google para ver e restaurar estes backups.
      </p>
    </div>
  );
}
