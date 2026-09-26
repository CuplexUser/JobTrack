/**
 * An age plugin recipient (`age1yubikey1…`, `age1fido2-hmac1…`, `age1tpm1…`, …), wrapped by
 * running the plugin binary with the standard age plugin protocol (`recipient-v1`, see
 * https://c2sp.org/age-plugin). typage itself does not run plugins, so this is the bridge.
 *
 * Only the public half of the protocol is spoken: wrapping a file key needs the recipient
 * string alone, so a YubiKey does not have to be plugged in while a scheduled backup runs.
 * Anything the plugin asks the user (a PIN, a confirmation) is answered with a refusal, since
 * a background backup has nobody to ask.
 */

import { spawn } from 'node:child_process';
import { Stanza, type Recipient } from 'age-encryption';

/** How to start a plugin: the executable and its leading arguments. Swappable for tests. */
export type PluginLauncher = (pluginName: string) => { command: string; args: string[] };

export const defaultPluginLauncher: PluginLauncher = (pluginName) => ({
  command: `age-plugin-${pluginName}`,
  args: [],
});

const NATIVE_PREFIXES = ['age', 'age1pq', 'age1tag', 'age1tagpq'];

/**
 * The plugin a recipient belongs to, or null for a recipient typage handles natively. The
 * bech32 separator is the *last* `1`, so `age1yubikey1qw…` has the prefix `age1yubikey` and
 * belongs to `age-plugin-yubikey`.
 */
export function pluginNameOf(recipient: string): string | null {
  const lower = recipient.toLowerCase();
  const separator = lower.lastIndexOf('1');
  if (separator <= 0) return null;
  const prefix = lower.slice(0, separator);
  if (NATIVE_PREFIXES.includes(prefix)) return null;
  if (!prefix.startsWith('age1') || prefix.length <= 4) return null;
  return prefix.slice(4);
}

/** Standard base64 without padding, as age uses in stanza bodies. */
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/=+$/, '');
}

function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64'));
}

/** One stanza on the wire: `-> args…`, then the body in 64-column lines ending with a short one. */
function encodeStanza(args: string[], body: Uint8Array = new Uint8Array()): string {
  const encoded = toBase64(body);
  const lines: string[] = [];
  for (let i = 0; i < encoded.length; i += 64) lines.push(encoded.slice(i, i + 64));
  if (encoded.length % 64 === 0) lines.push('');
  return `-> ${args.join(' ')}\n${lines.join('\n')}\n`;
}

interface WireStanza {
  args: string[];
  body: Uint8Array;
}

/** Reads stanzas off a line stream as they arrive. */
class StanzaReader {
  #buffer = '';
  #lines: string[] = [];
  #waiting: (() => void) | null = null;
  #ended = false;

  push(chunk: string): void {
    this.#buffer += chunk;
    let newline: number;
    while ((newline = this.#buffer.indexOf('\n')) !== -1) {
      this.#lines.push(this.#buffer.slice(0, newline).replace(/\r$/, ''));
      this.#buffer = this.#buffer.slice(newline + 1);
    }
    this.#wake();
  }

  end(): void {
    this.#ended = true;
    this.#wake();
  }

  #wake(): void {
    const waiting = this.#waiting;
    this.#waiting = null;
    waiting?.();
  }

  async #line(): Promise<string | null> {
    while (this.#lines.length === 0) {
      if (this.#ended) return null;
      await new Promise<void>((resolve) => (this.#waiting = resolve));
    }
    return this.#lines.shift()!;
  }

  async next(): Promise<WireStanza | null> {
    const header = await this.#line();
    if (header === null) return null;
    if (!header.startsWith('-> ')) throw new Error(`unexpected line from plugin: ${header.slice(0, 80)}`);
    const args = header.slice(3).split(' ');
    let body = '';
    for (;;) {
      const line = await this.#line();
      if (line === null) throw new Error('plugin output ended in the middle of a stanza');
      body += line;
      if (line.length < 64) break;
    }
    return { args, body: fromBase64(body) };
  }
}

export class PluginRecipient implements Recipient {
  readonly pluginName: string;
  readonly #recipient: string;
  readonly #launch: PluginLauncher;
  readonly #timeoutMs: number;

  constructor(recipient: string, options: { launch?: PluginLauncher; timeoutMs?: number } = {}) {
    const name = pluginNameOf(recipient);
    if (!name) throw new Error(`${recipient} is not a plugin recipient`);
    this.pluginName = name;
    this.#recipient = recipient;
    this.#launch = options.launch ?? defaultPluginLauncher;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async wrapFileKey(fileKey: Uint8Array): Promise<Stanza[]> {
    const { command, args } = this.#launch(this.pluginName);
    const child = spawn(command, [...args, '--age-plugin=recipient-v1'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const reader = new StanzaReader();
    let stderr = '';
    let spawnError: Error | null = null;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => reader.push(chunk));
    child.stdout.on('end', () => reader.end());
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error) => {
      spawnError = error;
      reader.end();
    });
    // A plugin that exits early closes stdin under us; the error surfaces through the reader.
    child.stdin.on('error', () => undefined);

    const timer = setTimeout(() => child.kill(), this.#timeoutMs);
    try {
      // Phase 1: everything the plugin needs, in one go.
      child.stdin.write(
        encodeStanza(['add-recipient', this.#recipient]) + encodeStanza(['wrap-file-key'], fileKey) + encodeStanza(['done']),
      );

      // Phase 2: answer the plugin until it says it is done.
      const stanzas: Stanza[] = [];
      for (;;) {
        const message = await reader.next();
        if (message === null) {
          const cause = spawnError as NodeJS.ErrnoException | null;
          if (cause?.code === 'ENOENT') {
            throw new Error(`age-plugin-${this.pluginName} was not found. Install it and make sure it is on PATH.`);
          }
          throw new Error(`age-plugin-${this.pluginName} stopped unexpectedly${stderr ? `: ${stderr.trim()}` : ''}`);
        }
        const [command, ...rest] = message.args;
        switch (command) {
          case 'recipient-stanza':
            // `recipient-stanza <file index> <type> <args…>`; there is only ever file 0 here.
            stanzas.push(new Stanza(rest.slice(1), message.body));
            child.stdin.write(encodeStanza(['ok']));
            break;
          case 'msg':
          case 'labels':
            child.stdin.write(encodeStanza(['ok']));
            break;
          case 'error': {
            child.stdin.write(encodeStanza(['ok']));
            const detail = Buffer.from(message.body).toString('utf8').trim();
            throw new Error(`age-plugin-${this.pluginName}: ${detail || rest.join(' ')}`);
          }
          case 'done':
            if (stanzas.length === 0) throw new Error(`age-plugin-${this.pluginName} returned no stanza`);
            return stanzas;
          default:
            // `request-secret`, `request-public`, `confirm`: nobody is there to answer during a
            // background run. Anything unknown gets the reply the spec asks for.
            child.stdin.write(
              encodeStanza([command === 'request-secret' || command === 'request-public' || command === 'confirm' ? 'fail' : 'unsupported']),
            );
        }
      }
    } finally {
      clearTimeout(timer);
      child.stdin.end();
    }
  }
}
