# Validação da versão 0.1.0

Verificações realizadas em 15 de outubro de 2026, nesta máquina Windows.

| Verificação | Resultado |
|---|---|
| Compilação da interface React/Vite | Passou |
| Testes de persistência e isolamento de chats, sessões, parsers e escopos | 5 testes passaram |
| ChatGPT pelo Codex: resposta real e retomada lembrando um código da primeira mensagem | Passou |
| Claude Code: resposta real e retomada lembrando um código da primeira mensagem | Passou |
| Drael pelo OpenCode: resposta real e retomada lembrando um código da primeira mensagem | Passou |
| AI Memory real: gravar, buscar, excluir, isolar projetos e compartilhar preferências | Passou |
| Serviços do app: recuperar preferência por MCP, enviar à Drael, salvar resposta e sessão | Passou |
| App empacotado: encontrar os três programas e iniciar o AI Memory incluído nos recursos | Passou |
| Auditoria npm das dependências de produção | Nenhuma vulnerabilidade reportada |

A página inicial foi inspecionada visualmente no aplicativo desktop. A revisão adicional por cliques foi interrompida pelo usuário com Esc; por isso não se afirma que todos os fluxos da interface foram exercitados manualmente. Os testes de serviços não automatizam a interface nem substituem essa revisão.

Versão beta: o aplicativo não inclui voz, anexos, navegador embutido ou automação visual do computador. Aprovações interativas que os programas exigirem devem ser resolvidas no terminal nativo. O suporte nativo ao Windows do próprio AI Memory é experimental.
