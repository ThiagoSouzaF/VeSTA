// A titled setting with its control on the right.
export function SettingRow({ title, description, children }) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
