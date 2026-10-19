// "CH_02 // ATIVIDADE": the chapter header of a page. Only the Tinta Mangá theme shows it (see pages.css).
export function Chapter({ n, title }) {
  return (
    <span className="chapter" aria-hidden="true">
      CH_{String(n).padStart(2, '0')} // {title}
    </span>
  );
}
