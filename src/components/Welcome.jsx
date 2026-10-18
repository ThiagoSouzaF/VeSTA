import { Mark } from './Brand';
import { PROVIDERS } from '../lib/constants';
import { ProviderIcon } from './ProviderIcon';
import { ArrowUpRight, Brain, Folder, Check } from 'lucide-react';
export function Welcome({ provider, setProvider, integrations, setDraft, draftKey, textarea }) {
  return (
    <div className="welcome">
      <div className="hero-topline">
        <span className="mini-line" />
        <span>UM PONTO DE ENCONTRO PARA SUAS IDEIAS</span>
      </div>
      <div className="hero-orbit">
        <div className="orbit-ring one" />
        <div className="orbit-ring two" />
        <div className="orbit-ring three" />
        <div className="orbit-star">
          <Mark size={58} />
        </div>
        <span className="orbit-dot d1" />
        <span className="orbit-dot d2" />
        <span className="orbit-dot d3" />
      </div>
      <h1>
        Muitas inteligências.
        <br />
        <em>Um só centro.</em>
      </h1>
      <p className="hero-subtitle">
        Suas IAs, seus projetos e tudo que vale lembrar.
        <br />
        Escolha uma inteligência e dê espaço à próxima ideia.
      </p>
      <div className="provider-grid">
        {Object.entries(PROVIDERS).map(([id, p]) => (
          <button
            key={id}
            className={'provider-card ' + (provider === id ? 'chosen' : '')}
            onClick={() => setProvider(id)}
          >
            <div className="provider-card-top">
              <ProviderIcon id={id} />
              <span className={'provider-check ' + (provider === id ? 'checked' : '')}>
                {provider === id && <Check size={11} />}
              </span>
            </div>
            <strong>{p.name}</strong>
            <span>{p.engine}</span>
            <div className="provider-available">
              <span className={'status-dot ' + (integrations[id]?.installed ? '' : 'offline')} />
              {integrations[id]?.installed ? 'Disponível neste PC' : 'Configurar conexão'}
            </div>
          </button>
        ))}
      </div>
      <div className="starter-heading">POR ONDE COMEÇAMOS?</div>
      <div className="starter-grid">
        {[
          {
            icon: Folder,
            title: 'Explorar um projeto',
            body: 'Entenda a estrutura e os próximos passos.',
            prompt: 'Explore a estrutura deste projeto e me sugira os próximos passos. Apenas leia os arquivos.',
          },
          {
            icon: Brain,
            title: 'Pensar junto',
            body: 'Transforme uma ideia em um plano.',
            prompt:
              'Quero transformar uma ideia em um projeto. Me ajude a organizar o problema, as possibilidades e o primeiro passo.',
          },
        ].map((s) => (
          <button
            className="starter-card"
            key={s.title}
            onClick={() => {
              setDraft(draftKey, s.prompt);
              textarea.current?.focus();
            }}
          >
            <s.icon size={18} />
            <div>
              <strong>{s.title}</strong>
              <span>{s.body}</span>
            </div>
            <ArrowUpRight size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}
