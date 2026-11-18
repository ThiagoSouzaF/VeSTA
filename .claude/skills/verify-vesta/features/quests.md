# Quests

Um objetivo, várias IAs: a quest tem um plano de etapas, um quadro com o andamento e um chat próprio (o chat da quest).

## Sub-features

- Lista de quests com progresso e as IAs envolvidas.
- Nova quest, com título e objetivo.
  - Planejar com IA.
  - Ou montar manualmente no editor de plano: adicionar, depender, reordenar e remover etapas, e escolher o modo de cada uma.
- Rodar, pausar, retomar, cancelar, tentar de novo e pular etapa.
- Cartão da etapa com link para o chat dela.
- Resumo final da quest concluída.

## How to get to it (user POV)

Trilho, `Quests`. O título da página é "Dê uma quest às suas IAs.".

## Driving it with vesta.cjs

- **Nova quest:**
  1. Clique em `[data-action=new-quest]`.
  2. No `getByRole('dialog')`, preencha `#quest-title` e `#quest-goal`.
  3. Clique em `/Montar manualmente/`. O botão fica desabilitado sem objetivo.
- **Editor:** `.plan-editor`.
  - Botões: `Adicionar etapa`, `Descer etapa`, `Subir etapa`, `Remover etapa` e `/Salvar plano/`.
  - Campos: `Título da etapa N`, `Instruções da etapa N`, `Modo da etapa N` (select `edit` ou `read`).
  - Dependência: `.dep-chip`; ligada fica `.dep-chip.on`.
  - Iniciar: `[data-action=start]`, desabilitado sem etapas.
- **Prova do plano:**
  - `.plan-step` tem a quantidade certa;
  - em `call('bootstrap')`, `state.quests[0].steps` traz os títulos, o `dependsOn` e o `mode` certos;
  - `status` continua `'draft'`, porque salvar não inicia.
- **Lista:** `.quest-row[data-quest=<id>]`, com `[role=progressbar]` e `aria-valuenow`.

## Gotchas

- Planejar com IA e rodar etapas chamam IAs reais e demoram minutos. Para provar a interface, monte manualmente.
- Os estados pausada, com falha e concluída vêm de dados semeados. Veja como `scripts/test-ui-smoke.cjs` monta o `vesta.json` antes de abrir. `--seed` não traz quests.
- Abrir o app com uma quest "running" a pausa e marca a etapa órfã. É de propósito.
