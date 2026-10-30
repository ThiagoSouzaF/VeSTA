// Newline-delimited JSON reading shared by the drivers (and the Codex rate-limit probe).
// Newline-delimited JSON from a child's stdout.
function lines(stream, onLine) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (b) => {
    buf += b;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (l.trim()) onLine(l);
    }
    if (buf.length > 2000000) buf = '';
  });
  stream.on('end', () => {
    if (buf.trim()) onLine(buf);
    buf = '';
  });
}
const json = (l) => {
  try {
    return JSON.parse(l);
  } catch {
    return null;
  }
};
module.exports = { lines, json };
