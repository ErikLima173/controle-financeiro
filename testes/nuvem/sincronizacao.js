/*
 * Login, cadastro e livro-caixa compartilhado, testados com os emuladores do Firebase (nada vai para a internet).
 *
 *   npm install -g firebase-tools                       (os emuladores precisam de Java 11 ou mais novo)
 *   npm install --no-save playwright && npx playwright install chromium
 *   firebase emulators:exec --project demo-livro-caixa "node testes/nuvem/sincronizacao.js"
 *
 * O que confere: cadastro e login; duas contas no mesmo livro-caixa, vendo as mudanças uma da outra
 * na hora; quem está fora da lista (ou não confirmou o e-mail) não lê nem grava nada; sem internet o valor fica no
 * aparelho e sobe quando ela volta; tirar alguém da lista corta o acesso; sair e entrar de novo; os valores que já
 * estavam no navegador sobem para um livro-caixa novo.
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
  console.error('Este teste precisa do Playwright: npm install --no-save playwright && npx playwright install chromium');
  process.exit(2);
}

const RAIZ = path.resolve(__dirname, '..', '..');
const PROJETO = 'demo-livro-caixa';
const AUTH = 'http://127.0.0.1:9099';
const CAPTURAS = process.env.CAPTURAS || path.join(os.tmpdir(), 'livro-caixa-capturas');
const CONFIG_NUVEM = `globalThis.LC_FIREBASE = ${JSON.stringify({
  apiKey: 'chave-de-teste', authDomain: `${PROJETO}.firebaseapp.com`, projectId: PROJETO, appId: '1:1:web:1',
  emuladores: { auth: AUTH, firestore: '127.0.0.1:8080' },
})};`;
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

const SENHA = 'senha-de-teste-1';
const sufixo = Date.now().toString(36);
const EMAIL = (nome) => `${nome}.${sufixo}@exemplo.com`;
const MES = ((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)(new Date()); // mês de hoje, no fuso do aparelho
const celula = (cat) => `.grade-mensal td[data-cat="${cat}"][data-mes="${MES}"]`;

let falhas = 0;
const ok = (m) => console.log('  ✓', m);
const falhar = (m) => { falhas++; console.log('  ✗', m); };
const conferir = (cond, m) => (cond ? ok(m) : falhar(m));

function servir() {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const arquivo = path.join(RAIZ, rel);
    if (!arquivo.startsWith(RAIZ) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TIPOS[path.extname(arquivo)] || 'application/octet-stream' });
    fs.createReadStream(arquivo).pipe(res);
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

async function criarConta(page, email) {
  await page.click('.acesso .segmento:has-text("Criar conta")');
  await page.fill('#acesso-email', email);
  await page.fill('#acesso-senha', SENHA);
  await page.fill('#acesso-senha2', SENHA);
  await page.click('.acesso-form button[type="submit"]');
}

async function aberto(page) {
  await page.waitForSelector('#acesso', { state: 'detached', timeout: 20000 });
  await page.waitForSelector('#carregando', { state: 'hidden', timeout: 20000 });
}

const status = (page) => page.textContent('#status-salvamento');
const esperarStatus = (page, texto, timeout = 15000) =>
  page.waitForFunction((t) => (document.querySelector('#status-salvamento')?.textContent || '').includes(t), texto, { timeout });

async function digitar(page, cat, valor) {
  await page.click(celula(cat));
  await page.keyboard.press('F2');
  await page.keyboard.press('Control+A');
  await page.keyboard.type(String(valor));
  await page.keyboard.press('Enter');
}

// Espera a célula mostrar o valor; aguenta a página recarregar no meio (quem estava nos exemplos recarrega sozinho).
async function temValor(page, cat, valor, timeout = 15000) {
  const fim = Date.now() + timeout;
  for (;;) {
    try {
      await page.waitForFunction(([sel, v]) => (document.querySelector(sel)?.textContent || '').replace(/\D/g, '').startsWith(String(v)),
        [celula(cat), valor], { timeout: Math.max(500, fim - Date.now()) });
      return;
    } catch (e) {
      if (Date.now() >= fim || !/context was destroyed|navigat/i.test(String(e))) throw e;
      await page.waitForLoadState('load').catch(() => {});
    }
  }
}

(async () => {
  fs.mkdirSync(CAPTURAS, { recursive: true });
  const srv = await servir();
  const url = `http://127.0.0.1:${srv.address().port}/index.html`;
  const browser = await chromium.launch();
  const pessoas = [];

  async function abrirNavegador(nome, { celular = false, escuro = false, configNuvem = CONFIG_NUVEM } = {}) {
    const ctx = await browser.newContext(celular
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: escuro ? 'dark' : 'light', serviceWorkers: 'block' }
      : { viewport: { width: 1280, height: 860 }, colorScheme: escuro ? 'dark' : 'light', serviceWorkers: 'block' });
    // serviceWorkers: 'block' — o sw.js do app buscaria a configuração real do Firebase por fora da troca feita aqui.
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = { nome, ctx, config: configNuvem, erros: [], offline: false };
    await ctx.route('**/js/config-nuvem.js', (r) => r.fulfill({ contentType: 'text/javascript', body: p.config }));
    p.page = await ctx.newPage();
    p.page.on('pageerror', (e) => p.erros.push('página: ' + e.message));
    p.page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/net::ERR_INTERNET_DISCONNECTED|Failed to load resource|Could not reach Cloud Firestore|ERR_NETWORK_CHANGED/.test(t)) return; // fase sem internet
      if (/Missing or insufficient permissions/.test(t)) return; // tentativas negadas de propósito
      p.erros.push('console: ' + t);
    });
    pessoas.push(p);
    return p;
  }

  try {
    console.log('▸ cadastro e confirmação do e-mail');
    const A = await abrirNavegador('A');
    await A.page.goto(url);
    await A.page.waitForSelector('#acesso-titulo:has-text("Entrar no livro-caixa")');
    ok('sem conta, abre a tela de entrar');
    await A.page.screenshot({ path: path.join(CAPTURAS, 'nuvem-entrar.png') });
    await A.page.click('.acesso .segmento:has-text("Criar conta")');
    await A.page.fill('#acesso-email', EMAIL('a'));
    await A.page.fill('#acesso-senha', '123');
    await A.page.fill('#acesso-senha2', '123');
    await A.page.click('.acesso-form button[type="submit"]');
    conferir((await A.page.textContent('.acesso-aviso')).includes('6 caracteres'), 'senha curta: avisa antes de mandar');
    await A.page.fill('#acesso-senha', SENHA);
    await A.page.fill('#acesso-senha2', SENHA + 'x');
    await A.page.click('.acesso-form button[type="submit"]');
    conferir((await A.page.textContent('.acesso-aviso')).includes('diferentes'), 'senhas diferentes: avisa');
    await A.page.fill('#acesso-senha2', SENHA);
    await A.page.click('.acesso-form button[type="submit"]');
    await A.page.waitForSelector('#acesso-titulo:has-text("Abrir o livro-caixa")');
    ok('conta criada: oferece criar o livro-caixa, sem esperar e-mail');
    await A.page.screenshot({ path: path.join(CAPTURAS, 'nuvem-sem-livro.png') });
    await A.page.fill('#acesso-outros', `${EMAIL('b')}, isto-nao-e-email`);
    await A.page.click('button:has-text("Criar o livro-caixa")');
    conferir((await A.page.textContent('.acesso-bloco .acesso-aviso:not([hidden])')).includes('isto-nao-e-email'), 'e-mail inválido na lista: avisa qual');
    await A.page.fill('#acesso-outros', EMAIL('b'));
    await A.page.click('button:has-text("Criar o livro-caixa")');
    await aberto(A.page);
    conferir((await status(A.page)).includes('Exemplo'), 'livro-caixa novo abre com os exemplos, sem gravar nada');

    console.log('▸ duas contas no mesmo livro-caixa, ao vivo');
    const B = await abrirNavegador('B', { celular: true });
    await B.page.goto(url);
    await B.page.waitForSelector('#acesso');
    await B.page.screenshot({ path: path.join(CAPTURAS, 'nuvem-entrar-celular.png') });
    const largura = await B.page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    conferir(largura[0] <= largura[1], `tela de entrar no celular sem rolagem lateral (${largura[0]} ≤ ${largura[1]})`);
    await criarConta(B.page, EMAIL('b'));
    await aberto(B.page);
    ok('B entrou e o livro-caixa abriu direto (o e-mail de B estava na lista)');
    conferir((await status(B.page)).includes('Exemplo'), 'B também vê os exemplos: ninguém gravou nada ainda');
    await B.page.click('[data-vista="mensal"]');
    await A.page.click('[data-vista="mensal"]');
    await digitar(A.page, 'academia', 321);
    await esperarStatus(A.page, 'Salvo na nuvem');
    ok('A digitou na planilha mensal e o status mostra "Salvo na nuvem"');
    await temValor(B.page, 'academia', 321).then(() => ok('B, que estava nos exemplos, passa a ver o valor de A sozinho'), () => falhar('B ficou nos exemplos e não recebeu o valor de A'));
    await B.page.screenshot({ path: path.join(CAPTURAS, 'nuvem-mensal-celular.png') });
    await digitar(B.page, 'cartao', 654);
    await esperarStatus(B.page, 'Salvo na nuvem');
    await temValor(A.page, 'cartao', 654).then(() => ok('A vê a mudança de B na hora, sem recarregar'), () => falhar('A não recebeu a mudança de B'));

    const t0 = Date.now();
    await A.page.reload();
    await aberto(A.page);
    const ms = Date.now() - t0;
    conferir(ms < 4000, `A recarrega: abre direto, sem pedir login (${ms} ms)`);
    await A.page.click('[data-vista="mensal"]');
    await temValor(A.page, 'cartao', 654).then(() => ok('depois de recarregar, os valores continuam'), () => falhar('valores sumiram ao recarregar'));

    console.log('▸ quem está fora da lista');
    const C = await abrirNavegador('C', { escuro: true });
    await C.page.goto(url);
    await criarConta(C.page, EMAIL('c'));
    await C.page.waitForSelector('#acesso-titulo:has-text("Abrir o livro-caixa")');
    ok('C (fora da lista) não encontra nenhum livro-caixa');
    await C.page.screenshot({ path: path.join(CAPTURAS, 'nuvem-sem-livro-escuro.png') });
    const livro = await A.page.evaluate(() => LivroCaixa.armazenamento.sessao.livro.id);
    const tentativas = await C.page.evaluate(async (id) => {
      const db = firebase.firestore();
      const r = {};
      const tentar = async (nome, fn) => { try { await fn(); r[nome] = 'conseguiu'; } catch (e) { r[nome] = e.code; } };
      await tentar('ler a lista de e-mails', () => db.doc(`livros/${id}`).get({ source: 'server' }));
      await tentar('ler a configuração', () => db.doc(`livros/${id}/livro/config`).get({ source: 'server' }));
      await tentar('ler os meses', () => db.collection(`livros/${id}/livro/config/meses`).get({ source: 'server' }));
      await tentar('se pôr na lista', () => db.doc(`livros/${id}`).update({ emails: firebase.firestore.FieldValue.arrayUnion(firebase.auth().currentUser.email) }));
      await tentar('gravar um mês', () => db.doc(`livros/${id}/livro/config/meses/2026-01`).set({ itens: [] }));
      await tentar('criar um livro em nome de outra pessoa', () => db.collection('livros').add({ nome: 'x', emails: ['outra@exemplo.com'], criadoPor: firebase.auth().currentUser.uid }));
      return r;
    }, livro);
    for (const [acao, r] of Object.entries(tentativas)) conferir(r === 'permission-denied', `C não consegue ${acao} (${r})`);

    console.log('▸ sem internet');
    await A.ctx.setOffline(true);
    await digitar(A.page, 'jogos', 777);
    await esperarStatus(A.page, 'Sem internet');
    ok('sem internet: o status avisa e o valor fica na tela');
    await A.ctx.setOffline(false);
    await esperarStatus(A.page, 'Salvo na nuvem', 30000).then(() => ok('a internet volta: o status volta para "Salvo na nuvem"'), () => falhar('não voltou a salvar depois da internet voltar'));
    await temValor(B.page, 'jogos', 777, 30000).then(() => ok('B recebe o valor que A digitou sem internet'), () => falhar('B não recebeu o valor digitado sem internet'));

    console.log('▸ lista de quem usa');
    await A.page.click('[data-vista="cadastros"]');
    await A.page.waitForSelector('.acesso-cartao');
    conferir((await A.page.textContent('.lista-acesso')).includes(EMAIL('b')), 'Cadastros mostra quem usa o livro-caixa');
    await A.page.screenshot({ path: path.join(CAPTURAS, 'nuvem-cadastros.png'), fullPage: true });
    await A.page.fill('#acesso-novo', EMAIL('c'));
    await A.page.click('.acesso-novo button[type="submit"]');
    await A.page.waitForFunction((e) => document.querySelector('.lista-acesso')?.textContent.includes(e), EMAIL('c'));
    ok('A adiciona C pela tela de Cadastros');
    await C.page.click('button:has-text("Procurar de novo")');
    await aberto(C.page);
    ok('C toca em "Procurar de novo" e o livro-caixa abre');
    await A.page.click(`button[aria-label="Tirar ${EMAIL('c')} da lista"]`);
    await A.page.click('dialog .botao-perigo');
    await A.page.waitForFunction((e) => !document.querySelector('.lista-acesso')?.textContent.includes(e), EMAIL('c'));
    ok('A tira C da lista');
    await C.page.waitForSelector('#acesso-titulo:has-text("Não deu para abrir o livro-caixa")', { timeout: 15000 })
      .then(() => ok('C perde o acesso na hora: a tela avisa que o e-mail saiu da lista'), () => falhar('C não foi avisado ao sair da lista'));
    await C.page.screenshot({ path: path.join(CAPTURAS, 'nuvem-perdeu-acesso.png') });
    const gravou = await C.page.evaluate(async (id) => {
      try { await firebase.firestore().doc(`livros/${id}/livro/config/meses/2026-02`).set({ itens: [] }); return 'conseguiu'; } catch (e) { return e.code; }
    }, livro);
    conferir(gravou === 'permission-denied', `C também não grava mais nada (${gravou})`);

    console.log('▸ sair e entrar de novo');
    await A.page.click('.conta-linha button:has-text("Sair da conta")');
    await A.page.click('dialog .botao-primario');
    await A.page.waitForSelector('#acesso-titulo:has-text("Entrar no livro-caixa")');
    ok('sair volta para a tela de entrar');
    await A.page.fill('#acesso-email', EMAIL('a'));
    await A.page.fill('#acesso-senha', 'senha-errada');
    await A.page.click('.acesso-form button[type="submit"]');
    await A.page.waitForSelector('.acesso-aviso:has-text("E-mail ou senha incorretos")');
    ok('senha errada: "E-mail ou senha incorretos."');
    await A.page.click('button:has-text("Esqueci minha senha")');
    await A.page.click('.acesso-form button[type="submit"]');
    await A.page.waitForSelector('.acesso-aviso.ok');
    const { oobCodes } = await (await fetch(`${AUTH}/emulator/v1/projects/${PROJETO}/oobCodes`)).json();
    conferir(oobCodes.some((c) => c.email === EMAIL('a') && c.requestType === 'PASSWORD_RESET'), '"Esqueci minha senha" manda o link de senha nova');
    await A.page.click('button:has-text("Voltar para entrar")');
    await A.page.fill('#acesso-senha', SENHA);
    await A.page.click('.acesso-form button[type="submit"]');
    await aberto(A.page);
    await A.page.click('[data-vista="mensal"]');
    await temValor(A.page, 'jogos', 777).then(() => ok('entrar de novo abre o mesmo livro-caixa, com os valores'), () => falhar('valores não apareceram depois de entrar de novo'));

    console.log('▸ valores que já estavam no navegador');
    const D = await abrirNavegador('D', { configNuvem: 'globalThis.LC_FIREBASE = null;' });
    await D.page.goto(url);
    await D.page.waitForSelector('#carregando', { state: 'hidden' });
    await D.page.click('[data-vista="mensal"]');
    await digitar(D.page, 'compras', 432);
    await esperarStatus(D.page, 'Salvo neste navegador');
    ok('sem o Firebase ligado, salva no navegador como antes');
    D.config = CONFIG_NUVEM;
    await D.page.reload();
    await criarConta(D.page, EMAIL('d'));
    await D.page.click('button:has-text("Criar o livro-caixa")');
    await aberto(D.page);
    await D.page.waitForSelector('.aviso:has-text("foram para o livro-caixa na nuvem")').then(() => ok('livro-caixa novo: avisa que os valores do navegador subiram'), () => falhar('não avisou da subida dos valores'));
    await esperarStatus(D.page, 'Salvo na nuvem');
    await D.page.click('[data-vista="mensal"]');
    await D.page.reload();
    await aberto(D.page);
    await temValor(D.page, 'compras', 432).then(() => ok('o valor do navegador está na nuvem depois de recarregar'), () => falhar('o valor do navegador não subiu'));

    for (const p of pessoas) conferir(!p.erros.length, `${p.nome}: nenhum erro na página${p.erros.length ? ':\n      ' + p.erros.join('\n      ') : ''}`);
  } catch (e) {
    falhar('o teste parou: ' + (e && e.stack || e));
    for (const p of pessoas) { try { await p.page.screenshot({ path: path.join(CAPTURAS, `nuvem-erro-${p.nome}.png`) }); } catch (_) { /* página fechada */ } }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(falhas ? `\n✗ ${falhas} problema(s) · capturas em ${CAPTURAS}` : `\n✓ tudo certo · capturas em ${CAPTURAS}`);
  process.exit(falhas ? 1 : 0);
})();
