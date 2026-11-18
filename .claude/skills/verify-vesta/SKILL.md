---
name: verify-vesta
description: Abre o VeSTA desktop de verdade (Electron com o build atual) numa pasta de dados descartável e fora da tela, dirige a interface como um usuário com Playwright e guarda capturas e um relatório como prova. Use para provar que uma mudança na interface ou num fluxo do VeSTA funciona, reproduzir um bug visível ou conferir uma tela antes de dizer que terminou.
---

# Verificar o VeSTA

Prove o comportamento no app real, não num teste de unidade. Tudo passa pelo helper `scripts/vesta.cjs` desta skill, rodado da raiz do repositório.

## Regras

- **Nunca use os dados reais** (`%APPDATA%\VeSTA`). O helper sempre cria uma pasta `%TEMP%\vesta-verify-<nome>-*` e recusa outra.
- **Não abra o app instalado** para validar. A janela de verificação abre fora da tela, sem foco e sem barra de tarefas.
- **Não encerre processos por nome** (`ai-memory.exe`, `electron.exe`). O helper só encerra, pelo PID, processos cuja linha de comando cita uma pasta `vesta-verify-`.
- **IA real custa cota e varia.** Só mande mensagem para uma IA quando a jornada precisar disso. Prefira o Drael, e repita uma vez antes de concluir que quebrou.

## Doctor

Rode antes de tudo e sempre que algo parecer errado:

```
node .claude/skills/verify-vesta/scripts/vesta.cjs doctor
```

Ele confere:

- se `electron` e `playwright` estão instalados;
- se `dist/` é mais novo que `src/`, porque a janela carrega `dist/` (se não for, rode `npm run build`);
- se há instâncias de verificações anteriores vivas.

Com qualquer `PROBLEMA`, corrija antes de dirigir.

## Abrir e dirigir

Escreva uma jornada, um módulo que exporta `async (v) => {}`, e rode:

```
node .claude/skills/verify-vesta/scripts/vesta.cjs run <jornada.cjs> [--seed] [--manter]
```

- `--seed`: começa com uma conversa longa e uso semeado (`scripts/seed-store.cjs`). Sem a opção, a pasta começa vazia.
- `--manter`: mantém a pasta de dados para inspecionar depois. Em falha ela já é mantida.
- **Pronto** quer dizer que `.app-shell` apareceu e `.loading` sumiu. O helper espera isso antes de chamar a jornada.

O `v` que a jornada recebe tem:

| Campo | Para quê |
|---|---|
| `page`, `app` | Página da janela principal e app do Playwright. |
| `passo(nome, fn)` | Um passo do relatório, que sai como ok ou FALHOU. |
| `foto(nome)` | Captura numerada na pasta de provas. |
| `call(metodo, args)` | Lê o estado pela mesma ponte da interface (`window.vesta.call`). Use `call('bootstrap')` para conferir efeitos. |
| `escolherPasta(dir)` | Faz a próxima janela nativa de "escolher pasta" responder `dir`. A janela nativa não é dirigível. |
| `dataDir`, `provas`, `problemas` | Pasta descartável, pasta de provas e erros do console e da página. |

Use os seletores estáveis do mapa em `features/`: `aria-label`, `data-*`, papéis e textos de título. Evite coordenadas. A jornada `jornadas/inicio.cjs` é o modelo.

## Provas

Ficam em `%TEMP%\vesta-evidencias\<data>-<jornada>\`: as capturas `NN-nome.png`, uma `falha.png` quando falha e o `relatorio.md`. A limpeza nunca apaga essa pasta. Para valer como prova, a jornada:

- passa pelo caminho do usuário, com cliques e teclas. `call` serve para conferir o resultado, não para pular a interface;
- registra a ação e o estado depois dela, não só a tela final;
- confere os efeitos colaterais: arquivo gravado, estado em `bootstrap`, backup no disco.

Erro no console ou na página reprova a jornada.

## Limpar

O `run` fecha o app, encerra as sobras dessa instância (como o `ai-memory`) e apaga a pasta de dados. Depois de uma execução interrompida, rode:

```
node .claude/skills/verify-vesta/scripts/vesta.cjs cleanup
```

Ele encerra os processos das pastas `vesta-verify-`, apaga essas pastas e as sessões do Claude Code criadas para elas, e mantém as provas.

## Mapa de features

[`features/README.md`](features/README.md) lista as áreas do app, como chegar a cada uma e o que prova que funciona. Uma verificação que cobre só uma entrada, quando o mapa lista outras, está incompleta. Quando a interface mudar, atualize o arquivo da feature junto com a mudança.
