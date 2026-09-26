// A stand-in for an age plugin such as age-plugin-yubikey, speaking just enough of the
// recipient-v1 protocol for tests: it "wraps" the file key by flipping every bit, in a stanza
// of type `fake`. `FAKE_PLUGIN_MODE=error` makes it report an error instead.
import { createInterface } from 'node:readline';

const lines = createInterface({ input: process.stdin });
const iterator = lines[Symbol.asyncIterator]();
const next = async () => (await iterator.next()).value;

async function readStanza() {
  const header = await next();
  if (header === undefined) return null;
  const args = header.slice(3).split(' ');
  let body = '';
  for (;;) {
    const line = await next();
    body += line;
    if (line.length < 64) break;
  }
  return { args, body: Buffer.from(body, 'base64') };
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64').replace(/=+$/, '');
const write = (args, body = Buffer.alloc(0)) => process.stdout.write(`-> ${args.join(' ')}\n${b64(body)}\n`);

let fileKey = null;
for (;;) {
  const stanza = await readStanza();
  if (stanza.args[0] === 'wrap-file-key') fileKey = stanza.body;
  if (stanza.args[0] === 'done') break;
}

// Something the client must answer before it gets the stanza.
write(['msg'], Buffer.from('Touch your key'));
await readStanza();

if (process.env.FAKE_PLUGIN_MODE === 'error') {
  write(['error', 'internal'], Buffer.from('no key in slot'));
  await readStanza();
} else {
  write(['recipient-stanza', '0', 'fake', 'arg1'], Buffer.from(fileKey.map((b) => b ^ 0xff)));
  await readStanza();
  write(['done']);
}
lines.close();
