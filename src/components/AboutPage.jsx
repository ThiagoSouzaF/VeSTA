import { ArrowLeft, Droplets, EyeOff, Flame, Scale } from 'lucide-react';
import { MASCOT_ART } from '../lib/mascotImages';
import { Wordmark } from './Brand';

const IDEAS = [
  [
    Flame,
    'Vesta, guardiã da chama',
    'Na Roma antiga, a deusa do lar mantinha o fogo sagrado sempre aceso. A VeSTA cuida do centro do seu lar digital: seus agentes, projetos e memória.',
  ],
  [
    Scale,
    'Libra: o equilíbrio entre as IAs',
    'A balança pesa cada inteligência sem favoritismo. Você escolhe quem conversa, quem trabalha e quem revisa.',
  ],
  [
    Droplets,
    'Aquário: fluxo de dados e inovação',
    'A ânfora derrama dados e ideias novas. Tudo corre localmente, pelo seu computador.',
  ],
  [
    EyeOff,
    'Vendada, como a justiça',
    'A venda mostra imparcialidade: o que vale é o resultado, não de qual IA ele veio.',
  ],
];

// "Sobre a VeSTA": the mascot's art and the idea behind her.
export function AboutPage({ version, onBack }) {
  return (
    <div className="content-page about-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SOBRE</div>
          <h1>
            Conheça a <Wordmark />.
          </h1>
          <p>A mascote do app e o que cada detalhe dela quer dizer.</p>
        </div>
        <button className="secondary-button" onClick={onBack}>
          <ArrowLeft size={15} />
          Preferências
        </button>
      </div>
      <div className="about-hero">
        <figure className="about-figure">
          <img src={MASCOT_ART.full} alt="Vesta, corpo inteiro, em estilo mangá preto e branco" decoding="async" />
        </figure>
        <div className="about-copy">
          <h2>Vesta, a guardiã da chama</h2>
          <p>
            Ela segura o fogo do lar numa mão e a balança na outra. Quando as IAs trabalham, ela trabalha junto; quando
            tudo termina, ela comemora; quando algo dá errado, ela avisa.
          </p>
          <ul className="about-meanings">
            {IDEAS.map(([Icon, title, text]) => (
              <li key={title}>
                <span className="glyph" aria-hidden="true">
                  <Icon size={17} />
                </span>
                <div>
                  <strong>{title}</strong>
                  {text}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <section className="about-sheet">
        <h3>FOLHA DE PERSONAGEM: FRENTE, PERFIL E COSTAS</h3>
        <figure className="about-figure">
          <img
            src={MASCOT_ART.turnaround}
            alt="Vesta vista de frente, de perfil e de costas"
            loading="lazy"
            decoding="async"
          />
        </figure>
      </section>
      <p className="about-version">VeSTA {version ? 'v' + version : ''} · beta</p>
    </div>
  );
}
