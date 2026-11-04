const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { getMusicModels } = require('./lib/music-models.cjs');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'src');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm'
};

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  // Prevent browser caching during development
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/api/music-models' && req.method === 'GET') {
    getMusicModels().then(catalog => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(catalog));
    }).catch(err => {
      console.error('[MySuno] Catálogo musical:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // 1. Endpoint Proxy para Upload Seguro no KIE.AI (Evita qualquer erro de CORS no navegador)
  if (req.url === '/api/upload-audio' && req.method === 'POST') {
    const authHeader = req.headers['authorization'];
    const contentType = req.headers['content-type'];

    const proxyReq = https.request('https://kieai.redpandaai.co/api/file-stream-upload', {
      method: 'POST',
      headers: {
        'Authorization': authHeader || '',
        'Content-Type': contentType
      }
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, msg: `Erro no upload: ${err.message}` }));
    });

    req.pipe(proxyReq);
    return;
  }

  // 2. Servir Arquivos Estáticos da pasta src/
  let reqPath = decodeURI(req.url.split('?')[0]);
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

  const filePath = path.join(PUBLIC_DIR, reqPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Acesso Negado');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const fallback = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(fallback, (errFallback, content) => {
        if (errFallback) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Não Encontrado');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(content);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (errRead, data) => {
      if (errRead) {
        res.writeHead(500);
        res.end('Erro interno ao ler arquivo');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========================================`);
  console.log(`  MySuno rodando com sucesso!`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`========================================\n`);
});
