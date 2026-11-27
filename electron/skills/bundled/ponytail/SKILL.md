---
name: ponytail
description: Use quando a pessoa pedir para enxugar, auditar e corrigir um repositório de ponta a ponta com o Ponytail ("/ponytail", "passa o ponytail", "menos código, mais funcionalidade", "corrige o que tiver de errado no repo"). Audita o repositório, corrige numa branch nova (um commit por conserto, com testes), revisa o próprio trabalho e termina com um relatório do que mudou, do que ficou e do que depende da pessoa.
version: 1
---

# Ponytail: do diagnóstico ao relatório

Você vai passar o Ponytail no repositório desta conversa, sozinho, do começo ao fim: auditar, corrigir, revisar e relatar. O método é o do [Ponytail](https://github.com/DietrichGebert/ponytail) (MIT). Os textos originais estão nos arquivos desta skill. Leia cada um com a ferramenta `vesta_skill_file` (name `ponytail`) no passo em que ele entra:

- `regras.md`: como escrever cada conserto. Vale do passo 3 ao fim.
- `auditoria.md`: como auditar o repositório (passo 2).
- `revisao.md`: como revisar a sua própria branch (passo 4).
- `dividas.md`: como listar os atalhos `shortcut:` (passo 5).

Os originais estão em inglês. Siga o método deles, mas escreva tudo para a pessoa em português do Brasil.

O pedido pode limitar o trabalho a uma pasta ("só `src/api`") ou ao relatório ("só auditar"). Com "só auditar", pare depois do passo 2, entregue a auditoria e não mude nada.

## 1. Prepare o terreno

1. Confirme que é um repositório git. Se não for, pare e diga isso.
2. Rode `git status`. **Com mudanças não commitadas, pare** e pergunte: você nunca mistura o seu trabalho com o que a pessoa ainda não salvou.
3. Anote a branch e o commit atuais (a **base**). Crie a branch `ponytail/<AAAA-MM-DD>` a partir deles. Todo o trabalho fica nela.
4. Descubra como o projeto roda os testes, o lint e o build (README, `package.json`, `Makefile`, `go.mod`, `pyproject.toml`, CI). Rode os testes agora e anote o resultado: falhas que já existiam não são culpa sua, mas entram no relatório.

Pronto quando: você está na branch nova, sabe o comando dos testes e tem o resultado de antes.

## 2. Audite

Leia `auditoria.md` e faça a auditoria do jeito que ele manda: mapear primeiro, achados com caso concreto, numerados, em **Corrigir já** (Must fix), **Deveria corrigir** (Should fix) e **Seria bom** (Nice to have).

Mostre a auditoria à pessoa numa mensagem e siga para o passo 3 sem esperar. Ela pode interromper quando quiser.

## 3. Corrija, um achado por vez

Leia `regras.md` antes do primeiro conserto. Vá na ordem da auditoria: todos os **Corrigir já**, depois os **Deveria corrigir**. Dos **Seria bom**, corrija só os que somem código ou cabem numa linha.

Para cada achado:

1. Faça o menor conserto completo, como `regras.md` manda. Alcance os chamadores, os testes e os fixtures que ele quebra. Lógica nova com risco ganha um teste pequeno.
2. Rode os testes e, se o projeto tiver, o lint e o build.
3. Passou: faça um commit só deste achado, com a mensagem `ponytail: <número>. <título do achado>`.
4. Quebrou: tente consertar no máximo duas vezes. Se não der, desfaça o que mudou neste achado com `git reset --hard HEAD` e `git clean -fd` (a árvore estava limpa no começo e cada conserto que passou já tem commit, então só este sai) e marque o achado como **não feito**, com o motivo.

**Não faça sozinho. Deixe para a pessoa decidir:**

- mudanças que alteram o que o usuário final vê ou faz;
- apagar uma funcionalidade inteira;
- migrações e mudanças em dados guardados;
- trocar ou adicionar dependências (remover uma que ninguém usa pode);
- tudo que mexe com segredos, contas ou produção.

Cada um entra no relatório em **Depende de você**, com o conserto proposto.

Nunca faça push, merge, deploy ou release. Nunca apague a branch base.

## 4. Revise o próprio trabalho

Leia `revisao.md` e revise o diff inteiro da base até a sua branch (`git diff <base>...HEAD`), lendo também o código que ele toca.

Corrija cada **Corrigir já** que a revisão achar, com o mesmo ciclo do passo 3: testes, um commit e desfazer o que quebrar. Depois revise só esses novos commits mais uma vez. Pare aí, mesmo que sobre algo: o que sobrar vai para o relatório.

## 5. Liste as dívidas

Siga `dividas.md` e liste os comentários `shortcut:`, os antigos e os que você deixou.

## 6. Relatório final

Rode os testes uma última vez e `git diff --stat <base>...HEAD`. Termine com este relatório, em português simples e sem pular seções (escreva "nada" quando uma estiver vazia):

```
## Ponytail em <repositório>

**Resumo:** <duas ou três frases: o que o repo faz, o que mudou e o estado em que ficou>

**Branch:** ponytail/<data>, a partir de <base> (<commit>). Nada foi enviado nem juntado.
**Números:** <N> commits · +<linhas> −<linhas> · testes antes: <resultado> · depois: <resultado>

### Corrigido
1. <título>: <o que estava errado e o que mudou, uma frase> (`<commit curto>`, `<arquivo>`)

### Depende de você
- <número>. <título>: <o que é, o conserto proposto e o que acontece se não fizer>

### Não feito
- <número>. <título>: <por que não deu>

### Dívidas (`shortcut:`)
- <arquivo:linha>, <limite>, <quando revisitar>

### Não checado
- <o que você não leu ou não conseguiu rodar>

**Como usar:** `git diff <base>...ponytail/<data>` para ver tudo. Para juntar: `git checkout <base>` e `git merge ponytail/<data>`. Para descartar: `git checkout <base>` e `git branch -D ponytail/<data>`.
```

Se a memória compartilhada do VeSTA estiver ligada, grave com `memory_write_page` (path `ponytail/<data>.md`) uma nota curta no projeto, com a data, a branch e os números. Não grave a lista inteira.
