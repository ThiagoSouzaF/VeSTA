# VeSTA: instruções para agentes

App desktop (Electron + React/Vite) que reúne Claude Code, Codex, OpenCode e Drael com uma memória compartilhada (AI Memory). Responda e escreva textos de interface em português do Brasil.

## Regras que não se quebram

- **Dados reais do usuário ficam em `%APPDATA%\VeSTA`** (`vesta.json`, `memory/`). Nunca rode testes, scripts nem o app de desenvolvimento contra eles. Sempre use `VESTA_DATA_DIR` com uma pasta temporária, por exemplo via `scripts/test-scratch.cjs`.
- **Nunca encerre o `ai-memory.exe` por nome** (`taskkill /IM`, `Stop-Process -Name`). O app instalado pode estar usando a memória. Encerre só processos que o seu teste iniciou, pelo PID.
- **Sem telemetria.** Todo processo filho usa `childEnv()` de `electron/app/privacy.cjs`. Nunca espalhe `...process.env` (há teste que proíbe).
- **Segredos só via `electron/app/secrets.cjs`** (DPAPI). Nunca grave senha ou token em texto puro.
- **Janelas de teste não aparecem na frente do usuário**: os E2E abrem o app fora da tela. Não abra o app instalado para validar.
- **Publicar exige pedido explícito do usuário.** Push e release, só quando ele pedir.

## Estrutura

- `electron/` por domínio: `app/ ai/ chat/ memory/ quests/ mcp/ backup/ attachments/ remote/ shared/ util/`.
- `electron/shared/*.cjs` também é importado pela interface (via `vite.shared.mjs`) e não pode ter `require`.
- `src/` é a interface desktop, `mobile/` o app do celular (PWA) e `test/` os testes de unidade (`node:test`).
- `scripts/test-*.cjs` são os E2E.
- Como cada IA é chamada: `electron/ai/providers/command.cjs`.
- O que vai junto da mensagem (memória, ferramentas): `electron/chat/turn-context.cjs`.

## Verificar antes de dizer que terminou

1. `npm test` e `npm run format:check` (Prettier; corrija com `npm run format`).
2. `npm run build`, se mexeu na interface.
3. O E2E da área que mudou.
   - Rode com `node`: `test-ui-smoke`, `test-remote-e2e`, `test-tree-e2e`, `test-switch-provider`, `test-quest-e2e`, `test-quest-lead-e2e`.
   - Rode com `npx electron`: os de serviço, como `test-memory-agent`, `test-memory-prefs-e2e`, `test-chat-quest-e2e`, `test-drive-e2e`, `test-backup-e2e`.
   - Os E2E com IA real variam: se falhar uma vez, rode de novo antes de concluir que quebrou.

Código limpo e modular. Testes ligados ao que mudou, sem redundância. Limpe o que o trabalho deixou em disco.
