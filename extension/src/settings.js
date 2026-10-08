export const DEFAULT_ORIGIN = 'http://127.0.0.1:8080';

export function serverOrigin(input) {
  const url = new URL(input.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || input.includes('?') || input.includes('#')) {
    throw new Error('Use um endereço http ou https, sem senha, caminho, consulta ou fragmento.');
  }
  return url.origin;
}

export function originPattern(origin) {
  return `${serverOrigin(origin)}/*`;
}

export async function configureServer(input, browserAPI, fetcher = fetch) {
  const origin = serverOrigin(input);
  // Keep the permission request in the submit gesture, before the first await.
  if (!await browserAPI.permissions.request({ origins: [originPattern(origin)] })) {
    throw new Error('Permissão recusada. Autorize o endereço do servidor para salvar.');
  }
  let response;
  try {
    response = await fetcher(`${origin}/api/health`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  } catch {
    throw new Error('O servidor não respondeu. Confira o endereço e tente novamente.');
  }
  if (response.status !== 200) throw new Error('O servidor não respondeu com sucesso. Confira o endereço.');
  await browserAPI.storage.local.set({ serverOrigin: origin });
  return origin;
}

export async function configuredOrigin(browserAPI) {
  const stored = await browserAPI.storage.local.get('serverOrigin');
  const origin = serverOrigin(stored.serverOrigin ?? DEFAULT_ORIGIN);
  return await browserAPI.permissions.contains({ origins: [originPattern(origin)] }) ? origin : null;
}
