# Conversas e composer

Gaveta de conversas, chat com o composer, troca de IA e anexos.

## Sub-features

- Criar chat pelo modal, escolhendo a IA.
- Rascunho por chat, que sobrevive à troca de chat e de página.
- Gaveta de conversas: abre e fecha pelo trilho ou com Ctrl+B, e tem busca.
- Enviar mensagem e receber resposta, com o resumo da atividade.
- Trocar a IA da conversa no meio do histórico.
- Anexos: arrastar, Ctrl+V com imagem, chips, miniaturas.
- Ir para o fim em chat longo, zoom com Ctrl+= / Ctrl+- / Ctrl+0.

## How to get to it (user POV)

Trilho, `Conversas`, ou o botão de novo chat (`.new-chat`).

## Driving it with vesta.cjs

- **Novo chat:**
  1. Clique em `.new-chat`, ou no papel `button` com o nome `/Novo chat/`, e espere `getByRole('dialog')`.
  2. Para escolher a IA, use `.modal-providers button` com o nome dela (filtre `Drael` com `hasNotText: 'OpenCode'`).
  3. Clique em `getByRole('button', { name: /Criar chat/ })`.
  4. Prova: `.chat-heading h2` mostra "Novo chat" e `.chat-list-item` aparece.
- **Composer:** `textarea[aria-label="Mensagem"]`. Enter envia e Shift+Enter quebra a linha. Também há o botão `aria-label="Enviar mensagem"`.
- **Resposta:** consulte `call('bootstrap')` até `state.running` ficar vazio, com prazo de 120 s. A última mensagem do chat tem `status: 'done'`. Na tela, o autor aparece em `.message-author strong`.
- **Trocar IA:** papel `button` "Trocar IA desta conversa", depois `.model-menu button` com o nome. Confira em `.composer-options`.
- **Chat longo:** rode com `--seed`, que traz 40 turnos.

## Gotchas

- Resposta de verdade gasta cota e varia. Prefira o Drael, peça respostas curtas ("responda apenas OK, sem ferramentas") e repita uma vez antes de dar como quebrado.
- Desligue a memória antes de enviar, para não poluir o teste: `call('saveSettings', { memoryEnabled: false, capture: false })`.
- Sem `--seed` a lista de chats começa vazia, e o chat mais novo vem primeiro em `.chat-list-item`.
