import { DecryptedText } from './bits/DecryptedText';

// "CH_02 // ATIVIDADE": the chapter header of a page. Only the ink look shows it (see pages.css); it decrypts
// itself when the page opens, like a HUD coming online.
export function Chapter({ n, title }) {
  return (
    <span className="chapter" aria-hidden="true">
      <DecryptedText text={'CH_' + String(n).padStart(2, '0') + ' // ' + title} />
    </span>
  );
}
