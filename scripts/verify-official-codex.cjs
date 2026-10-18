'use strict';
// Run through npm exec --package=@openai/codex@0.163.0. Never use the user's login.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { discoverCodex } = require('../src/codex-discovery.cjs');
const { CodexClient } = require('../src/codex-client.cjs');
(async () => {
  const executable = await discoverCodex(); assert.ok(executable, 'Official Codex native binary must be available');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-official-protocol-'));
  const cleanEnvironment = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'ComSpec', 'PATHEXT']) if (process.env[key]) cleanEnvironment[key] = process.env[key];
  // CODEX_HOME is used for its intended profile-directory purpose, isolated from the real account.
  cleanEnvironment.CODEX_HOME = directory;
  const client = new CodexClient(executable, { args: ['-c', 'cli_auth_credentials_store="file"', 'app-server'], env: cleanEnvironment, timeout: 20000 });
  let diagnostic = '';
  try {
    const handshake = client.start();
    client.child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-4096); });
    const initialized = await handshake;
    // Rust canonical paths on Windows can have a \\?\ prefix; compare canonical names in the same format.
    const canonical = async value => {
      const real = await fs.realpath(value);
      return process.platform === 'win32' ? path.toNamespacedPath(real).toLowerCase() : real;
    };
    assert.equal(await canonical(initialized.codexHome), await canonical(directory));
    const account = await client.request('account/read', { refreshToken: false }); assert.equal(account.account, null);
    console.log('PASS official Codex: native binary discovery, JSON-RPC initialization and signed-out account read in an isolated empty profile.');
  } catch (error) {
    // This child has an empty isolated profile; its diagnostics cannot expose the user's login.
    if (diagnostic.trim()) console.error('Isolated Codex diagnostic:', diagnostic.trim());
    throw error;
  } finally {
    client.stop();
    if (client.child && client.child.exitCode === null) await Promise.race([once(client.child, 'exit'), new Promise(resolve => { const timer = setTimeout(resolve, 2000); timer.unref(); })]);
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error.message); if (process.env.GITHUB_ACTIONS) console.error('::error title=Official Codex protocol check::' + String(error.message).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')); process.exitCode = 1; });
