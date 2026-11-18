# As três fontes da ui-revamp

Conferido em novembro de 2026. Se tiver web, confira o que mudou nos links.

## TasteSkill — disciplina de tela

- Site https://www.tasteskill.dev, repositório https://github.com/Leonxlnx/taste-skill (MIT). Instala com `npx skills add Leonxlnx/taste-skill` (skill `design-taste-frontend`, Node 22 e Chrome).
- A versão 2.5 mira páginas de empresa (landing pages): uma seção por tela, foto real, entrada do hero. Para **telas de app** (painéis, configurações, chats) valem as regras do modo app que ela trazia na 2.1:

**Pode:** bordas quietas, rótulos pequenos (de 11px para cima), painéis e tabelas repetidos, um único acento de cor reservado a dado e estado.

**Corrija quando achar:** sombra pesada, vidro (`backdrop-filter` decorativo), ícone em quadrado colorido, gráfico arco-íris, dado de mentira, texto abaixo de 11px, barra lateral sobrando no celular, linhas desalinhadas, primeira tela rala, título de landing page numa tela de trabalho, faixa morta ao lado do conteúdo, cor espalhada.

**Movimento (motion.md da skill):** só `transform` e `opacity` se movem, nunca largura, altura ou posição; nada aparece ao rolar; cada movimento tem um motivo de uma linha.

| Peça | Hover (só ponteiro fino) | Clique |
|---|---|---|
| Botão | sobe 1px, 150ms entrando e 120ms saindo | desce 1px e escala .985, 90ms |
| Cartão com link | sobe 2px, borda um tom mais forte | — |
| Cartão sem link | nada | — |
| Aba | um indicador desliza até a escolhida, 240ms | — |

Anti-padrões do "visual de IA": gradiente roxo, emoji decorativo, texto em gradiente, pilha de cartões de vidro.

## transitions.dev — movimento

- Site https://transitions.dev, repositório https://github.com/Jakubantalik/transitions.dev. Skill: `npx skills add Jakubantalik/transitions.dev`. Nota do movimento atual do projeto: `npx transitions-agent` (local, sem conta).
- Licença: use à vontade em produtos (inclusive comerciais); não redistribua a coleção como biblioteca própria.
- 36 transições em CSS puro, classes `t-*`, cada uma com bloco de `prefers-reduced-motion`. Regra de escolha: case pelo elemento visível e pelo verbo.

| Elemento | Transição |
|---|---|
| Superfície que cresce do gatilho | menu dropdown (com origem) |
| Diálogo centralizado | modal: abre em scale .96, fecha mais rápido |
| Painel que entra numa região | panel reveal (desliza com blur) |
| Duas telas, lista e detalhe | page side-by-side |
| Texto que troca no lugar | text states swap (blur sobe e desce) |
| Rótulo que muda e divide letras | text morph |
| Dois ícones no mesmo lugar | icon swap (copiar vira check) |
| Número que muda e deve ser notado | number pop-in; quieto: number subtle change |
| Badge numa aba ou ícone | notification badge |
| Abas ou segmentos | tabs sliding |
| Dica sobre um gatilho | tooltip: espera, entra rápido, sai na hora |
| Título e linha de apoio entrando | texts reveal (escalonado) |
| Grupo que abre e fecha | accordion (grid-rows, chevron vira) |
| Aviso passageiro | toast |
| IA trabalhando | thinking states, shimmer text, reasoning stream |
| Erro de formulário | error state shake |

**Escala de tokens** (copie uma vez, use por nome):

| Token | Valor | Uso |
|---|---|---|
| `--duration-stagger` | 40ms | atraso por item |
| `--duration-micro` | 80ms | atraso de tooltip, segmento de shake |
| `--duration-quick` | 150ms | fechar modal e menu, troca de texto, tooltip |
| `--duration-fast` | 250ms | abrir modal e menu, troca de ícone, abas |
| `--duration-medium` | 350ms | fechar painel e toast |
| `--duration-slow` | 400ms | abrir painel, revelar conteúdo |
| `--duration-very-slow` | 500ms | ênfase, badge, texto que entra |
| `--ease-smooth-out` | cubic-bezier(0.22, 1, 0.36, 1) | abrir e fechar superfícies, deslizar |
| `--ease-in-out` | ease-in-out | troca de ícone e texto |
| `--ease-bounce` | cubic-bezier(0.34, 1.36, 0.64, 1) | badge |
| `--scale-large` / `-medium` / `-small` | .96 / .97 / .98 | modal / menu / tooltip |
| `--blur-small` / `-medium` | 2px / 3px | trocas / entradas |
| `--distance-micro` / `-base` / `-medium` | 4px / 8px / 12px | troca de texto / slide / texto entrando |

Erros comuns: esquecer a classe de fechamento (`is-closing`) e o reflow (`void el.offsetWidth`) para repetir uma animação; usar `transition: all`; o indicador de abas animar a partir de 0 no primeiro desenho (posicione sem transição na montagem).

## React Bits — peças animadas

- Site https://reactbits.dev, repositório https://github.com/DavidHDev/react-bits. Licença MIT + Commons Clause: use em qualquer app, mantenha o aviso de copyright nos arquivos copiados; não revenda nem redistribua os componentes como pacote.
- Instale como código seu: `npx shadcn@latest add @react-bits/<Nome>-<JS|TS>-<CSS|TW>` ou copie a fonte. Variantes JS/TS e CSS/Tailwind.
- Categorias: Text Animations, Animations, Components, Backgrounds, Micro.
- **Sem dependência extra** (só React): ClickSpark, Counter, LatticeLoader, DotGrid, LetterGlitch, PixelTransition, HalftoneReveal, ShinyText, HoldButton, Crosshair.
- **Com `motion`** (porte sem ele quando possível): DecryptedText, CountUp, BlurText, StatusMark, SquishSwitch, ThoughtLine. **Com `gsap`**: TextType, ScrambledText, FadeContent, AnimatedContent.

Escolha pela tarefa da tela, não pelo efeito:

| Tarefa | Peça |
|---|---|
| IA pensando, com tempo decorrido | LatticeLoader |
| Enviar, confirmar | ClickSpark (na cor do tema) |
| Número que chega ao valor | CountUp, Counter |
| Rótulo técnico entrando (HUD) | DecryptedText |
| Ação destrutiva sem diálogo | HoldButton |
| Fundo vivo e discreto | DotGrid, LetterGlitch (pause quando a janela some) |

Fundos e efeitos de shader custam CPU: só onde o app já tem fundo animado ou o usuário pedir.
