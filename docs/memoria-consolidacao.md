# Consolidação nativa do AI Memory — teste (fase 1)

Teste feito em 2026-10-21 com `runtime/ai-memory.exe` (v3.0.0), numa pasta temporária e com um servidor próprio (`serve --transport http`, workspace `vesta`, projeto `teste`). Os dados reais do app não foram usados.

## Resumo

Funciona. O VeSTA pode fazer o papel dos hooks sem instalar nada nas IAs. Ele envia o ciclo de vida de cada chat ao servidor que já sobe hoje. No fim da sessão, chama `memory_consolidate`, que usa o login do Codex que você já tem. Num chat de teste, saíram três páginas destiladas, todas no projeto certo:

| Página | Exemplo real do teste |
|---|---|
| `sessions/<id>.md` | "Correção da expiração de login do app mobile": narrativa curta do que foi feito |
| `gotchas/…` | "TTL do login mobile em segundos tratado como minutos" |
| `_rules/…` | "Use milissegundos e o sufixo _MS para todo TTL" |

A busca `memory_query "TTL milissegundos"` devolve a regra em primeiro lugar. Cada consolidação levou cerca de 9 s.

## O que foi verificado

1. **Eventos por HTTP.** `POST <servidor>/hook?event=<evento>&agent=codex&workspace=vesta&project=<projeto>&cwd=<pasta>` com `Authorization: Bearer <token>` e um JSON no formato do Claude Code (`session_id`, `cwd`, `prompt`, `tool_name`, `tool_input`, `tool_response`). O servidor responde `202 queued`.
   - Eventos usados: `session-start`, `user-prompt`, `pre-tool-use`, `post-tool-use`, `stop` e `session-end`.
   - O endpoint é o mesmo do `/mcp` que o VeSTA já usa. Não há porta nem servidor novo.
2. **Escopo correto.** Os parâmetros `workspace` e `project` da URL valem, e a sessão cai em `vesta/<projeto>`. Ela não cai no nome da pasta, que era o problema dos hooks nativos.
3. **Fim de sessão sem LLM.** O `session-end` gera sozinho uma página-resumo por regras ("2 prompts, 2 tool calls"). Ela é fraca, mas não custa nada.
4. **Consolidação com LLM.** A ferramenta MCP `memory_consolidate {session_id, multi_page: true}` reescreve a sessão e cria páginas de armadilha (gotcha), regra e conceito numa única transação.
   - Provedor: `AI_MEMORY_LLM_PROVIDER=codex`, que reaproveita o login do Codex CLI (`~/.codex/auth.json`) com o modelo padrão `gpt-5.6-luna`.
   - Não precisa de chave de API. `llm-test` respondeu em cerca de 1 s.
   - **Claude pela assinatura não serve:** a documentação avisa que a Anthropic recusa o token OAuth em apps de terceiros (`429`).
5. **Resposta da IA.** Por padrão, o servidor descarta o texto da resposta. Sem ela, o consolidador concluiu que a correção "não foi concluída". Para incluir a resposta são preciso dois ajustes:
   - No servidor: `AI_MEMORY_CAPTURE_ASSISTANT=true`.
   - No envio: o evento `stop` precisa sair pelo hook nativo, `ai-memory hook --event stop --agent codex --capture-assistant --server-url … --auth-token …`, com o JSON pelo stdin e o campo `last_assistant_message`. Ele higieniza e corta o texto em 2 KB antes de enviar.
   - Isso dá um processo por resposta, não por ferramenta.
   - A sessão é identificada pelo `session_id`, então esse `stop` cai na mesma sessão e no mesmo projeto.
6. **Manutenção já roda sozinha.** O `serve` agenda `forget-sweep` (envelhecimento) e `lint` por regras a cada poucos minutos. Isso já acontece no servidor do VeSTA hoje. Só não tem efeito ainda porque as páginas são novas: o decaimento leva cerca de 80 dias sem acesso.

## Custos e riscos

- **Cota.** Cada consolidação é uma chamada ao modelo do Codex. O log não mostra tokens. A documentação estima de US$ 0,01 a 0,05 por sessão na API, e aqui sai da cota da assinatura do ChatGPT.
- **Privacidade.** Prompts, ferramentas e um trecho de 2 KB da resposta vão para o provedor do LLM. É o mesmo provedor que já recebe a conversa quando o chat é do Codex, mas chats do Claude também passariam pela OpenAI na consolidação.
- **Caminhos longos no Windows.** O git do wiki falhou com "path too long" na pasta temporária do teste, que é muito longa. Em `%APPDATA%\VeSTA\memory` o caminho é curto. Mesmo assim, vale conferir no E2E, porque falhar o auto-commit perde o histórico de versões, mas não a página.
- **Sessão longa.** Um chat do VeSTA pode durar dias, e a consolidação exige uma sessão encerrada.

## Fase 2 (implementada)

Código: `electron/memory-sessions.cjs` (sessões e eventos), `Memory.hook`/`Memory.stopWithAnswer` em `electron/memory.cjs`, chamadas em `electron/send.cjs`, preferências `capture`, `memoryConsolidate` e `captureRaw`. O auto-improve horário fica desligado (`AI_MEMORY_AUTO_IMPROVE__SCHEDULER__ENABLED=false`). Um chat apagado não é consolidado. Testes: `test/memory-sessions.test.cjs` e `scripts/test-memory-consolidation-e2e.cjs`, que usa IA real (Claude Haiku para responder e Codex para consolidar).

### Desenho

- **Sessão = trecho de conversa.** A primeira mensagem abre `session-start` (com `session_id` = `<chatId>:<n>`). Cada turno manda `user-prompt`, as ferramentas da resposta e o `stop` nativo com a resposta. A sessão fecha com `session-end` e `memory_consolidate` quando o chat fica 30 min sem mensagens, quando o app fecha ou quando você troca de IA ou de projeto.
- **Fim da página bruta por turno.** A captura atual (`conversas/<chat>/<msg>.md`) é desligada, ficando como opção avançada.
- **Preferências → Memória.** Novos controles: "Consolidar com IA" (Codex / desligado), com aviso de cota e privacidade, e a contagem de páginas consolidadas.
- **Páginas antigas.** As 1.232 páginas brutas de `conversas/` envelhecem sozinhas pelo `forget-sweep`. Para limpar já, dá para oferecer um botão que as remove, pois o histórico fica no git do wiki e `restore-page` recupera.
- **Testes.** Unitários para o mapeamento de eventos e um E2E real com `VESTA_DATA_DIR` temporário: um chat real gera páginas de regra ou armadilha no projeto certo.
