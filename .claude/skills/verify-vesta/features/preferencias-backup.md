# Preferências e backup

Tema, zoom, mascote, atualizações, controle remoto e backup (.zip local, senha opcional, Google Drive).

## Sub-features

- Índice que pula para a seção (7 seções).
- Backup agora: grava o .zip e mostra o último backup.
- Backup com senha: o próximo backup sai `.vesta`.
- Frequência do backup automático.
- Google Drive: começa em "configurar", com o passo a passo.
- "Mostrar a mascote" esconde e mostra o avatar, e a escolha persiste.
- Zoom em porcentagem, que persiste ao reiniciar.
- "Sobre a VeSTA", com a versão.

## How to get to it (user POV)

Engrenagem no pé do trilho: `.sidebar-bottom .nav-item` com o texto `Preferências`. O título da página é "Seu lar. Seu estilo.".

## Driving it with vesta.cjs

- **Índice:** `.settings-index button` com o nome da seção. A seção é `[data-section=<nome>]`, por exemplo `backup`.
- **Backup agora:**
  1. Em `[data-section=backup]`, clique no papel `button` "Fazer backup agora".
  2. Espere `[data-backup-last]` conter "Último backup".
  3. Prova: `call('backupStatus').lastFile` existe no disco e se chama `VeSTA-backup-AAAA-MM-DD-HHMM.zip`.
- **Frequência:** `getByLabel('Frequência do backup automático').selectOption('weekly')`. Confira `call('backupStatus').auto`.
- **Drive:** `[data-drive]` com `data-drive="setup"`, mais o botão "Escolher o JSON do cliente".
- **Interruptores:** papel `switch` com o nome. O estado fica em `aria-checked`.

## Gotchas

- Com `VESTA_DATA_DIR`, o backup padrão fica dentro da própria pasta de dados (`electron/backup/methods.cjs`), não em `Documentos\VeSTA-backups`. Confira que `lastFile` começa com `v.dataDir`. Se a jornada escolher outra pasta, apague o arquivo no fim.
- Login no Google e restauração precisam de conta real. Não dirija esses fluxos. O E2E `test-drive-e2e` usa `scripts/fake-google.cjs`.
- A senha do backup fica no cofre do Windows (DPAPI). Use uma senha de teste e remova-a no fim.
