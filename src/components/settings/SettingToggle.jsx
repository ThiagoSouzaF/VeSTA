import { SettingRow } from './SettingRow';

export function SettingToggle({ title, description, checked, onChange, disabled }) {
  return (
    <SettingRow title={title} description={description}>
      <button
        className={'toggle ' + (checked ? 'on' : '')}
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={disabled}
        onClick={onChange}
      >
        <span />
      </button>
    </SettingRow>
  );
}
