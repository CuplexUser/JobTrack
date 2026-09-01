/**
 * Starts a built payload exactly the way the C# host will and proves it actually works.
 *
 * This is the step that makes the prune list in prune.json safe to have. `TransformersEmbedder`
 * downgrades a failed model load to a warning and carries on lexical-only (see its header in
 * apps/api/src/search/transformers-embedder.ts), so a prune that took an ONNX file the runtime
 * needed would otherwise ship as "semantic search quietly stopped working" rather than as a
 * crash anybody would notice.
 *
 * Everything here goes through the same surfaces the host uses — the JOBTRACK_READY line, HTTP,
 * and `quit` on stdin — so a passing smoke test is also a passing integration test for the
 * protocol between the two.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

/** An ephemeral port the OS has just confirmed is free. */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One launch of the payload. Resolves once the server reports itself ready, and hands back the
 * handle used to stop it again.
 */
function start({ outDir, launch, home, port, log }) {
  const abs = (relPath) => join(outDir, relPath);
  const child = spawn(
    abs(launch.node),
    [
      '--require', abs(launch.require),
      // Not a plain path: Node reads the "C:" of a Windows path as a URL protocol.
      '--import', pathToFileURL(abs(launch.import)).href,
      abs(launch.entry),
      ...launch.args,
      '--home', home,
    ],
    {
      cwd: join(outDir, launch.cwd),
      stdio: ['pipe', 'pipe', 'pipe'],
      // Explicit, the way Process.Start builds one — so if handing Node a constructed environment
      // ever were a problem for tsx, this test would find it rather than a user's machine.
      env: { ...process.env, JOBTRACK_HOME: home, TSX_TSCONFIG_PATH: abs(launch.tsconfig), PORT: String(port) },
    },
  );

  const startedAt = Date.now();
  let ready = null;
  const lines = [];

  const record = (stream, prefix) => {
    createInterface({ input: stream }).on('line', (line) => {
      lines.push(`${prefix} ${line}`);
      if (log) console.log(`    ${prefix} ${line}`);
      if (line.startsWith('JOBTRACK_READY ')) ready = JSON.parse(line.slice('JOBTRACK_READY '.length));
    });
  };
  record(child.stdout, '[out]');
  record(child.stderr, '[err]');

  const exited = new Promise((resolveExit) => child.on('exit', (code) => resolveExit(code ?? -1)));

  return {
    child,
    lines,
    exited,
    async waitForReady(timeoutMs = 120_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (ready) return { info: ready, ms: Date.now() - startedAt };
        if (child.exitCode !== null) {
          throw new Error(`the server exited with code ${child.exitCode} before it was ready:\n${lines.join('\n')}`);
        }
        await delay(100);
      }
      throw new Error(`no JOBTRACK_READY within ${timeoutMs} ms:\n${lines.join('\n')}`);
    },
    async quit(timeoutMs = 20_000) {
      child.stdin.write('quit\n');
      const code = await Promise.race([exited, delay(timeoutMs).then(() => null)]);
      if (code === null) {
        child.kill('SIGKILL');
        throw new Error('the server did not exit within 20s of `quit` on stdin');
      }
      return code;
    },
  };
}

export async function smokeTest({ outDir, launch, expectVersion, semanticTimeoutMs = 420_000 }) {
  const home = mkdtempSync(join(tmpdir(), 'jobtrack-smoke-'));
  const port = await freePort();
  // Every server this run starts, so a failure part-way through still leaves nothing behind. Without
  // it, an assertion that throws while a server is up means the cleanup below hits EPERM on the open
  // database file -- and reports *that* instead of the failure that actually matters.
  const started = [];
  // SEMANTIC_SEARCH is on by default, but say so out loud: the whole point of this run is to
  // prove the embedding stack survived pruning.
  writeFileSync(join(home, '.env'), `PORT=${port}\nSEMANTIC_SEARCH=true\n`);

  try {
    // ------------------------------------------------------------------------------- cold start
    const cold = start({ outDir, launch, home, port, log: true });
    started.push(cold);
    const { info, ms: coldMs } = await cold.waitForReady();

    if (info.version !== expectVersion) {
      throw new Error(`the running server reports ${info.version}, expected ${expectVersion}`);
    }
    if (info.driver !== 'sqlite') throw new Error(`expected the sqlite driver, got ${info.driver}`);
    if (info.port !== port) throw new Error(`expected port ${port}, got ${info.port}`);

    const base = `http://127.0.0.1:${port}`;

    // /api/meta is a public path (apps/api/src/lib/request-guard.ts), so no token is needed.
    const meta = await (await fetch(`${base}/api/meta`)).json();
    if (meta.name !== 'jobtrack' || meta.version !== expectVersion) {
      throw new Error(`/api/meta returned ${JSON.stringify(meta)}`);
    }

    // Proves vendor/web-dist survived the prune and @fastify/static is serving it.
    const indexHtml = await (await fetch(`${base}/`)).text();
    if (!/<div id=|<!doctype html/i.test(indexHtml)) {
      throw new Error(`GET / did not return the web UI:\n${indexHtml.slice(0, 300)}`);
    }

    // `semanticReady` is `embedder.ready && vectors.size > 0` (apps/api/src/search/index.ts), so
    // an empty database can never report ready however well the model loads. One row fixes that.
    const created = await fetch(`${base}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'Smoke Test Ltd',
        jobTitle: 'Senior Platform Engineer',
        appliedOn: new Date().toISOString().slice(0, 10),
      }),
    });
    if (!created.ok) throw new Error(`POST /api/applications failed: ${created.status} ${await created.text()}`);

    // The real assertion. transformers.js downloads the ONNX model on first use, so this is slow
    // on a cold cache and worth a generous budget; what it must never do is come back false.
    console.log('    waiting for the embedding model (downloads on first run)...');
    const deadline = Date.now() + semanticTimeoutMs;
    let semantic = false;
    while (Date.now() < deadline && !semantic) {
      const listed = await (await fetch(`${base}/api/applications?q=platform%20engineer`)).json();
      semantic = listed.semanticReady === true;
      if (!semantic) await delay(2_000);
    }
    if (!semantic) {
      const failure = cold.lines.filter((line) => line.includes('[search]')).join('\n');
      throw new Error(
        'semantic search never became ready — the ONNX prune took something the runtime needs.\n' +
          `Re-run with --keep-dml to test that theory.\n${failure}`,
      );
    }

    const coldExit = await cold.quit();
    if (coldExit !== 0) throw new Error(`expected a clean exit on 'quit', got code ${coldExit}`);

    // ------------------------------------------------------------------------------- warm start
    // tsx caches its transforms under %TEMP%, and the difference between the two numbers is what
    // decides how long the tray icon sits in its "Starting..." state on a normal launch.
    const warm = start({ outDir, launch, home, port, log: false });
    started.push(warm);
    const { ms: warmMs } = await warm.waitForReady();
    const warmExit = await warm.quit();
    if (warmExit !== 0) throw new Error(`expected a clean exit on the warm run, got code ${warmExit}`);

    return { coldMs, warmMs, semantic };
  } finally {
    for (const server of started) {
      if (server.child.exitCode === null) server.child.kill('SIGKILL');
    }
    await Promise.allSettled(started.map((server) => server.exited));
    // Windows releases the SQLite handles a moment after the process goes; retry rather than turn a
    // real failure into a confusing EPERM.
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        rmSync(home, { recursive: true, force: true });
        break;
      } catch {
        await delay(200);
      }
    }
  }
}
