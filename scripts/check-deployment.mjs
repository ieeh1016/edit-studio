const baseUrl = process.argv[2] ?? 'https://ieeh1016.github.io/edit-studio/';

async function head(url) {
  const response = await fetch(url, { method: 'HEAD' });
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status} ${response.statusText}`);
  }

  return {
    url,
    status: response.status,
    type: response.headers.get('content-type') ?? 'unknown',
    length: response.headers.get('content-length') ?? 'unknown'
  };
}

async function main() {
  const htmlResponse = await fetch(baseUrl);
  if (!htmlResponse.ok) {
    throw new Error(`${baseUrl} -> ${htmlResponse.status} ${htmlResponse.statusText}`);
  }

  const html = await htmlResponse.text();
  const assetPaths = Array.from(
    new Set(html.match(/\/edit-studio\/assets\/[^"']+\.(?:js|css)/g) ?? [])
  );
  const assetUrls = assetPaths.map((path) => new URL(path, baseUrl).toString());
  const fontUrl = new URL('fonts/AppleGothic.ttf', baseUrl).toString();

  const jsText = assetUrls.find((url) => url.endsWith('.js'))
    ? await (await fetch(assetUrls.find((url) => url.endsWith('.js')))).text()
    : '';
  const wasmPath = jsText.match(/assets\/ffmpeg-core-[^"']+\.wasm/)?.[0];
  const wasmUrl = wasmPath ? new URL(wasmPath, baseUrl).toString() : null;

  const checks = [baseUrl, ...assetUrls, fontUrl, ...(wasmUrl ? [wasmUrl] : [])];
  const results = await Promise.all(checks.map(head));

  for (const result of results) {
    console.log(`${result.status} ${result.type} ${result.length} ${result.url}`);
  }

  if (!wasmUrl) {
    console.warn('FFmpeg WASM asset path was not found in the built JS.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
