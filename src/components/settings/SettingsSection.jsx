// Card of Preferências: icon + title + description on the left, the controls below.
export function SettingsSection({ id, icon: Icon, title, description, children }) {
  return (
    <section className="settings-section" data-section={id}>
      <div className="settings-label">
        <Icon size={19} />
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
