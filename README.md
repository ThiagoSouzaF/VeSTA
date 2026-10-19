# VeSTA

O centro do seu lar digital: um aplicativo desktop para reunir suas IAs, projetos, conversas e memória compartilhada. O nome vem de Vesta, a deusa romana do lar e do fogo no centro da casa; o **e** minúsculo é a chama digital.

## Abrir

Instale com o `VeSTA-Setup-<versão>.exe` da [última Release](https://github.com/ThiagoSouzaF/VeSTA/releases/latest) para o seu usuário do Windows. O instalador cria o atalho **VeSTA** no menu Iniciar e registra a desinstalação nas configurações do Windows.

A mascote é a própria Vesta, em mangá preto e branco: guardiã da chama, com a balança de Libra (o equilíbrio entre as IAs), o jarro de Aquário (o fluxo de dados) e vendada como a justiça. Ela muda de pose conforme o que as IAs estão fazendo (parada, pensando, trabalhando, sucesso, erro, dormindo) e pode ser escondida nas preferências; a página **Conheça a VeSTA** conta a história. Nas preferências dá para escolher o fundo da área principal: **Liso**, **Brasa** (fagulhas subindo), **Chuva de código** (caracteres caindo, bem de leve; no tema Tinta Mangá vira uma chuva monocromática de filme antigo, com granulação, vinheta e cintilação), **Chuva em tinta** (essa mesma chuva, em qualquer tema) ou **Fluxo de texto** (palavras atravessando a tela), sempre nas cores do tema e mais calmos no centro, onde se lê a conversa. Com "reduzir movimento" ligado no Windows, o fundo fica parado. Há também a cor de destaque **Brasa**.

## O que já funciona

- ChatGPT pelo Codex CLI, Claude pelo Claude Code e Drael pelo harness oficial ou pelo OpenCode configurado no computador.
- Vários chats independentes, inclusive simultâneos, com retomada da sessão nativa e histórico local.
- Projetos vinculados a pastas, executados com o diretório de trabalho correto.
- Uso dos arquivos de instruções nativos: AGENTS.md, CLAUDE.md e configuração do OpenCode. O aplicativo não os substitui nem os reescreve.
- Tema **Tinta Mangá** (padrão): preto e branco puros, cantos retos, sombras duras, hachura no lugar do vermelho, fontes Space Grotesk e Space Mono embutidas (funciona offline) e chuva de código em tinta, estilo filme antigo. Seguem disponíveis Obsidiana, Aurora e Papel, com quatro cores de destaque; escolhas persistentes.
- Tela de abertura (splash) com a Vesta e uma barra que acompanha as etapas reais do início: dados, memória, IAs e interface.
- Markdown, atividades das ferramentas, cancelamento, renomeação, exclusão e exportação de conversas.
- Três modos por conversa: **Pedir permissão**, **Acesso completo** e **Consulta**. No modo Pedir permissão, quando a IA ou um dos seus subagentes precisa rodar um comando ou alterar arquivos, o pedido aparece na própria conversa com **Permitir**, **Sempre nesta conversa** (vale para o mesmo programa, como `npm …`, ou para a mesma ferramenta) e **Negar**. A lista de conversas marca as que estão esperando você, e a janela pisca se estiver em segundo plano. No Acesso completo, o Claude ainda pergunta antes de mexer em arquivos protegidos (configurações, `.git`), e esses pedidos também chegam aqui.
- Para responder aos pedidos, o VeSTA conversa com cada programa pelo canal próprio dele: o Claude por stream-json (o mesmo protocolo do Agent SDK), o Codex pelo `codex app-server` e o OpenCode pelo `opencode serve` (HTTP só em `127.0.0.1`, com senha aleatória). Nada é gravado nas configurações globais desses programas.
- Botão no canto inferior direito para retomar o chat no terminal nativo.
- AI Memory 3.0.0 real, incluído no executável. O VeSTA inicia um único servidor MCP HTTP só em `127.0.0.1`, numa porta livre e com token aleatório a cada execução; o aplicativo e os agentes que ele abre usam esse mesmo servidor.
- Agentes com acesso à memória (opção nas preferências, ligada por padrão): Claude, Codex e OpenCode recebem as ferramentas do AI Memory (`memory_query`, `memory_write_page` e as demais) apenas nas sessões abertas pelo VeSTA, via `--mcp-config`, `-c mcp_servers...` e `OPENCODE_CONFIG_CONTENT`. Cada chat é orientado a usar o workspace `vesta` e o projeto do chat.
- Busca no contexto do projeto; preferências pessoais compartilhadas entre todas as IAs; gravação, edição e exclusão de memórias.
- **Atividade**: todo o trabalho em paralelo de todas as IAs, ao vivo e em árvore (turno → subagentes → comandos, ferramentas, tarefas em segundo plano e Monitor), com tempos, detalhes, filtros e Parar (por chat; por tarefa no Claude). A barra lateral mostra quantas tarefas rodam em cada chat.
- **Quests**: dê um objetivo e as IAs trabalham juntas. Uma IA planeja (ou você monta o plano), cada etapa vai para a IA escolhida num chat próprio, os resultados passam de uma etapa para a seguinte e ficam no AI Memory, e o quadro mostra Pendentes, Rodando, Concluídas e Problemas.
- **Uso por IA**: janelas oficiais do plano do Claude (5 h e semanal) e do Codex (lidas do `codex app-server`), além de tokens e custo por dia de cada IA.
- **Leitura confortável**: zoom do texto de 80% a 160% (**Ctrl +**, **Ctrl −**, **Ctrl 0** ou Ctrl+roda); a conversa só rola sozinha se você estiver no fim, com botão para descer até o fim.

## Primeiro uso

1. Clique em **Adicionar projeto** e escolha a pasta de um projeto, ou use o espaço pessoal.
2. Clique em **Novo chat**, escolha a IA, o projeto e o modo de trabalho. Deixe o modelo vazio para usar o padrão do programa. Para Drael, o modelo inicial é `drael/drael-v1`.
3. Escreva a primeira mensagem. A IA usa sua conta já autenticada no programa correspondente.
4. Em **Memória**, adicione suas preferências pessoais (como idioma e organização de arquivos) ou notas específicas de um projeto.
5. Em **Preferências**, escolha o tema, a cor e se quer gravar trechos das conversas.

Atalhos: **Ctrl+N** abre um novo chat; **Ctrl+K** busca conversas; **Enter** envia; **Shift+Enter** insere nova linha; **Ctrl +/−/0** ajusta o zoom do texto; **End** vai ao fim da conversa.

## Memória e dados

Os dados ficam em `%APPDATA%/VeSTA`. A pasta pode ser aberta nas preferências. `vesta.json` contém chats e o catálogo de notas; `memory/` contém o armazenamento Markdown e o índice do AI Memory. Faça backup da pasta inteira com o aplicativo fechado.

O motor de memória funciona offline por busca textual (FTS), sem API, conta adicional ou download de modelo de embeddings. O suporte do AI Memory nativo ao Windows é experimental. A integração do VeSTA não instala hooks nem altera as configurações globais de outros agentes (`~/.claude`, `~/.codex`, configuração global do OpenCode); vale para os chats iniciados aqui.

Com a captura habilitada, cada resposta concluída guarda um trecho da pergunta (até 6 mil caracteres) e da resposta (até 10 mil) como memória episódica. Isso não gera automaticamente um perfil de preferências: registre preferências duráveis na tela Memória. As notas de um projeto são isoladas das de outro; preferências pessoais são compartilhadas. A busca acrescenta apenas um contexto limitado ao próximo pedido da IA. Padrões comuns de chaves são removidos dos trechos guardados; essa filtragem não garante detectar todo segredo possível.

As mensagens e o contexto recuperado são enviados ao provedor selecionado usando sua assinatura/chave e estão sujeitos aos limites e à cobrança dessa conta. A Drael continua sendo um serviço pago acessado pelo OpenCode. ChatGPT aqui é a experiência do Codex CLI, não uma importação dos chats do site do ChatGPT.

## Modos de trabalho

**Consulta** usa sandbox de leitura no Codex, modo plan no Claude e plan com edição e comandos negados no OpenCode. **Pedir permissão** deixa a IA trabalhar, mas cada comando ou alteração de arquivo passa por você na conversa. **Acesso completo** deixa a IA editar arquivos e rodar comandos sem perguntar (sem sandbox no Codex, permissões ignoradas no Claude, edição e comandos liberados no OpenCode); use só em projetos em que confia. O botão de terminal abre a sessão nativa no mesmo modo do chat. Não há navegador embutido, controle visual do PC, voz ou anexos nesta versão.

## Controle remoto pelo celular

O VeSTA pode ser controlado pelo celular com um app web instalável (PWA): conversas com streaming, atividade, quests, uso e pedidos de permissão com Permitir/Negar. **Atenção:** as IAs do VeSTA têm acesso completo ao computador (leem e editam arquivos, rodam comandos). Quem estiver pareado controla tudo isso; pareie só aparelhos seus.

**Pré-requisito: Tailscale.** Para usar o celular é preciso o [Tailscale](https://tailscale.com/download), gratuito, que cria uma rede privada e criptografada entre o computador e o celular. Não existe modo de rede local (LAN): HTTP puro deixaria token e código expostos a qualquer aparelho do Wi-Fi. Passo a passo: (1) instale o Tailscale no computador e no celular e entre na mesma conta; (2) em Preferências, **Controle remoto**, escolha **Somente Tailscale** e ligue o interruptor; (3) clique em **Parear novo aparelho**, escaneie o QR code com a câmera do celular (a página abre com o código de uso único, que vale 5 minutos, e pede só o nome do aparelho) e **autorize o aparelho no diálogo que aparece no desktop**. Sem o Tailscale só resta "Somente este computador" (para testes).

**Pareamento e expiração.** O código sozinho não basta: depois de trocá-lo, o desktop mostra um diálogo nativo "Autorizar o aparelho '<nome>' (IP) a controlar o VeSTA?" e só emite o token se você clicar **Autorizar** (sem resposta em 2 minutos conta como recusa). Cada pareamento e o primeiro uso de cada sessão de um aparelho geram um aviso no desktop. O aparelho expira após 30 dias sem uso ou 180 dias depois de pareado (cada acesso renova o prazo de inatividade) e precisa parear de novo; o celular mostra a mensagem. Os aparelhos pareados ficam na lista, onde podem ser renomeados ou revogados (a revogação derruba a conexão na hora).

**Modos de acesso pelo celular.** Chats e etapas de quest criados pelo celular nascem em **Pedir permissão** quando o modo não é informado. Dar **Acesso completo** pelo celular (criar chat em acesso completo, trocar um chat para acesso completo ou criar/iniciar uma quest com etapas em acesso completo) exige confirmação no desktop; recusa ou falta de resposta devolve 403 com a explicação.

**Interfaces.** O servidor vem **desligado**, escuta na porta 47900 (configurável) e nunca em `0.0.0.0`:

- **Somente Tailscale** (padrão quando o Tailscale é detectado): só aparelhos da sua conta Tailscale chegam ao VeSTA. Também escuta em `127.0.0.1` para o `tailscale serve`. O endereço vem da CLI (`tailscale status --json` / `tailscale ip -4`); sem a CLI, só vale uma interface cujo nome indique Tailscale com IP em `100.64.0.0/10`. Endereços dessa faixa de WSL, Docker ou operadoras nunca são tratados como Tailscale.
- **Somente este computador** (`127.0.0.1`).
- Quem tinha a antiga "Rede local (LAN)" salva volta com o controle remoto desligado e um aviso.

**HTTPS pelo Tailscale (recomendado).** Instale o [Tailscale](https://tailscale.com/download) no computador e no celular, entre na mesma conta e ative o MagicDNS e o HTTPS no painel do Tailscale. Em Preferências, **Publicar com HTTPS no seu Tailscale** executa `tailscale serve --bg --https=443 http://127.0.0.1:<porta>` e mostra a URL `https://<máquina>.<tailnet>.ts.net`; **Desfazer publicação** executa `tailscale serve --https=443 off`. Antes de publicar o VeSTA consulta `tailscale serve status --json`: se a porta 443 já estiver em uso por outra coisa, não altera nada e explica. Só desfaz a publicação que ele mesmo criou (ao desligar, ao trocar a porta e ao fechar o app); uma configuração sua nunca é tocada. A CLI é procurada primeiro em `%ProgramFiles%\Tailscale\tailscale.exe`, e no PATH só como último recurso. Com HTTPS o navegador oferece **Instalar app / Adicionar à tela inicial** e libera notificações. Sem HTTPS o app funciona normalmente, sem instalação e sem service worker.

**Segurança.**

- Pareamento: código aleatório de 144 bits, uso único, 5 minutos; o celular o troca por um token de aparelho de 256 bits. O desktop guarda só o SHA-256 do token; a comparação é em tempo constante.
- O token só trafega no header `Authorization: Bearer`; no WebSocket vai na primeira mensagem, nunca na URL. O código de pareamento fica no fragmento da URL (`#pair=`), que o navegador não envia ao servidor, e é apagado da barra de endereço.
- Limite de tentativas por IP (pareamento e autenticação) com bloqueio temporário de 5 minutos. Atrás do `tailscale serve` (conexão vinda de 127.0.0.1) a chave é o IP do último valor de `X-Forwarded-For`; um processo local poderia forjar esse cabeçalho, o que é aceitável porque um processo local já tem acesso ao PC. Requisições com token válido nunca são barradas pelo limitador de falhas; há ainda um teto generoso por aparelho (600 requisições por minuto).
- Conexões ainda não autenticadas: no máximo 8 por IP, uma parcela do total reservada para aparelhos autenticados, e sockets ociosos sem autenticação são fechados em 10 s.
- Erros inesperados devolvem uma mensagem genérica ao celular; o detalhe fica só no log local. `/api/health` responde apenas `{"ok":true}`. Erros tardios do servidor são registrados e não derrubam o app.
- Allowlist explícita: `bootstrap`, `send`, `stop`, `stopTask`, `answerPermission`, `createChat` (só em projeto existente ou espaço pessoal), `updateChat` (modelo e modo), `usage`, `refreshUsage` e os controles de quest (criar, planejar, iniciar, pausar, retomar, cancelar, tentar de novo, pular). Todo o resto responde 403: adicionar projeto, abrir pastas ou terminal, preferências, excluir chats, memória, exportar, atualizações e o gerenciamento do próprio controle remoto (que só existe no desktop). Argumentos são validados e limitados.
- O estado enviado ao celular é sanitizado (sem memórias, caminhos de projetos, ids de sessão, executáveis ou hashes) e traz só as últimas 80 mensagens de cada chat.
- Cabeçalhos: CSP restrita, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors 'none'`, sem CORS (origens externas recebem 403), verificação do `Host` contra DNS rebinding, corpo HTTP limitado a 256 KB.

**Eventos.** O servidor assina o barramento de eventos do app e retransmite aos sockets autenticados, agrupando os deltas de texto (~50 ms). Se um socket fica lento, os eventos são descartados e o app recebe um pedido de recarga; o celular reconecta sozinho com espera crescente e confere um heartbeat de 20 s.

**Limitações.** Avisos de permissão só chegam com o app aberto ou em segundo plano no celular (não há servidor de push). A versão nativa fica para depois. O celular vê as últimas 80 mensagens de cada chat; o histórico completo fica no desktop.

Desenvolvimento do app móvel: `npm run dev:mobile` (Vite) e `npm run build` (gera `dist/` e `dist-mobile/`, ambos empacotados). Testes: `npm test` (unidades, inclusive servidor HTTP/WS real em localhost) e `node scripts/test-remote-e2e.cjs` (abre o app, pareia e usa o app móvel com Playwright em 390x844; envia uma mensagem real ao Claude haiku, a menos que `VESTA_E2E_NO_AI=1`; screenshots em `VESTA_SHOTS`). O E2E nunca roda `tailscale serve` e só usa `127.0.0.1`. Ele responde sozinho aos diálogos de confirmação com `VESTA_TEST_AUTO_CONFIRM=1` (`deny` recusa); a variável é ignorada pelo app empacotado.

## Desenvolvimento

Requer Node.js 22+ e Windows x64.

```text
npm ci
powershell -File scripts/download-memory.ps1
node scripts/icon.cjs
npm run build
npm start
npm test
node scripts/test-memory.cjs
node scripts/test-providers.cjs
npx electron scripts/test-permissions.cjs claude allow
npx electron scripts/test-claude-background.cjs
npx electron scripts/test-claude-stale-task.cjs
npx electron scripts/test-memory-agent.cjs claude
node scripts/test-remote-e2e.cjs
node scripts/test-splash-e2e.cjs
npm run dist
npm run installer
npm run release
```

## Atualizações

A versão instalada procura, ao abrir, a última Release de [ThiagoSouzaF/VeSTA](https://github.com/ThiagoSouzaF/VeSTA/releases) usando o login do GitHub CLI (`gh`) da máquina, já que o repositório é privado. Se a versão for maior, pergunta antes de atualizar; com **Atualizar agora**, baixa o instalador, confere o SHA-512 registrado no `latest.yml`, fecha o VeSTA, instala em modo silencioso e abre de novo. Também há o botão **Procurar atualizações** nas preferências. A versão portátil e a execução em desenvolvimento não se atualizam sozinhas.

Para publicar: aumente `version` no `package.json`, faça commit e push, e rode `npm run release`. O script exige árvore limpa e o commit já no GitHub, gera o instalador e cria a Release `v<versão>`. O instalador é publicado como `VeSTA-Setup-<versão>.exe`, e o `appId` é `app.vesta.desktop`.

Os testes de integração usam pastas temporárias próprias, independentes da localização do checkout. O teste dos provedores realiza duas chamadas curtas em cada conta configurada. `test-permissions.cjs` (`claude`, `codex` ou `opencode`, mais `allow`, `deny`, `subagent`, `always` ou `stop`) faz a IA real pedir permissão para um `mkdir` e confere o efeito de cada resposta. `test-memory-agent.cjs` (argumento `claude`, `codex` ou `opencode`) faz o agente real consultar e gravar no AI Memory por MCP numa pasta temporária. `runtime/ai-memory.exe` veio da versão oficial v3.0.0, com SHA-256 verificado. Para reconstruir em outro checkout, consulte `scripts/download-memory.ps1`. Dependências, executáveis gerados, runtime baixado, credenciais, chats e memórias não entram no Git.

## Referências

- [AI Memory](https://aimemory.sh/pt-br/) e [código / licença MIT](https://github.com/akitaonrails/ai-memory)
- [Codex não interativo](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Claude Code programático](https://code.claude.com/docs/en/headless)
- [OpenCode CLI](https://opencode.ai/docs/cli/)
- [Drael](https://drael.sh/)

### Harness nativo Drael

Dentro de cada conversa, o seletor de IA ao lado do modelo permite trocar entre ChatGPT, Claude, Drael e Drael (OpenCode). A troca abre uma sessão nativa nova e transfere o histórico textual na próxima mensagem, mantendo a autoria das respostas anteriores. Voltar a uma IA também abre uma sessão nova para incluir as mensagens das outras IAs. O histórico transferido é limitado a 120 mil caracteres; o aplicativo bloqueia a troca acima desse limite sem descartar mensagens. O modelo volta ao padrão da IA escolhida e as permissões lembradas são limpas. O modo de trabalho é mantido, exceto Pedir permissão no Drael nativo, que passa para Consultar. A troca fica bloqueada durante uma resposta. O histórico enviado ao novo provedor pode consumir mais tokens; estados internos, anexos e resultados completos de ferramentas não são transferidos.

Instale pelo procedimento oficial em https://drael.sh/docs/install. No VeSTA, selecione **Drael · harness nativo** para novos chats. A integração detecta `%LOCALAPPDATA%/Drael` e usa o login nativo, `DRAEL_KEY` ou a chave local já configurada para o host oficial no OpenCode, sem copiá-la para as conversas.

O modo de leitura usa `plan`; acesso completo usa `bypass`, respeitando as regras de negação nativas. O modo automatizado atual não recebe aprovações interativas: use o terminal ou Drael (OpenCode) para esse fluxo. O histórico do chat fica no VeSTA e é reenviado em cada turno (até 120 mil caracteres); o terminal abre uma conversa própria. O modelo é `drael-v1`, com o esforço definido na configuração nativa. MCP recebe o endpoint e token temporários por ambiente; nenhuma configuração do projeto é sobrescrita. Em leitura, o VeSTA fornece contexto recuperado, mas o Drael não recebe ferramentas MCP.
