export function SettingToggle({ title, description, checked, onChange, disabled }) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
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
    </div>
  );
}
