const ALLOWED_API_PATHS = new Set(['/api/v1/jobs/createTask', '/api/v1/jobs/recordInfo', '/api/v1/chat/credit']);

function validateRequest(request) {
  const url = new URL(request.url);
  const upload = url.origin === 'https://kieai.redpandaai.co' && url.pathname === '/api/file-stream-upload';
  const api = url.origin === 'https://api.kie.ai' && ALLOWED_API_PATHS.has(url.pathname);
  if (url.username || url.password || url.hash || (!upload && !api)) throw new Error('Destino de rede não permitido.');
  const expectedMethod = upload || url.pathname.endsWith('/createTask') ? 'POST' : 'GET';
  if (request.method !== expectedMethod) throw new Error('Método não permitido.');
  if (upload !== Boolean(request.upload)) throw new Error('Formato da requisição inválido.');
  return { url, upload };
}

async function performRequest(request) {
  const { url, upload } = validateRequest(request);
  const headers = { Authorization: String(request.headers?.Authorization || '') };
  let body;
  if (upload) {
    const file = request.upload;
    if (!(file.bytes instanceof Uint8Array) || !file.bytes.length || file.bytes.length > 100 * 1024 * 1024) throw new Error('Áudio vazio ou maior que 100 MB.');
    body = new FormData();
    body.append('file', new Blob([file.bytes], { type: String(file.type) }), String(file.name));
    body.append('fileName', String(file.name));
    body.append('uploadPath', 'audio/covers');
  } else if (request.method === 'POST') {
    if (typeof request.body !== 'string' || request.body.length > 1000000) throw new Error('Corpo da requisição inválido.');
    JSON.parse(request.body);
    body = request.body;
    headers['Content-Type'] = 'application/json';
  }
  // Do not forward credentials across redirects or expose arbitrary network access.
  const response = await fetch(url, { method: request.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(upload ? 90000 : 30000) });
  return { status: response.status, body: await response.text() };
}

module.exports = { validateRequest, performRequest };
