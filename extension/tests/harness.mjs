import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildExtension } from '../build.mjs';

const repo = resolve(import.meta.dirname, '../..');
export const articleText = 'A patient observation of the night sky reveals how the planets travel among the stars.';
export const selectedText = 'planets travel';
const article = `<!doctype html><html><head><title>Observing the sky</title></head><body><article><h1>Observing the sky</h1>
${Array.from({ length: 12 }, () => `<p>${'🌱'.repeat(40)} ${articleText} A field notebook helps us compare each observation and understand the changing seasons. ${'🚀'.repeat(40)}</p>`).join('')}</article></body></html>`;

async function launchNorte(scratch) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('NORTE_')));
  const processHandle = spawn(resolve(repo, 'server/norte'), ['serve'], {
    cwd: resolve(repo, 'server'), env: { ...env, NORTE_DATA: resolve(scratch, 'data'), XDG_CONFIG_HOME: resolve(scratch, 'config'),
      NORTE_MODULES: 'library', NORTE_LISTEN: '127.0.0.1:0', NORTE_LLM_URL: '', NORTE_TELEGRAM_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  processHandle.stdout.on('data', (chunk) => { output += chunk; });
  processHandle.stderr.on('data', (chunk) => { output += chunk; });
  try {
    await expect.poll(() => output.match(/"addr":"([^"]+)"/)?.[1] ?? '', { message: 'norte starts on its isolated port' }).not.toBe('');
    return { processHandle, origin: `http://${output.match(/"addr":"([^"]+)"/)[1]}` };
  } catch (error) {
    processHandle.kill('SIGTERM');
    throw new Error(`${error.message}\n${output}`);
  }
}

export async function startHarness({ granted = true } = {}) {
  await mkdir(resolve(repo, 'extension/artifacts'), { recursive: true });
  const scratch = await mkdtemp(resolve(repo, 'extension/artifacts/run-'));
  const norte = await launchNorte(scratch);
  const posts = [];
  const controls = { status: 0, delay: 0 };
  const fixture = createServer(async (request, response) => {
    try {
      if (request.url.startsWith('/api/')) {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        if (request.method === 'POST' && request.url === '/api/library/items') {
          posts.push(JSON.parse(body));
          if (controls.delay) await new Promise((done) => setTimeout(done, controls.delay));
          if (controls.status) { response.writeHead(controls.status); response.end('{}'); return; }
        }
        const upstream = await fetch(`${norte.origin}${request.url}`, { method: request.method,
          headers: body.length ? { 'Content-Type': 'application/json' } : {}, body: body.length ? body : undefined });
        response.writeHead(upstream.status, { 'Content-Type': 'application/json' });
        response.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      if (!request.headers.cookie?.includes('fixture_session=allowed')) {
        response.writeHead(401); response.end('Login required'); return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(article);
    } catch (error) { response.writeHead(502); response.end(error.message); }
  });
  await new Promise((done) => fixture.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${fixture.address().port}`;
  let context;
  async function close() {
    await context?.close();
    fixture.closeAllConnections();
    await new Promise((done) => fixture.close(done));
    if (norte.processHandle.exitCode === null) {
      const exited = new Promise((done) => norte.processHandle.once('exit', done));
      norte.processHandle.kill('SIGTERM');
      await exited;
    }
    await rm(scratch, { recursive: true, force: true });
  }
  try {
    const build = await buildExtension({ output: resolve(scratch, 'extension'), testOrigin: origin });
    const executablePath = process.env.CHROMIUM_BIN || (existsSync(chromium.executablePath()) ? chromium.executablePath() : '/usr/bin/chromium');
    context = await chromium.launchPersistentContext(resolve(scratch, 'profile'), {
      executablePath, headless: true, args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`, '--no-sandbox'],
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionID = new URL(worker.url()).host;
    await worker.evaluate((serverOrigin) => chrome.storage.local.set({ serverOrigin }), granted ? origin : 'http://unconfigured.invalid:8080');
    await context.addCookies([{ name: 'fixture_session', value: 'allowed', url: origin }]);
    const page = await context.newPage();
    await page.goto(`${origin}/article`);
    async function popup(target = page) {
      const view = await context.newPage();
      // The production popup uses tabs.query; keep the article active while loading its document.
      await target.bringToFront();
      await view.goto(`chrome-extension://${extensionID}/popup.html`);
      return view;
    }
    return { context, page, popup, worker, posts, controls, origin, norteOrigin: norte.origin, close,
      stopServer: async () => { fixture.closeAllConnections(); await new Promise((done) => fixture.close(done)); } };
  } catch (error) { await close(); throw error; }
}
