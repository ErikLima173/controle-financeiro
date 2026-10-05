/*
 * importacao.js — Importa a planilha de exemplo pela tela, como o Erik faria, e confere a aba
 * "Total finanças" do Livro-Caixa com o resultado das fórmulas da própria planilha.
 *
 *   cenário 1: só "Gastos Nathy" e "Gastos vini" (aba oculta "Gastos" desligada)
 *              ─► 2026 bate com a "Total finanças" do Excel, mês a mês e por pessoa?
 *              ─► os exemplos saem? recarregar mantém tudo? importar de novo não soma duas vezes?
 *   cenário 2: tudo ligado (o padrão do assistente)
 *              ─► 2025 vem da aba oculta; 2026 = pessoas + bloco de 2026 da aba oculta
 *
 * Uso: node testes/e2e/importacao.js        (capturas na pasta temporária, ou em $CAPTURAS)
 */
'use strict';

const path = require('node:path');
const { PLANILHA, ESPERADO, CAPTURAS, falhar, ok, perto, moeda, abrir, executar } = require('./comum');

const ANO = 2026;

async function importar(page, { desligar = [], captura } = {}) {
  await page.getByRole('button', { name: /^Importar/ }).first().click();
  await page.locator('#imp-arquivo').setInputFiles(PLANILHA);
  await page.getByText(/^Encontrei \d+ planilhas? mensa/).waitFor();
  const abas = await page.locator('.imp-aba .interruptor-rotulo').allInnerTexts();
  for (const nome of desligar) {
    const i = abas.indexOf(nome);
    if (i < 0) { falhar(`assistente: a aba "${nome}" não apareceu`); continue; }
    if (await page.locator(`#imp-incluir-${i}`).isChecked()) await page.locator(`label[for="imp-incluir-${i}"]`).click();
  }
  if (captura) {
    console.log(`  abas no assistente: ${abas.join(' | ')}`);
    (await page.locator('.imp-resumo li').allInnerTexts()).forEach((l) => console.log(`    · ${l}`));
    await page.screenshot({ path: path.join(CAPTURAS, captura), fullPage: true });
  }
  await page.locator('.dialogo-rodape .botao-primario').click();
  await page.locator('dialog[open]').waitFor({ state: 'detached' });
}

// Lê a tabela da aba "Total finanças" do ano pedido: [{ recebido, gasto, restante, pessoas: {nome: restante} }]
async function lerTotal(page, ano) {
  if (!(await page.getByRole('tab', { name: 'Total finanças' }).count())) {
    await page.locator('nav').getByText('Mensal', { exact: true }).click();
  }
  await page.getByRole('tab', { name: 'Total finanças' }).click();
  for (let i = 0; i < 5; i++) {
    const atual = +(await page.locator('.ano-valor').innerText());
    if (atual === ano) break;
    await page.getByRole('button', { name: atual > ano ? 'Ano anterior' : 'Próximo ano' }).click();
  }
  const cab = await page.locator('table.grade-total thead tr.linha-titulos th').allInnerTexts();
  const linhas = await page.locator('table.grade-total tbody tr').evaluateAll((trs) =>
    trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText)));
  const col = (nome) => cab.findIndex((c) => c.trim() === nome) - 2; // menos as colunas do número da linha e do mês
  const pessoas = cab.map((c) => c.trim()).filter((c) => c.startsWith('Restante '));
  return linhas.map((l) => ({
    recebido: moeda(l[col('Total recebido')]),
    gasto: moeda(l[col('Total gasto')]),
    restante: moeda(l[col('Total restante')]),
    pessoas: Object.fromEntries(pessoas.map((c) => [c.slice(9).toLowerCase(), moeda(l[col(c)])])),
  }));
}

function conferir(rotulo, lidos, esperados) {
  let dif = 0;
  esperados.forEach((e, k) => {
    const l = lidos[k] || { pessoas: {} };
    for (const [campo, valor] of Object.entries(e.valores)) {
      const v = campo.startsWith('restante ') ? l.pessoas[campo.slice(9)] : l[campo];
      if (!perto(v ?? 0, valor)) { dif++; falhar(`${rotulo}, ${e.mes}: ${campo} = ${v}; esperado ${valor}`); }
    }
  });
  if (!dif) ok(`${rotulo}: os 12 meses batem (${Object.keys(esperados[0].valores).join(', ')})`);
}

executar('importação', async ({ browser, url, erros }) => {
  console.log('\n▸ cenário 1: só "Gastos Nathy" e "Gastos vini"');
  {
    const { ctx, page } = await abrir(browser, url, { rotulo: 'cenário 1', erros });
    await importar(page, { desligar: ['Gastos'], captura: 'importacao-assistente-pessoas.png' });
    const lidos = await lerTotal(page, ANO);
    await page.screenshot({ path: path.join(CAPTURAS, 'importacao-total-financas-2026.png'), fullPage: true });
    conferir(`Total finanças ${ANO}`, lidos, ESPERADO.meses.map((m) => ({
      mes: m.mes,
      valores: { recebido: m.total.recebido, gasto: m.total.gasto, restante: m.total.restante,
        'restante nathy': m.nathy.restante, 'restante vini': m.vini.restante },
    })));

    if (await page.getByText('Valores de exemplo').count()) falhar('a faixa "Valores de exemplo" continua aparecendo depois de importar');
    else ok('os valores de exemplo saíram');

    await page.reload({ waitUntil: 'networkidle' });
    const depois = await lerTotal(page, ANO);
    if (depois.every((l, k) => perto(l.gasto, lidos[k].gasto) && perto(l.recebido, lidos[k].recebido))) ok('depois de recarregar a página os valores continuam lá');
    else falhar('depois de recarregar a página os valores mudaram ou sumiram');

    await importar(page, { desligar: ['Gastos'] });
    const deNovo = await lerTotal(page, ANO);
    if (deNovo.every((l, k) => perto(l.gasto, lidos[k].gasto) && perto(l.recebido, lidos[k].recebido))) ok('importar a mesma planilha de novo não soma duas vezes');
    else falhar(`importar de novo mudou os totais: janeiro ${deNovo[0].recebido}/${deNovo[0].gasto} (antes ${lidos[0].recebido}/${lidos[0].gasto})`);
    await ctx.close();
  }

  console.log('\n▸ cenário 2: tudo ligado (padrão), inclusive a aba oculta "Gastos"');
  {
    const { ctx, page } = await abrir(browser, url, { rotulo: 'cenário 2', erros });
    await importar(page, { captura: 'importacao-assistente-tudo.png' });
    const historico = Object.fromEntries(ESPERADO.historico_2025.map((x) => [x.mes, x]));
    conferir('Total finanças 2025 (aba oculta)', await lerTotal(page, 2025), ESPERADO.meses.map((m) => {
      const x = historico[m.mes.toLowerCase()] || { recebido: 0, gasto: 0, restante: 0 };
      return { mes: m.mes, valores: { recebido: x.recebido, gasto: x.gasto, restante: x.restante } };
    }));
    conferir(`Total finanças ${ANO} (pessoas + bloco de ${ANO} da aba oculta)`, await lerTotal(page, ANO), ESPERADO.meses.map((m, k) => ({
      mes: m.mes,
      valores: { recebido: m.total.recebido, gasto: Math.round((m.total.gasto + ESPERADO.historico_2026[k].gasto) * 100) / 100 },
    })));
    await page.screenshot({ path: path.join(CAPTURAS, 'importacao-total-financas-2026-com-oculta.png'), fullPage: true });
    await ctx.close();
  }
});
