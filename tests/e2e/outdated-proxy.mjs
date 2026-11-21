// One address for two versions of the app, so two phones share an origin (and
// so a phone's storage) while running different code: a page whose requests
// carry `x-ft-test-app: old` is served by the old dev server, any other by the
// new one. A page keeps the version it loaded until it reloads with the other
// header, as a phone keeps an open page until it reloads.
//   node tests/e2e/outdated-proxy.mjs PORT OLD_PORT NEW_PORT
import http from 'node:http';
import net from 'node:net';

const [port, oldPort, newPort] = process.argv.slice(2).map(Number);
const target = req => (req.headers['x-ft-test-app'] === 'old' ? oldPort : newPort);

const server = http.createServer((req, res) => {
  const up = http.request({ host: '127.0.0.1', port: target(req), method: req.method, path: req.url, headers: req.headers }, r => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(up);
});
// the dev servers' own socket (page reloads on change): to the same version as the page
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(target(req), '127.0.0.1', () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
    if (head?.length) up.write(head);
    up.pipe(socket).pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});
server.listen(port, () => console.log(`proxy on ${port}: old ${oldPort}, new ${newPort}`));
