---
name: release-vesta
description: Publica uma versão nova do VeSTA (sobe a versão, verifica, faz commit, push e a Release no GitHub que o app instalado baixa sozinho). Use só quando o usuário pedir para publicar, por exemplo "publique 0.17.0".
disable-model-invocation: true
argument-hint: <versão, ex. 0.17.0>
---

# Publicar o VeSTA $ARGUMENTS

O usuário pediu esta publicação; não peça confirmação de novo. Pare e avise se algum passo falhar.

1. **Árvore e versão.** Confira `git status`. Ponha `"version": "$ARGUMENTS"` no `package.json` (e no `package-lock.json`, nas duas entradas da raiz). A versão precisa ser maior que a última tag `v*`.
2. **Verificação.**
   - Rode `npm test`, `npm run format:check` e `npm run build`.
   - Rode os E2E das áreas mudadas desde a última tag (`git diff --stat v<anterior>..`).
   - Rode sempre `node scripts/test-ui-smoke.cjs`.
   - Só siga com tudo passando. Uma falha de IA real que passa ao repetir não bloqueia, mas registre.
3. **README.** Se a versão traz função nova, descreva-a na seção certa e liste os testes novos em "Testes".
4. **Commit e push.** Faça um commit só, com mensagem curta em português e a versão entre parênteses. Exemplo: `Memória mais enxuta e esforço por conversa (0.16.0)`. Depois rode `git push`.
5. **Release.** Rode `npm run release`. Ele exige árvore limpa e o commit no GitHub, gera o instalador e cria a Release `v$ARGUMENTS`.
6. **Conferência.**
   - `gh release view v$ARGUMENTS -R ThiagoSouzaF/VeSTA` deve mostrar `latest.yml` e `VeSTA-Setup-$ARGUMENTS.exe`.
   - Abra o app empacotado sem janela, com `VESTA_VERIFY_PACKAGED=1` e um `VESTA_DATA_DIR` temporário. Confira que acha a memória e as IAs.
7. **Resposta.** Diga ao usuário o link da Release, o que entrou e o que não foi verificado.

Nunca use `%APPDATA%\VeSTA` nos testes, nem encerre o `ai-memory.exe` por nome.
