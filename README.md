# Omphalos

Um aplicativo desktop para reunir suas IAs, projetos, conversas e memória compartilhada.

## Abrir

Execute `release/Omphalos-Setup-0.1.1.exe` para instalar para seu usuário do Windows. O instalador cria o atalho **Omphalos** no menu Iniciar e registra a desinstalação nas configurações do Windows. Seus chats e memórias existentes são mantidos em `%APPDATA%/Omphalos`. Não precisa instalar Node.js para usar o aplicativo. Codex, Claude Code e OpenCode devem estar instalados e autenticados no computador.

A versão portátil anterior, `release/Omphalos-0.1.0.exe`, também continua disponível, com o ícone antigo. A versão instalada 0.1.1 usa o novo símbolo de axis mundi: um eixo central luminoso atravessando órbitas, com núcleo em forma de cristal e cores ciano/violeta.

## O que já funciona

- ChatGPT pelo Codex CLI, Claude pelo Claude Code e Drael pelo OpenCode configurado no computador.
- Vários chats independentes, inclusive simultâneos, com retomada da sessão nativa e histórico local.
- Projetos vinculados a pastas, executados com o diretório de trabalho correto.
- Uso dos arquivos de instruções nativos: AGENTS.md, CLAUDE.md e configuração do OpenCode. O aplicativo não os substitui nem os reescreve.
- Temas Obsidiana, Aurora e Papel; quatro cores de destaque; escolhas persistentes.
- Markdown, atividades das ferramentas, cancelamento, renomeação, exclusão e exportação de conversas.
- Botão no canto inferior direito para retomar o chat no terminal nativo quando uma tarefa precisar de interação ou aprovação.
- AI Memory 3.0.0 real, incluído no executável, conectado por MCP via stdio. Nenhuma porta de rede é aberta pelo motor de memória.
- Busca no contexto do projeto; preferências pessoais compartilhadas entre todas as IAs; gravação, edição e exclusão de memórias.

## Primeiro uso

1. Clique em **Adicionar projeto** e escolha a pasta de um projeto, ou use o espaço pessoal.
2. Clique em **Novo chat**, escolha a IA, o projeto e o modo de trabalho. Deixe o modelo vazio para usar o padrão do programa. Para Drael, o modelo inicial é `drael/drael-v1`.
3. Escreva a primeira mensagem. A IA usa sua conta já autenticada no programa correspondente.
4. Em **Memória**, adicione suas preferências pessoais (como idioma e organização de arquivos) ou notas específicas de um projeto.
5. Em **Preferências**, escolha o tema, a cor e se quer gravar trechos das conversas.

Atalhos: **Ctrl+N** abre um novo chat; **Ctrl+K** busca conversas; **Enter** envia; **Shift+Enter** insere nova linha.

## Memória e dados

Os dados ficam em `%APPDATA%/Omphalos`. A pasta pode ser aberta nas preferências. `omphalos.json` contém chats e o catálogo de notas; `memory/` contém o armazenamento Markdown e o índice do AI Memory. Faça backup da pasta inteira com o aplicativo fechado.

O motor de memória funciona offline por busca textual (FTS), sem API, conta adicional ou download de modelo de embeddings. O suporte do AI Memory nativo ao Windows é experimental. A integração do Omphalos não instala hooks nem altera as configurações globais de outros agentes; vale para os chats iniciados aqui.

Com a captura habilitada, cada resposta concluída guarda um trecho da pergunta (até 6 mil caracteres) e da resposta (até 10 mil) como memória episódica. Isso não gera automaticamente um perfil de preferências: registre preferências duráveis na tela Memória. As notas de um projeto são isoladas das de outro; preferências pessoais são compartilhadas. A busca acrescenta apenas um contexto limitado ao próximo pedido da IA. Padrões comuns de chaves são removidos dos trechos guardados; essa filtragem não garante detectar todo segredo possível.

As mensagens e o contexto recuperado são enviados ao provedor selecionado usando sua assinatura/chave e estão sujeitos aos limites e à cobrança dessa conta. A Drael continua sendo um serviço pago acessado pelo OpenCode. ChatGPT aqui é a experiência do Codex CLI, não uma importação dos chats do site do ChatGPT.

## Modos de trabalho

**Consultar** usa sandbox de leitura no Codex, modo plan no Claude e plan com edição e comandos negados no OpenCode. **Editar projeto** permite escrita no workspace do Codex e edições no Claude/OpenCode conforme as regras nativas. O aplicativo não ativa opções de bypass geral. Pedidos de aprovação que não podem ser resolvidos em modo não interativo precisam ser retomados no terminal. Não há navegador embutido, controle visual do PC, voz ou anexos nesta versão.

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
npm run dist
npm run installer
```

Os testes de integração usam pastas temporárias próprias, independentes da localização do checkout. O teste dos provedores realiza duas chamadas curtas em cada conta configurada. `runtime/ai-memory.exe` veio da versão oficial v3.0.0, com SHA-256 verificado. Para reconstruir em outro checkout, consulte `scripts/download-memory.ps1`. Dependências, executáveis gerados, runtime baixado, credenciais, chats e memórias não entram no Git.

## Referências

- [AI Memory](https://aimemory.sh/pt-br/) e [código / licença MIT](https://github.com/akitaonrails/ai-memory)
- [Codex não interativo](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Claude Code programático](https://code.claude.com/docs/en/headless)
- [OpenCode CLI](https://opencode.ai/docs/cli/)
- [Drael](https://drael.sh/)
