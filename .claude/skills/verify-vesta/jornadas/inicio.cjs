// Jornada: Início com a pasta de dados vazia, conectar uma pasta como projeto e abrir o projeto.
// node .claude/skills/verify-vesta/scripts/vesta.cjs run .claude/skills/verify-vesta/jornadas/inicio.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');

module.exports = async ({ page, dataDir, passo, foto, call, escolherPasta }) => {
  const heading = (t) => page.locator('h1, h2, h3', { hasText: t }).first();

  await passo('Início abre com o espaço pessoal e "Conectar uma pasta"', async () => {
    await heading('Em que vamos trabalhar hoje?').waitFor();
    assert.equal(await page.locator('.project-tile[data-project=personal]').count(), 1);
    assert.equal(await page.locator('.project-tile.add').count(), 1);
    await foto('inicio-vazio');
  });

  const pasta = path.join(dataDir, 'meu-projeto');
  fs.mkdirSync(pasta);
  await passo('conectar uma pasta cria o quadrado do projeto e grava no estado', async () => {
    await escolherPasta(pasta);
    await page.locator('.project-tile.add').click();
    await page.locator('.project-tile', { hasText: 'meu-projeto' }).waitFor();
    const { state } = await call('bootstrap');
    const p = state.projects.find((x) => x.name === 'meu-projeto');
    assert.ok(p, 'projeto no estado');
    assert.equal(fs.realpathSync(p.path).toLowerCase(), fs.realpathSync(pasta).toLowerCase());
    await foto('projeto-conectado');
  });

  await passo('abrir o projeto leva à tela de conversa dele', async () => {
    await page.locator('.project-tile', { hasText: 'meu-projeto' }).click();
    await page.locator('.welcome h1').waitFor();
    await foto('projeto-aberto');
  });
};
