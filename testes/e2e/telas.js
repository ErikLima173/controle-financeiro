/*
 * telas.js — Passa por todas as telas no computador (claro e escuro) e no celular.
 *
 *   para cada tamanho: abre ─► erros de console/página/rede? ─► rola na horizontal?
 *   ─► clica em cada item do menu (uma captura por tela) ─► na tela Mensal, a linha de Dezembro
 *   aparece em todas as abas, ou fica escondida atrás da linha de Total?
 *   ─► lê a planilha de exemplo com o leitor do app e confere a aba "Total finanças"
 *
 * Uso: node testes/e2e/telas.js        (capturas na pasta temporária, ou em $CAPTURAS)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PLANILHA, ESPERADO, CAPTURAS, falhar, ok, perto, abrir, executar } = require('./comum');

const MENU = 'nav a, nav button, [role=navigation] a, [role=navigation] button';
const nomeArquivo = (t) => (t || 'item').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 30);

// A última linha do corpo da tabela (Dezembro) tem de ser a que aparece no meio dela, não o rodapé.
async function dezembroVisivel(page) {
  return page.evaluate(() => {
    const linhas = document.querySelectorAll('table.grade-mensal tbody tr');
    const dez = linhas[linhas.length - 1];
    if (!dez) return 'sem tabela';
    dez.scrollIntoView({ block: 'center' });
    const r = dez.getBoundingClientRect();
    const na = document.elementFromPoint(r.left + Math.min(60, r.width / 2), r.top + r.height / 2);
    return dez.contains(na) ? '' : `coberta por "${(na && na.closest('tr') ? na.closest('tr').innerText : '?').trim().replace(/\s+/g, ' ').slice(0, 30)}"`;
  });
}

executar('telas', async ({ browser, url, erros }) => {
  for (const [rotulo, viewport, colorScheme] of [
    ['computador-claro', { width: 1440, height: 900 }, 'light'],
    ['computador-escuro', { width: 1440, height: 900 }, 'dark'],
    ['celular', { width: 390, height: 844 }, 'light'],
  ]) {
    console.log(`\n▸ ${rotulo} (${viewport.width}×${viewport.height}, tema ${colorScheme === 'dark' ? 'escuro' : 'claro'})`);
    const antes = erros.length;
    const { ctx, page } = await abrir(browser, url, { rotulo, viewport, colorScheme, erros });
    await page.screenshot({ path: path.join(CAPTURAS, `${rotulo}-inicio.png`), fullPage: true });

    const [larg, janela] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (larg > janela + 1) falhar(`${rotulo}: a página rola na horizontal (${larg}px numa janela de ${janela}px)`);
    else ok(`${rotulo}: a página não rola na horizontal`);

    const menu = page.locator(MENU).filter({ visible: true });
    const itens = await menu.evaluateAll((els) => els.map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ')));
    console.log(`  menu: ${itens.join(' | ') || '(nenhum item visível)'}`);
    for (let i = 0; i < itens.length; i++) {
      try {
        await page.locator(MENU).filter({ visible: true }).nth(i).click({ timeout: 3000 });
      } catch (e) {
        falhar(`${rotulo}: não deu para clicar em "${itens[i]}": ${e.message.split('\n')[0]}`);
        continue;
      }
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(CAPTURAS, `${rotulo}-${String(i + 1).padStart(2, '0')}-${nomeArquivo(itens[i])}.png`), fullPage: true });

      if (itens[i] === 'Mensal') {
        const abas = (await page.getByRole('tab').allInnerTexts()).map((a) => a.trim());
        let cobertas = 0;
        for (const aba of abas) {
          await page.getByRole('tab', { name: aba, exact: true }).click();
          await page.waitForTimeout(150);
          const problema = await dezembroVisivel(page);
          if (problema) { cobertas++; falhar(`${rotulo}: Mensal › ${aba}: a linha de Dezembro está ${problema}`); }
        }
        if (abas.length && !cobertas) ok(`${rotulo}: Mensal: a linha de Dezembro aparece nas ${abas.length} abas (${abas.join(', ')})`);
      }
    }

    // O leitor de planilhas do próprio app (LC.Arquivos.lerXLSX) com a planilha de exemplo.
    if (rotulo === 'computador-claro') {
      const abas = await page.evaluate(async (bytes) => {
        const A = window.LC && window.LC.Arquivos;
        if (!A || !A.lerXLSX) return null;
        return (await A.lerXLSX(new Uint8Array(bytes).buffer)).map((a) => ({ nome: a.nome, linhas: a.linhas.slice(0, 30) }));
      }, [...fs.readFileSync(PLANILHA)]);
      if (!abas) falhar('leitor: LC.Arquivos.lerXLSX não existe');
      else {
        const total = abas.find((a) => a.nome === 'Total finanças');
        if (!total) falhar('leitor: a aba "Total finanças" não apareceu');
        else {
          let dif = 0;
          ESPERADO.meses.forEach((m, k) => {
            const lin = total.linhas[k + 1] || [];
            const [rec, gas, rest] = lin.slice(1, 4).map(Number);
            if (!perto(rec, m.total.recebido) || !perto(gas, m.total.gasto) || !perto(rest, m.total.restante)) {
              dif++;
              falhar(`leitor: ${m.mes} lido como ${lin.slice(1, 4).join('/')}; esperado ${m.total.recebido}/${m.total.gasto}/${m.total.restante}`);
            }
          });
          if (!dif) ok('leitor: os 12 meses de "Total finanças" batem com o resultado das fórmulas');
        }
        const oculta = abas.find((a) => a.nome === 'Gastos');
        if (oculta) ok(`leitor: a aba oculta "Gastos" também foi lida (${oculta.linhas.length} linhas)`);
        else falhar('leitor: a aba oculta "Gastos" não foi lida');
      }
    }

    if (erros.length === antes) ok(`${rotulo}: nenhum erro de console, de página ou de arquivo`);
    await ctx.close();
  }
});
