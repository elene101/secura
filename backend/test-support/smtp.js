const { createServer } = require('node:net');
const { once } = require('node:events');

async function startSmtp({ rejectFirst = false } = {}) {
  const messages = [];
  const server = createServer(socket => {
    socket.setEncoding('utf8');
    socket.write('220 fixture.example ESMTP\r\n');
    let reading = false, buffer = '', text = '', recipient = '';
    socket.on('data', fragment => {
      buffer += fragment;
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (reading && line !== '.') {
          text += (line.startsWith('..') ? line.slice(1) : line) + '\r\n';
        } else if (reading) {
          reading = false;
          messages.push({ recipient, text: text.replace(/=\r\n/g, '').replace(/=3D/g, '=') });
          socket.write(rejectFirst && messages.length === 1 ? '451 Please retry\r\n' : '250 Accepted\r\n');
        } else if (/^(EHLO|HELO) /.test(line)) socket.write('250 fixture.example\r\n');
        else if (line === 'DATA') { reading = true; text = ''; socket.write('354 Send data\r\n'); }
        else if (line === 'QUIT') socket.end('221 Bye\r\n');
        else {
          if (line.startsWith('RCPT TO:')) recipient = line.slice(8).trim().replace(/^<|>$/g, '');
          socket.write('250 OK\r\n');
        }
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { port: server.address().port, messages, close: () => server.close() };
}
module.exports = { startSmtp };
