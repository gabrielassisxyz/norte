import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { originPattern } from './src/settings.js';

const root = dirname(fileURLToPath(import.meta.url));
export async function buildExtension({ output = resolve(root, 'dist/chromium'), testOrigin } = {}) {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  if (testOrigin) manifest.host_permissions = [originPattern(testOrigin)];
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(resolve(root, 'src'), output, { recursive: true });
  await cp(resolve(root, '../design/system/tokens.css'), resolve(output, 'tokens.css'));
  await cp(resolve(root, '../design/system/fonts'), resolve(output, 'fonts'), { recursive: true });
  await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--test-origin')) throw new Error('Usage: node build.mjs [--test-origin <origin>]');
  const output = await buildExtension({
    output: resolve(root, args.length ? 'dist/test' : 'dist/chromium'), testOrigin: args[1],
  });
  const archive = resolve(root, args.length ? 'dist/norte-test.zip' : 'dist/norte.zip');
  await rm(archive, { force: true });
  execFileSync('zip', ['-qr', archive, '.'], { cwd: output });
  console.log(`Built ${output} and ${archive}`);
}
