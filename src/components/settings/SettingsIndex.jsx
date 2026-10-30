// The Preferências page is long: this row stays at the top and jumps to each section.
const SECTIONS = [
  ['appearance', 'Aparência'],
  ['memory', 'Memória'],
  ['follow', 'Segundo plano'],
  ['data', 'Dados'],
  ['backup', 'Backup'],
  ['remote', 'Celular'],
  ['updates', 'Atualizações'],
];

export function SettingsIndex() {
  const go = (id) => document.querySelector('[data-section="' + id + '"]')?.scrollIntoView({ block: 'start' });
  return (
    <nav className="settings-index" aria-label="Seções das preferências">
      {SECTIONS.map(([id, label]) => (
        <button key={id} onClick={() => go(id)}>
          {label}
        </button>
      ))}
    </nav>
  );
}
