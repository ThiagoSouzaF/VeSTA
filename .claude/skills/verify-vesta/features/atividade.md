# Atividade e faixa de processos

O que as IAs estão fazendo agora: respostas, subagentes, comandos e tarefas em segundo plano. A tela Atividade mostra tudo. Dentro do chat, acima do composer, fica a faixa de processos paralelos (`TaskDock`).

## Sub-features

- Atividade: chats vivos agrupados, contadores, e a árvore turno → subagente → passo com tempo decorrido.
- Expandir uma tarefa para ver o comando e o prompt.
- Parar por chat vivo e por tarefa rastreável do Claude.
- Faixa de processos acima do composer.
- Contador no trilho e selo nos chats com tarefas rodando.
- Mascote acompanha o estado: trabalhando, pensando, erro, sucesso.

## How to get to it (user POV)

Clique no avatar da mascote (`[data-testid=mascot-avatar]`) ou no ícone de atividade do trilho. A faixa aparece dentro de um chat que tem processos rodando.

## Driving it with vesta.cjs

- **Estado vazio:** clique em `[data-testid=mascot-avatar]`. A Atividade abre com o painel calmo.
- **Mascote:** `data-state` do avatar (`idle`, `working`...) em `[data-testid=mascot-avatar]`.
- **Com trabalho de verdade:** mande para o Drael uma mensagem que rode um comando demorado. Enquanto `state.running` não estiver vazio, confira a árvore e a faixa.

## Gotchas

- Sem IA não há atividade viva. O smoke test injeta estado sintético pelo mesmo evento de snapshot que o app usa (veja `activityState` em `scripts/test-ui-smoke.cjs`). Copie esse padrão quando a prova for só da interface, e diga no relatório que o estado foi sintético.
- Um chat que estava rodando quando o app fechou aparece como parado, não vivo.
