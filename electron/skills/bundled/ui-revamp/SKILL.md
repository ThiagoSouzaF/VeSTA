---
name: ui-revamp
description: Use para refazer, modernizar ou dar vida à UI de um app, site ou tela desta conversa, com TasteSkill (disciplina de tela), transitions.dev (movimento) e React Bits (peças animadas).
version: 2
---

# UI revamp

Você vai refazer a interface do software em que esta conversa trabalha, usando três fontes: **TasteSkill** decide o que uma tela boa tem, **transitions.dev** dá a escala de movimento e as transições, **React Bits** dá peças animadas prontas. O material de cada uma está em `fontes.md` desta skill (leia com a ferramenta `vesta_skill_file`, name `ui-revamp`, path `fontes.md`) antes do passo 3.

A regra que vale do começo ao fim: **as decisões do usuário mandam**, as registradas na memória compartilhada do VeSTA e as que ele der aqui. A skill sugere; o histórico dele decide.

## 1. Leia o que o usuário já decidiu

O perfil e o resumo do projeto já chegam com a mensagem. Complete com `memory_query` (servidor `vesta-memory`) procurando interface, design, cores, tema, protótipo, animação e acessibilidade neste projeto.

Anote numa lista curta cada **decisão** encontrada: tema e cores escolhidos, telas aprovadas, estilo de trabalho (por exemplo, "prefere ver protótipo antes de mudar o app", "não pergunte permissões"), o que ele rejeitou.

Pronto quando: cada decisão tem a fonte (memória ou conversa) e você sabe se o usuário costuma querer protótipo antes. Com a memória desligada ou vazia, diga isso e siga com o que a conversa mostra.

## 2. Pergunte as cores (e só o que a memória não respondeu)

Faça uma pergunta só, numa mensagem, e espere a resposta:

> Refaço a interface **mantendo as cores e os temas** de hoje, ou posso **refazer as cores também**?

Na mesma mensagem, pergunte se quer ver um protótipo antes **apenas se** a memória não disse. Quando disse, informe o que vai fazer ("pela sua preferência, mostro um protótipo antes"). Grave a resposta nova no perfil (passo 7).

Pronto quando: a escolha das cores está dada pelo usuário nesta conversa.

## 3. Estude as fontes e o app

Leia `fontes.md` e, se tiver acesso à web, confira nas páginas e repositórios dela o que mudou. Depois faça o **inventário** do app:

- a stack (framework, CSS, onde ficam os temas e os tokens);
- cada tela e cada superfície que abre ou fecha: modal, menu, gaveta, toast, abas, acordeão, estado de "carregando", números que mudam;
- o movimento atual: todo `transition`, `animation` e `@keyframes`, com duração e curva;
- o texto abaixo de 11px, os cantos, as sombras e as cores fora dos tokens.

Pronto quando: cada superfície do inventário tem ao lado a receita que vai receber (uma transição do transitions.dev, uma peça do React Bits ou uma regra do TasteSkill) ou "fica como está", com o motivo.

## 4. Protótipo, se for o caso

Com protótipo pedido (ou preferido na memória), monte um HTML único com as duas ou três telas que mais mudam, antes e depois lado a lado, nas cores escolhidas no passo 2. Mostre e espere a escolha. Sem protótipo, siga.

## 5. Aplique em camadas

Na ordem, cada camada verificada antes da próxima:

1. **Tokens de movimento** (escala do transitions.dev) num arquivo só, com o bloco de `prefers-reduced-motion`.
2. **Transições** nas superfícies do inventário. Entrada e saída: quem fecha precisa continuar montado durante a saída.
3. **Disciplina de tela** (TasteSkill, regras de app): texto de leitura em 11px ou mais, números alinhados (`tabular-nums`), hover e clique como na tabela de `fontes.md`, nada se move ao rolar.
4. **Peças do React Bits**, só onde servem a uma tarefa da tela (um carregamento, um número, um envio). Sem React, porte a ideia em CSS e JS puro.

Com as cores mantidas, toda cor nova sai dos tokens que já existem; o que muda é forma, ritmo e movimento. Com as cores liberadas, defina a paleta nova primeiro, como tokens, e aplique as camadas por cima.

## 6. Verifique como o usuário veria

- Rode os testes, o lint e o build do projeto.
- Abra o app e capture cada tela mudada em 1440px e 390px, em cada tema. Capture também um quadro **no meio** de cada transição (uns 100ms depois do gatilho) e confira com `document.getAnimations()` que ela roda.
- Repita com movimento reduzido: tudo aparece parado e inteiro.
- Janela fora da tela limita o `requestAnimationFrame`: prove canvas pelos pixels, não pela captura.

Pronto quando: cada item do inventário tem prova (captura ou leitura) e nenhum teste ficou vermelho.

## 7. Registre

Grave na memória com `memory_write_page`:

- no projeto, a decisão de design desta rodada (fontes usadas, tokens, o que ficou de fora e por quê), em `agentes/ui-revamp.md`;
- no perfil (scope `profile`), só preferência durável nova que o usuário expressou, como a resposta das cores quando ele disser que vale sempre.

Termine dizendo o que mudou por tela, o que não foi verificado e as licenças das peças copiadas (créditos no código).

## Se der errado

- **Sem web:** siga só com `fontes.md` e diga que não conferiu as novidades das fontes.
- **Memória fora do ar ou ferramenta falhando:** diga qual falhou, siga com a conversa e pergunte o que a memória responderia.
- **Teste, lint ou build vermelho depois de uma camada:** pare, corrija ou desfaça só essa camada antes da próxima; não empilhe mudança sobre erro.
- **Comando `npx` das fontes:** não rode sem o usuário pedir; quando rodar, fixe a versão (`pacote@x.y.z`, nunca `@latest`) e mostre o comando antes.
- **Peça do React Bits pede dependência nova** (`motion`, `gsap`): porte sem ela ou pergunte antes de instalar.
