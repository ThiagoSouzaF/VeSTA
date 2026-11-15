// Fake `opencode serve` for the driver tests: answers the session calls, then opens the event stream and closes it
// without ever sending session.idle (a server that went away mid-answer).
const http = require('node:http');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
http
  .createServer((req, res) => {
    if (req.url === '/event') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"type":"server.connected","properties":{}}\n\n');
      return setTimeout(() => res.end(), 100);
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(req.url === '/session' ? JSON.stringify({ id: 'ses_fake' }) : '{}');
  })
  .listen(port, '127.0.0.1', () => console.log('opencode server listening on http://127.0.0.1:' + port));
