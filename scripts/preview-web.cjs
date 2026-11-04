const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../dist/web');
const types = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ttf':'font/ttf' };
http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') { response.writeHead(302, {Location:'/MySuno/'}); response.end(); return; }
    if (!url.pathname.startsWith('/MySuno/')) { response.writeHead(404); response.end(); return; }
    const file = path.resolve(root, decodeURIComponent(url.pathname.slice('/MySuno/'.length)) || 'index.html');
    if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
    const data = await fs.readFile(file);
    response.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache'});
    response.end(data);
  } catch { response.writeHead(404); response.end('Arquivo não encontrado.'); }
}).listen(4173,'127.0.0.1',()=>console.log('PWA preview: http://localhost:4173/MySuno/'));
