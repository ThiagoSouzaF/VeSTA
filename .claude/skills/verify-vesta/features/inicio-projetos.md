# Início e projetos

Página padrão ao abrir: os projetos em quadrados, o espaço pessoal e "Conectar uma pasta". Jornada pronta: `jornadas/inicio.cjs`.

## Sub-features

- Quadrados dos projetos, com contagem de conversas e do que roda em cada um.
- Conectar uma pasta como projeto.
- Abrir um projeto, que leva à conversa mais recente ou à tela de boas-vindas.
- Filtros Recentes, Com tarefas rodando e A–Z, e a busca de projeto.
- Pergunta rápida sem projeto, que vai para o Espaço pessoal.

## How to get to it (user POV)

Abrir o app. Depois, o ícone de grade no topo do trilho leva de volta ao Início.

## Driving it with vesta.cjs

- **Título:** `h1` "Em que vamos trabalhar hoje?".
- **Quadrados:**
  - espaço pessoal: `.project-tile[data-project=personal]`;
  - adicionar: `.project-tile.add`;
  - um projeto: `.project-tile` com o nome.
- **Conectar:** `await v.escolherPasta(dir)` antes de clicar em `.project-tile.add`.
- **Prova:** o quadrado com o nome da pasta aparece, e `call('bootstrap')` mostra `state.projects[].path` igual à pasta, comparando com `fs.realpathSync`.
- **Abrir:** clique no quadrado e espere `.welcome h1`.

## Gotchas

- A janela nativa de escolher pasta não é dirigível. Use `escolherPasta`, que troca só a próxima resposta dela.
- O caminho gravado passa por `realpathSync`, e `%TEMP%` pode ter nome curto (`KAREF~1`). Compare os dois lados normalizados.
