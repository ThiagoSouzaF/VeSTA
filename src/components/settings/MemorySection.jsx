import { Brain } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { SettingToggle } from './SettingToggle';

// One switch per entry: `on` reads the setting, `toggle` returns the patch that flips it. Several settings are
// on unless explicitly false, so each carries its own default.
const TOGGLES = [
  {
    title: 'Usar memória compartilhada',
    description: 'Consulta o AI Memory e suas preferências antes de cada resposta.',
    on: (s) => s.memoryEnabled,
    toggle: (s) => ({ memoryEnabled: !s.memoryEnabled }),
  },
  {
    title: 'Aprender com as conversas',
    description:
      'Cada conversa vira uma sessão no AI Memory: seus pedidos, as ferramentas usadas e um trecho da resposta. Depois de 30 minutos sem mensagens (ou ao trocar de IA ou de projeto) a sessão é encerrada.',
    on: (s) => s.capture !== false,
    toggle: (s) => ({ capture: s.capture === false }),
  },
  {
    title: 'Consolidar com IA (Codex)',
    description:
      'Ao encerrar a sessão, o Codex resume a conversa e extrai regras, armadilhas e decisões em páginas próprias, usando o seu login do Codex (consome a cota do ChatGPT; o conteúdo da conversa vai para a OpenAI, mesmo em chats do Claude). Desligado, a sessão fica só com um resumo automático, sem IA.',
    on: (s) => s.memoryConsolidate === 'codex',
    toggle: (s) => ({ memoryConsolidate: s.memoryConsolidate === 'codex' ? 'off' : 'codex' }),
    disabled: (s) => s.capture === false,
  },
  {
    title: 'Guardar também a conversa bruta',
    description:
      'Modo antigo: salva cada resposta inteira (até 6 mil caracteres da pergunta e 10 mil da resposta) como uma página. Gera muito volume; deixe desligado se a consolidação estiver ativa.',
    on: (s) => !!s.captureRaw,
    toggle: (s) => ({ captureRaw: !s.captureRaw }),
  },
  {
    title: 'Agentes podem consultar e gravar na memória',
    description:
      'Claude, Codex e OpenCode recebem as ferramentas do AI Memory só nas sessões abertas pelo VeSTA, para buscar decisões anteriores e registrar o que aprenderam neste projeto. Nada muda nas configurações globais desses programas.',
    on: (s) => s.memoryTools !== false,
    toggle: (s) => ({ memoryTools: s.memoryTools === false }),
  },
  {
    title: 'Os chats podem mudar as preferências',
    description:
      'Peça numa conversa (“mude o tema para Papel”, “faça um backup agora”) e a IA ajusta o VeSTA. Conectar o Google Drive, restaurar backups e o controle pelo celular continuam só aqui. Chats em Só consulta apenas leem.',
    on: (s) => s.chatSettings !== false,
    toggle: (s) => ({ chatSettings: s.chatSettings === false }),
  },
];

export function MemorySection({ settings, setting }) {
  return (
    <SettingsSection
      id="memory"
      icon={Brain}
      title="Memória e continuidade"
      description="Você decide o que acompanha suas conversas."
    >
      {TOGGLES.map((t) => (
        <SettingToggle
          key={t.title}
          title={t.title}
          description={t.description}
          checked={t.on(settings)}
          disabled={t.disabled?.(settings)}
          onChange={() => setting(t.toggle(settings))}
        />
      ))}
    </SettingsSection>
  );
}
