# Mapa de features do VeSTA

Uma linha por área que o usuário toca. Cada arquivo diz como chegar, como dirigir com o helper e o que prova que funciona. Os seletores vêm de `src/components/` e de `scripts/test-ui-smoke.cjs`: quando um mudar, corrija aqui e lá.

| Feature | Arquivo | Precisa de IA real? |
|---|---|---|
| Início e projetos | [inicio-projetos.md](inicio-projetos.md) | Não |
| Conversas e composer | [conversas.md](conversas.md) | Só para resposta de verdade |
| Quests | [quests.md](quests.md) | Só para "Planejar com IA" e rodar etapas |
| Atividade e faixa de processos | [atividade.md](atividade.md) | Para tarefas vivas de verdade |
| Preferências e backup | [preferencias-backup.md](preferencias-backup.md) | Não |

Navegação comum:

- trilho lateral: `nav .nav-item` com o texto (`Conversas`, `Memória`, `Uso`, `Conexões`, `Quests`);
- Preferências: `.sidebar-bottom .nav-item` com o texto `Preferências`;
- títulos de página: `h1, h2, h3` com o texto do título.
