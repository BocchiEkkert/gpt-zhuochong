'use strict';
const { spawnSync } = require('node:child_process');
// Packages must be readable by normal desktop users even if the build host uses umask 077.
process.umask(0o022);
const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--linux', 'deb', '--x64'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
