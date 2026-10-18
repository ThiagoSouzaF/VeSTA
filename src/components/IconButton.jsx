export function IconButton({ icon: Icon, label, onClick, ...props }) {
  return (
    <button className="icon-button" aria-label={label} title={label} onClick={onClick} {...props}>
      <Icon size={17} />
    </button>
  );
}
