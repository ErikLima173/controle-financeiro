/*
 * Grava o vídeo tutorial do Livro-Caixa (login e banco nos emuladores do Firebase, planilha com valores inventados).
 * Se tutorial/falas/ tiver a narração (gerar-narracao.js), cada fala espera a anterior terminar e o momento de cada
 * uma vai para tutorial/saida/marcas.json; depois, montar.sh junta vídeo e voz.
 *
 *   firebase emulators:exec --project demo-livro-caixa "node tutorial/gravar.js"
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..');
const DIR = __dirname;
const SAIDA = path.join(DIR, 'saida');
const PLANILHA = path.join(DIR, 'planilha-exemplo.xlsx');
const FONTES = process.env.FONTES || path.join(DIR, 'fontes'); // opcional: @fontsource/ibm-plex-* desempacotados aqui
const CONFIG = `globalThis.LC_FIREBASE = ${JSON.stringify({ apiKey: 'demo', authDomain: 'demo-livro-caixa.firebaseapp.com', projectId: 'demo-livro-caixa', appId: '1:1:web:1', emuladores: { auth: 'http://127.0.0.1:9099', firestore: '127.0.0.1:8080' } })};`;
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

const face = (familia, peso, arquivo) => `@font-face{font-family:'${familia}';font-style:normal;font-weight:${peso};font-display:swap;src:url(https://fonts.gstatic.com/lc/${arquivo}) format('woff2');}`;
const CSS_FONTES = [
  ...[400, 500, 600].map((p) => face('IBM Plex Sans', p, `ibm-plex-sans/package/files/ibm-plex-sans-latin-${p}-normal.woff2`)),
  ...[500, 600].map((p) => face('IBM Plex Sans Condensed', p, `ibm-plex-sans-condensed/package/files/ibm-plex-sans-condensed-latin-${p}-normal.woff2`)),
  ...[400, 500].map((p) => face('IBM Plex Mono', p, `ibm-plex-mono/package/files/ibm-plex-mono-latin-${p}-normal.woff2`)),
].join('\n');

// Legenda e cursor desenhados na própria página (o vídeo do navegador não mostra o mouse).
const SOBREPOSICAO = () => {
  const montar = () => {
    if (document.getElementById('tut-legenda')) return;
    const st = document.createElement('style');
    st.textContent = `
      #tut-legenda{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483646;max-width:min(980px,90vw);
        background:rgba(14,22,18,.9);color:#fff;font:500 22px/1.35 'IBM Plex Sans',system-ui,sans-serif;padding:14px 26px;border-radius:14px;
        box-shadow:0 8px 30px rgba(0,0,0,.35);text-align:center;transition:opacity .3s;opacity:0;pointer-events:none}
      #tut-legenda.on{opacity:1}
      #tut-legenda b{color:#7fd6ae;font-weight:600}
      #tut-cursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;z-index:2147483647;pointer-events:none;
        background:rgba(255,196,0,.35);border:2px solid #f5a300;transition:transform .12s}
      #tut-cursor.click{transform:scale(.6)}
      #tut-capa{position:fixed;inset:0;z-index:2147483645;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
        background:#10251d;color:#fff;font-family:'IBM Plex Sans',system-ui,sans-serif;transition:opacity .5s}
      #tut-capa h1{font:600 64px/1.1 'IBM Plex Sans',sans-serif;margin:0;letter-spacing:-.02em}
      #tut-capa p{font:400 26px/1.4 'IBM Plex Sans',sans-serif;margin:0;color:#b9d8c9;text-align:center;max-width:900px}
      #tut-capa .selo{width:84px;height:84px;border-radius:20px;background:#1f5c4a;display:grid;place-items:center;font-size:44px}`;
    document.head.append(st);
    const l = document.createElement('div'); l.id = 'tut-legenda'; document.body.append(l);
    const c = document.createElement('div'); c.id = 'tut-cursor'; document.body.append(c);
    const p = window.__tutPos || { x: -40, y: -40 };
    c.style.left = p.x + 'px'; c.style.top = p.y + 'px';
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; window.__tutPos = { x: e.clientX, y: e.clientY }; try { sessionStorage.setItem('tutPos', JSON.stringify(window.__tutPos)); } catch (_) {} }, true);
    addEventListener('mousedown', () => c.classList.add('click'), true);
    addEventListener('mouseup', () => c.classList.remove('click'), true);
  };
  try { window.__tutPos = JSON.parse(sessionStorage.getItem('tutPos')); } catch (_) {}
  window.__legenda = (html) => { montar(); const l = document.getElementById('tut-legenda'); if (!html) { l.classList.remove('on'); return; } l.innerHTML = html; l.classList.add('on'); };
  window.__capa = (titulo, sub) => {
    montar();
    let k = document.getElementById('tut-capa');
    if (!titulo) { if (k) { k.style.opacity = 0; setTimeout(() => k.remove(), 500); } return; }
    if (!k) { k = document.createElement('div'); k.id = 'tut-capa'; document.body.append(k); }
    k.innerHTML = `<div class="selo">📒</div><h1>${titulo}</h1><p>${sub || ''}</p>`;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar); else montar();
};

function servir() {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const arq = path.join(RAIZ, rel);
    if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TIPOS[path.extname(arq)] || 'application/octet-stream' });
    fs.createReadStream(arq).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

(async () => {
  const srv = await servir();
  const url = `http://127.0.0.1:${srv.address().port}/index.html`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: SAIDA, size: { width: 1280, height: 720 } }, colorScheme: 'light', locale: 'pt-BR' });
  await ctx.route('**/js/config-nuvem.js', (r) => r.fulfill({ contentType: 'text/javascript', body: CONFIG }));
  if (fs.existsSync(FONTES)) {
    await ctx.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: 'text/css', body: CSS_FONTES }));
    await ctx.route(/fonts\.gstatic\.com\/lc\//, (r) => r.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(path.join(FONTES, new URL(r.request().url()).pathname.replace('/lc/', ''))) }));
  } else await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.addInitScript(SOBREPOSICAO);
  const page = await ctx.newPage();
  const t0 = Date.now(); // o vídeo começa junto com a página

  // Narração: duração de cada fala (s), se existir. fala(id) espera a fala anterior acabar e marca o início desta.
  const duracoes = {};
  const falas = path.join(DIR, 'falas');
  if (fs.existsSync(falas)) for (const f of fs.readdirSync(falas).filter((x) => x.endsWith('.mp3'))) {
    duracoes[f.slice(0, -4)] = +require('node:child_process').execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(falas, f)]).toString();
  }
  const marcas = [];
  let livre = 0; // quando a fala atual termina (ms desde t0)
  async function fala(id) {
    const agora = Date.now() - t0;
    if (livre > agora) await page.waitForTimeout(livre - agora);
    const inicio = Date.now() - t0;
    if (duracoes[id]) { marcas.push({ id, inicio: inicio / 1000 }); livre = inicio + duracoes[id] * 1000 + 350; }
  }
  const esperarFala = async () => { const resta = livre - (Date.now() - t0); if (resta > 0) await page.waitForTimeout(resta); };
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.setDefaultTimeout(20000);

  const pausa = (ms) => page.waitForTimeout(ms);
  const legenda = async (html, ms = 0) => { await page.evaluate((h) => window.__legenda(h), html); if (ms) await pausa(ms); };
  async function mover(alvo) {
    const loc = typeof alvo === 'string' ? page.locator(alvo).first() : alvo;
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 22 });
    await pausa(250);
    return loc;
  }
  async function clicar(alvo, depois = 600) { await mover(alvo); await page.mouse.down(); await pausa(90); await page.mouse.up(); await pausa(depois); }
  async function digitar(alvo, texto) { await clicar(alvo, 200); await page.keyboard.type(texto, { delay: 55 }); await pausa(300); }
  async function rolar(alvo) { await page.locator(alvo).first().evaluate((n) => n.scrollIntoView({ behavior: 'smooth', block: 'center' })); await pausa(900); }

  await page.goto(url);
  await page.waitForSelector('#acesso');
  await fala('capa');
  await page.evaluate(() => window.__capa('Livro-Caixa', 'Como usar o controle financeiro da casa<br>login, planilha mensal, gráficos e saldo de cada um'));
  await page.mouse.move(640, 650);
  await pausa(4200);
  await page.evaluate(() => window.__capa(null));
  await pausa(700);

  // 1. Conta
  await fala('conta');
  await legenda('<b>1.</b> Primeiro acesso: toque em <b>Criar conta</b> e use o seu e-mail e uma senha');
  await clicar('.acesso .segmento:has-text("Criar conta")');
  await digitar('#acesso-email', 'nathy@exemplo.com');
  await digitar('#acesso-senha', 'minhasenha');
  await digitar('#acesso-senha2', 'minhasenha');
  await clicar('.acesso-form button[type="submit"]', 300);
  await page.waitForSelector('#acesso-titulo:has-text("Abrir o livro-caixa")');
  await pausa(800);
  await fala('livro');
  await legenda('<b>2.</b> Crie o livro-caixa e escreva o e-mail de quem vai usar junto');
  await pausa(1200);
  await digitar('#acesso-outros', 'vini@exemplo.com');
  await fala('outra');
  await legenda('A outra pessoa cria a conta com esse e-mail e abre o <b>mesmo</b> livro-caixa, em qualquer aparelho', 2600);
  await clicar('button:has-text("Criar o livro-caixa")', 300);
  await page.waitForSelector('#acesso', { state: 'detached' });
  await page.waitForSelector('#carregando', { state: 'hidden' });
  await fala('exemplos');
  await legenda('Ele começa com <b>valores de exemplo</b>, só para você conhecer as telas', 3200);

  // 3. Importar
  await fala('importar');
  await legenda('<b>3.</b> Traga a sua planilha: <b>Importar minha planilha</b> e escolha o Gastos.xlsx');
  await clicar('button:has-text("Importar minha planilha")', 500);
  await page.setInputFiles('#imp-arquivo', PLANILHA);
  await page.waitForSelector('.imp-abas');
  await pausa(900);
  await fala('abas');
  await legenda('Ele reconhece cada aba, pergunta de quem é e mostra quanto entra em cada ano', 3800);
  await mover('.dialogo-rodape .botao-primario');
  await legenda('Os exemplos saem e entram os seus valores', 1400);
  await clicar('.dialogo-rodape .botao-primario', 1200);

  // 4. Mensal
  await fala('mensal');
  await legenda('<b>4.</b> A tela <b>Mensal</b> é a sua planilha: um mês por linha, uma categoria por coluna', 3200);
  const celula = page.locator('.grade-mensal tr[data-mes="2026-10"] td[data-cat]').first();
  await fala('digitar');
  await legenda('Clique numa célula e digite o total do mês, como no Excel');
  await clicar(celula, 300);
  await page.keyboard.type('320', { delay: 120 });
  await pausa(300);
  await page.keyboard.press('Enter');
  await pausa(900);
  await legenda('<b>Total gasto</b> e <b>Total restante</b> se calculam sozinhos', 2600);
  await clicar('.aba-mensal:has-text("Total")', 900);
  await fala('total');
  await legenda('A aba <b>Total finanças</b> soma todo mundo, igual à planilha', 3000);

  // 5. Painel
  await clicar('[data-vista="painel"]', 900);
  await page.evaluate(() => scrollTo({ top: 0 }));
  await fala('painel');
  await legenda('<b>5.</b> No <b>Painel</b>: o saldo de hoje, quanto sobra depois das contas do mês e o saldo de cada pessoa');
  await mover('.heroi-valor');
  await pausa(2000);
  await mover('.heroi-contas');
  await pausa(1800);
  await rolar('.cg[data-id="g-grupos"]');
  await fala('grupos');
  await legenda('Os gastos ficam em <b>grupos</b>: clique num grupo para ver as categorias dele');
  await pausa(1300);
  const fatia = await page.evaluate(() => {
    const c = Chart.getChart(document.querySelector('.cg[data-id="g-grupos"] canvas'));
    const p = c.getDatasetMeta(0).data[0].tooltipPosition(); const r = c.canvas.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.mouse.move(fatia.x, fatia.y, { steps: 22 }); await pausa(500);
  await page.mouse.down(); await pausa(90); await page.mouse.up();
  await pausa(2600);
  await legenda('<b>Todos os grupos</b> volta', 600);
  await clicar('.cg[data-id="g-grupos"] .cg-voltar', 1500);
  await rolar('.cg[data-id="g-fixos"]');
  await fala('fixos');
  await legenda('<b>Fixos x variáveis</b>: quanto foi conta fixa e quanto foi o resto, mês a mês');
  await mover('.cg[data-id="g-fixos"] canvas');
  await pausa(3000);
  await rolar('.cg[data-id="g-fluxo"]');
  await fala('editar');
  await legenda('Todo gráfico se edita no <b>lápis</b>: tipo, dados, pessoas, cores e tamanho');
  await clicar('.cg[data-id="g-fluxo"] button[aria-label="Editar gráfico"]', 1000);
  await clicar('.gaveta .tipos-grafico .segmento:nth-child(3)', 1300);
  await clicar('.gaveta .tipos-grafico .segmento:nth-child(4)', 1300);
  await legenda('A prévia muda na hora. <b>Cancelar</b> deixa como estava', 1200);
  await clicar('.gaveta-rodape button:has-text("Cancelar")', 800);

  // 6. Cadastros
  await clicar('[data-vista="cadastros"]', 900);
  await page.evaluate(() => scrollTo({ top: 0 }));
  await fala('saldo');
  await legenda('<b>6.</b> Em <b>Cadastros</b>, digite quanto cada pessoa tem hoje no banco');
  await clicar('#saldo-hoje-nathy', 200);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('2.350,00', { delay: 90 });
  await page.keyboard.press('Enter');
  await pausa(1300);
  await legenda('Daí em diante o saldo soma o que entra e tira o que sai', 2400);
  await rolar('.cadastro-grupo');
  await fala('categorias');
  await legenda('As categorias ficam por <b>grupo</b>, e cada uma pode ser marcada como <b>gasto fixo</b>');
  await mover('.cadastro-abaixo .cadastro-fixo');
  await pausa(2800);
  await rolar('.acesso-cartao');
  await fala('acesso');
  await legenda('Aqui você vê <b>quem usa</b> o livro-caixa, adiciona e-mails e sai da conta');
  await mover('.acesso-novo .entrada');
  await pausa(3000);

  // 7. Exportar
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' }));
  await pausa(700);
  await fala('exportar');
  await legenda('<b>7.</b> <b>Exportar</b> gera o Excel no mesmo formato da sua planilha, com fórmulas e gráficos');
  await clicar('#acao-exportar', 2600);
  await page.keyboard.press('Escape');
  await pausa(500);
  await legenda(null);
  await fala('fim');
  await page.evaluate(() => window.__capa('Pronto!', 'Tudo o que um digita aparece na tela do outro, em qualquer aparelho.<br>Sem internet, fica guardado e sobe quando ela volta.'));
  await pausa(4200);
  await esperarFala();
  await pausa(800);

  const video = page.video();
  await ctx.close();
  const caminho = await video.path();
  await browser.close();
  srv.close();
  fs.renameSync(caminho, path.join(SAIDA, 'tutorial.webm'));
  fs.writeFileSync(path.join(SAIDA, 'marcas.json'), JSON.stringify(marcas, null, 1));
  console.log(`vídeo em tutorial/saida/tutorial.webm · ${marcas.length} falas marcadas`);
  console.log('ERROS:', erros.join(' | ') || 'nenhum');
})().catch((e) => { console.error(e); process.exit(1); });
