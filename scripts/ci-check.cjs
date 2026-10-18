'use strict';
// Keep failed check details visible in Actions annotations as well as the full log.
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, process.argv.slice(2), { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
function record(chunk, stream) {
  stream.write(chunk);
  output = (output + chunk.toString()).slice(-16000);
}
child.stdout.on('data', chunk => record(chunk, process.stdout));
child.stderr.on('data', chunk => record(chunk, process.stderr));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('close', code => {
  const status = code ?? 1;
  if (status && process.env.GITHUB_ACTIONS) {
    const message = output.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
    console.error('::error title=Validation failed::' + message);
  }
  process.exitCode = status;
});
