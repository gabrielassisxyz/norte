import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import webExt from 'web-ext';
import { buildExtension } from '../build.mjs';
import { probeFirefoxBackground } from './firefox-probe.mjs';

const binary = process.env.FIREFOX_BIN || (process.env.PATH ?? '').split(':')
  .map((directory) => resolve(directory, 'firefox')).find(existsSync);
const sourceDir = await buildExtension();
execFileSync(resolve(import.meta.dirname, '../node_modules/.bin/web-ext'), ['lint', '--source-dir', sourceDir], { stdio: 'inherit' });
if (!binary) {
  console.log('SKIP Firefox load-and-start: no Firefox binary found; set FIREFOX_BIN to enable it.');
} else {
  let runner;
  try {
    runner = await webExt.cmd.run({ sourceDir, firefox: binary, args: ['-headless'], noReload: true, noInput: true });
    await probeFirefoxBackground(runner.extensionRunners[0], sourceDir);
    console.log('PASS Firefox installed the extension and its background answered the popup.');
  } finally {
    if (runner) {
      const desktop = runner.extensionRunners[0];
      const exited = new Promise((done) => desktop.runningInfo.firefox.once('close', done));
      desktop.remoteFirefox?.disconnect();
      await runner.exit();
      await exited;
    }
  }
}
