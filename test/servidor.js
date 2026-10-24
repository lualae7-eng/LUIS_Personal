/* Servidor local para ver FORJA sin tocar Google:
 *   TZ=America/Mexico_City node test/servidor.js
 * Sirve app/ en http://localhost:8080 y simula el Apps Script en /exec
 * con datos inventados. Imprime la clave para pegarla en Ajustes.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { crearEntorno } = require('./simulador');

const PUERTO = Number(process.env.PUERTO || 8080);
const APP = path.join(__dirname, '../app');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const e = crearEntorno();
e.instalar();
e.correr('migrarDesdeForja');
e.correr('instalarPruebas');

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/exec') {
    if (req.method === 'GET') return responder(res, e.get(Object.fromEntries(url.searchParams)));
    let cuerpo = '';
    req.on('data', c => { cuerpo += c; });
    req.on('end', () => {
      try { responder(res, e.post(JSON.parse(cuerpo))); } catch (err) { responder(res, { ok: false, error: String(err) }); }
    });
    return;
  }
  const archivo = path.join(APP, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!archivo.startsWith(APP) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    res.writeHead(404); return res.end('no existe');
  }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
  fs.createReadStream(archivo).pipe(res);
}).listen(PUERTO, () => {
  console.log('FORJA Luis local: http://localhost:' + PUERTO);
  console.log('URL del Apps Script: http://localhost:' + PUERTO + '/exec');
  console.log('Clave: ' + e.props.FORJA_CLAVE);
});

function responder(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
