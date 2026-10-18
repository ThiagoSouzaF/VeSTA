// Vesta's hearth: a flame at the centre of a dotted (digital) ring, with sparks that leave as pixels.
export function Mark({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle
        cx="20"
        cy="20"
        r="17.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeDasharray="1.4 2.6"
        strokeLinecap="round"
        opacity=".75"
      />
      <path
        d="M20 6.5C22.2 10.6 26.4 13.3 26.4 19.6C26.4 23.6 23.6 26.4 20 26.4C16.4 26.4 13.6 23.6 13.6 19.6C13.6 16.4 15.5 14.3 17 12.4C17.4 14.9 18.4 16.4 19.6 17C20.5 13.9 20.9 10.3 20 6.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M20 17.6C21.3 19.4 23.1 20.6 23.1 22.8C23.1 24.6 21.8 25.8 20 25.8C18.2 25.8 16.9 24.6 16.9 22.8C16.9 21.2 18.2 19.8 20 17.6Z"
        fill="currentColor"
      />
      <path d="M13.5 30.6H26.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="27.4" y="7.6" width="2.2" height="2.2" rx=".4" fill="currentColor" />
      <rect x="30.6" y="12.2" width="1.6" height="1.6" rx=".3" fill="currentColor" opacity=".7" />
      <rect x="10" y="9.6" width="1.6" height="1.6" rx=".3" fill="currentColor" opacity=".55" />
    </svg>
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
