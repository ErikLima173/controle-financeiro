/*
 * comum.js — Peças dos testes no navegador: servidor estático, página limpa e registro de problemas.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Estes testes precisam do Playwright: npm install --no-save playwright && npx playwright install chromium');
  process.exit(2);
}

const RAIZ = path.resolve(__dirname, '..', '..');
const PLANILHA = path.join(__dirname, '..', 'fixtures', 'gastos-exemplo.xlsx');
const ESPERADO = JSON.parse(fs.readFileSync(PLANILHA.replace(/\.xlsx$/, '.esperado.json'), 'utf8'));
const CAPTURAS = process.env.CAPTURAS || path.join(os.tmpdir(), 'livro-caixa-capturas');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const falhas = [];
const falhar = (msg) => { falhas.push(msg); console.log('  ✗', msg); };
const ok = (msg) => console.log('  ✓', msg);
const perto = (a, b) => Math.abs(a - b) <= 0.005; // NaN (célula vazia ou faltando) nunca está perto

// "−R$ 1.868,64" / "R$ 6.430,00" / "" ─► número (vazio = 0)
function moeda(texto) {
  const s = String(texto || '').trim();
  if (!s) return 0;
  const n = Number(s.replace(/[^\d,]/g, '').replace(',', '.'));
  return /^[−-]/.test(s) ? -n : n;
}

function servir() {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const arq = path.join(RAIZ, rel === '/' ? 'index.html' : rel);
    if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TIPOS[path.extname(arq)] || 'application/octet-stream' });
    fs.createReadStream(arq).pipe(res);
  });
  return new Promise((pronto) => srv.listen(0, '127.0.0.1', () => pronto(srv)));
}

/*
 * Abre o Livro-Caixa num perfil novo (sem nada salvo). A fonte do Google fica bloqueada para o teste
 * não depender de internet. Erros de console, exceções e arquivos que não carregam vão para `erros`.
 */
async function abrir(browser, url, { rotulo, viewport = { width: 1440, height: 900 }, colorScheme = 'light', erros }) {
  const ctx = await browser.newContext({ viewport, colorScheme, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) erros.push(`${rotulo}: console: ${m.text()}`); });
  page.on('pageerror', (e) => erros.push(`${rotulo}: exceção: ${e.message}`));
  page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) erros.push(`${rotulo}: não carregou ${r.url()}`); });
  await page.goto(url, { waitUntil: 'networkidle' });
  return { ctx, page };
}

async function executar(titulo, corpo) {
  fs.mkdirSync(CAPTURAS, { recursive: true });
  const srv = await servir();
  const browser = await chromium.launch();
  const erros = [];
  try {
    await corpo({ browser, url: `http://127.0.0.1:${srv.address().port}/index.html`, erros });
  } catch (e) {
    falhar(`${titulo}: o teste parou no meio: ${e.message.split('\n')[0]}`);
  } finally {
    await browser.close();
    srv.close();
  }
  erros.forEach((e) => falhar(e));
  console.log(`\n${falhas.length ? `✗ ${falhas.length} problema(s)` : '✓ tudo certo'} · capturas em ${CAPTURAS}`);
  process.exit(falhas.length ? 1 : 0);
}

module.exports = { PLANILHA, ESPERADO, CAPTURAS, falhar, ok, perto, moeda, abrir, executar };
