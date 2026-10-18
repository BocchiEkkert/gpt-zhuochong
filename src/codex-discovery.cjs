'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
async function fileExists(file) { try { return (await fs.stat(file)).isFile(); } catch { return false; } }
async function nativeFromNpm(root, platform = process.platform, arch = process.arch) {
  const target = platform === 'win32' ? `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`
    : platform === 'darwin' ? `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
      : `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl`;
  const binary = platform === 'win32' ? 'codex.exe' : 'codex';
  const vendors = [
    path.join(root, '@openai', 'codex', 'vendor'),
    path.join(root, '@openai', `codex-${platform}-${arch}`, 'vendor'),
    path.join(root, '@openai', 'codex', 'node_modules', '@openai', `codex-${platform}-${arch}`, 'vendor'),
  ];
  try {
    const realPackage = await fs.realpath(path.join(root, '@openai', 'codex'));
    vendors.push(path.join(path.dirname(realPackage), `codex-${platform}-${arch}`, 'vendor'));
  } catch { /* Optional package may be installed next to the wrapper instead. */ }
  for (const vendor of vendors) for (const layout of ['bin', 'codex']) {
    const candidate = path.join(vendor, target, layout, binary);
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}
async function discoverCodex(configured = '', desktopBinary = null) {
  if (configured) {
    if (!path.isAbsolute(configured) || !(await fileExists(configured))) throw new Error('所选 Codex CLI 程序不存在');
    if (process.platform === 'win32' && !configured.toLowerCase().endsWith('.exe')) throw new Error('请选择原生 Codex CLI 的 codex.exe，而非 cmd 快捷脚本');
    return configured;
  }
  if (desktopBinary && await fileExists(desktopBinary)) return desktopBinary;
  const envPath = process.env.PATH || process.env.Path || '';
  for (const directory of envPath.split(path.delimiter).filter(Boolean)) {
    const binary = path.join(directory, process.platform === 'win32' ? 'codex.exe' : 'codex');
    if (await fileExists(binary)) {
      // npm's Unix launcher is a JS script, not an executable under Electron's Node mode.
      const handle = await fs.open(binary, 'r'); const header = Buffer.alloc(100);
      try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
      if (!header.toString().includes('/env node') && !header.toString().includes('/bin/node')) return binary;
    }
    for (const root of [path.join(directory, 'node_modules'), path.resolve(directory, '..', 'lib', 'node_modules'), ...(path.basename(directory) === '.bin' ? [path.dirname(directory)] : [])]) {
      const native = await nativeFromNpm(root); if (native) return native;
    }
  }
  const roots = [path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules'),
    path.resolve(__dirname, '..', 'node_modules')];
  for (const root of roots) { const native = await nativeFromNpm(root); if (native) return native; }
  if (process.platform === 'win32') {
    // Inspect only the known Codex desktop package, never an arbitrary executable tree.
    try {
      const command = "$ErrorActionPreference='Stop'; Get-AppxPackage -Name '*Codex*' | Select-Object -ExpandProperty InstallLocation | ConvertTo-Json -Compress";
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 7000, maxBuffer: 32768 });
      const parsed = stdout.trim() ? JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) : [];
      const locations = Array.isArray(parsed) ? parsed : [parsed];
      for (const location of locations.filter(p => typeof p === 'string')) {
        for (const suffix of ['app/resources/codex.exe', 'resources/codex.exe', 'app/resources/bin/codex.exe', 'resources/bin/codex.exe']) {
          const candidate = path.join(location, suffix); if (await fileExists(candidate)) return candidate;
        }
      }
    } catch { /* Settings exposes a native executable picker when discovery is unavailable. */ }
  }
  return null;
}
module.exports = { discoverCodex, nativeFromNpm };
