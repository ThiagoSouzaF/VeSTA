import icon from '../../assets/mascot/mark-128.webp'; // 128px copy of assets/vesta.png (the 512px original is the window/installer icon)
// The app icon (Vesta, black and white manga) at any size.
export function Mark({ size = 32 }) {
  return (
    <img
      className="brand-icon"
      src={icon}
      width={size}
      height={size}
      alt=""
      decoding="async"
      draggable="false"
      style={{ borderRadius: Math.round(size * 0.22) }}
    />
  );
}
// The name: Vesta with a lowercase e, the digital flame.
export function Wordmark({ className = '' }) {
  return (
    <span className={'wordmark ' + className} aria-label="VeSTA">
      V<em>e</em>STA
    </span>
  );
}
