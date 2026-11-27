// Onde rodam (pure, shared by places/ and the screen): how a VPS is reached and the steps of connecting one, each with
// the command it stands for, so the screen shows them before and the engine reports on the same list. No require.

// What the person would type to do the same by hand.
const sshLine = ({ host, port }) => 'ssh ' + (Number(port) && Number(port) !== 22 ? '-p ' + port + ' ' : '') + host;

// [label, command] of each step.
function connectPlan({ host, port } = {}) {
  const h = String(host || '').trim() || 'usuario@servidor';
  const user = h.includes('@') ? h.split('@')[0] : '$USER';
  return [
    ['Conectar', sshLine({ host: h, port }) + ' "uname -a"'],
    ['Node 18 ou mais', 'node --version'],
    ['Instalar o executor na pasta padrão', '~/.vesta-agents/runner/'],
    ['Agendador sem login aberto', 'loginctl enable-linger ' + user],
    ['Procurar as IAs', 'command -v claude codex opencode'],
  ];
}

module.exports = { sshLine, connectPlan };
