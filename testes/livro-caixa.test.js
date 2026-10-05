/*
 * Testes das partes sem tela: números e datas em pt-BR, leitura de CSV/OFX/XLSX,
 * a planilha mensal (formato "Gastos"), a exportação para Excel e as contas dos gráficos.
 *
 *   node --test testes/        (ou: npm test)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

for (const arquivo of ['util', 'dados', 'arquivos']) require(path.join(__dirname, '..', 'js', arquivo + '.js'));
const LC = globalThis.LC;
const Dd = LC.Dados;
const A = LC.Arquivos;
const HOJE = '2026-10-05';

// Uma pasta no formato da planilha "Gastos": abas por pessoa, um resumo e uma aba antiga com blocos por ano.
function pastaNoFormatoGastos() {
  const meses = Dd.MESES_NOMES;
  const nathy = [['Mes', 'Cartão', 'Academia', 'Ração Gatos', 'Comida', 'Total Gasto', 'Salário', 'Total restante']];
  meses.forEach((m, i) => nathy.push([m, i < 3 ? 1000 + i : '', 99.9, '', i === 1 ? 250.5 : '', { f: 'SUM(B2:E2)', v: 0 }, i < 3 ? 3000 : '', { f: 'G2-F2', v: 0 }]));
  const vini = [['Mês', 'Faculdade', 'Aluguel', 'academia', 'Salário', 'Total Gasto', 'Total Restante']];
  meses.forEach((m, i) => vini.push([m, i < 2 ? 420 : '', i < 2 ? 1100 : '', '', i < 2 ? 3600 : '', '', '']));
  const total = [['mes', 'Total Recebido', 'Total Gasto', 'Total Restante']];
  meses.forEach((m) => total.push([m.toLowerCase(), 0, 0, 0]));
  const antiga = [['Mes', 2025], ['', 'aluguel', 'agua', 'ração gato', 'total gasto', 'Valor recebido', 'valor restante ']];
  for (const m of ['março', 'abril']) antiga.push([m, 950, 52, 130, 1132, 2800, 1668]);
  antiga.push([2026]);
  antiga.push(['Janeiro', 950, '', '', '', '', '']);
  const aba = (nome, linhas) => ({ nome, colunas: linhas[0].map(() => ({ largura: 12 })), cabecalhos: [0], linhas });
  return A.escreverXLSX([aba('Gastos Nathy', nathy), aba('Gastos vini', vini), aba('Total finanças', total), aba('Gastos', antiga)]);
}

test('números e datas no jeito brasileiro', () => {
  assert.equal(LC.paraNumero('1.234,56'), 1234.56);
  assert.equal(LC.paraNumero('-R$ 50,00'), -50);
  assert.equal(LC.paraNumero('(50,00)'), -50);
  assert.equal(LC.paraNumero('123,45 D'), -123.45);
  assert.equal(LC.paraNumero('R$ 2.150'), 2150);
  assert.equal(LC.paraNumero('12.50'), 12.5);
  assert.ok(Number.isNaN(LC.paraNumero('abc')));
  assert.equal(LC.paraData('05/10/2026'), '2026-10-05');
  assert.equal(LC.paraData('20261003120000[-3:BRT]'), '2026-10-03');
  assert.equal(LC.paraData(46300), '2026-10-05');
  assert.equal(LC.paraData('31/02/2026'), null);
  assert.equal(LC.fmt.moeda(-0.001), 'R$ 0,00');
});

test('CSV com ponto e vírgula, aspas e vírgula decimal', () => {
  const linhas = A.lerCSV('﻿Data;Descrição;Valor\n05/10/2026;"Mercado; bairro";"-1.234,56"\r\n');
  assert.deepEqual(linhas, [['Data', 'Descrição', 'Valor'], ['05/10/2026', 'Mercado; bairro', '-1.234,56']]);
});

test('extrato OFX', () => {
  const ofx = A.lerOFX('<OFX><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261003<TRNAMT>-89.90<MEMO>Mercado &amp; Cia</STMTTRN></OFX>');
  assert.deepEqual(ofx.linhas, [['2026-10-03', 'Mercado & Cia', '-89.90']]);
});

test('XLSX: o que é escrito é lido de volta', async () => {
  const bytes = A.escreverXLSX([{ nome: 'Teste', colunas: [{ largura: 12, estilo: 'data' }, { largura: 10 }], cabecalhos: [0],
    linhas: [['Data', 'Valor'], [LC.isoParaSerial('2026-10-05'), 12.5], ['texto & <símbolos>', { f: 'B2*2', v: 25 }]] }]);
  const [aba] = await A.lerXLSX(bytes);
  assert.equal(aba.nome, 'Teste');
  assert.deepEqual(aba.linhas, [['Data', 'Valor'], ['2026-10-05', 12.5], ['texto & <símbolos>', 25]]);
});

test('planilha mensal: detecta abas por pessoa, resumo e blocos por ano', async () => {
  const abas = await A.lerXLSX(pastaNoFormatoGastos());
  const det = Object.fromEntries(abas.map((a) => [a.nome, Dd.detectarMensal(a.linhas)]));
  assert.equal(det['Gastos Nathy'].colunas.find((c) => c.nome === 'Total Gasto').papel, 'ignorar');
  assert.equal(det['Gastos Nathy'].colunas.find((c) => c.nome === 'Salário').papel, 'receita');
  assert.equal(det['Total finanças'].resumo, true);
  assert.deepEqual(det.Gastos.anos, [2025, 2026]);
  assert.equal(Dd.pessoaDaAba('Gastos vini'), 'Vini');
  assert.equal(Dd.pessoaDaAba('Gastos'), '');
  assert.equal(Dd.pessoaDaAba('Total finanças'), '');
});

test('planilha mensal: importação vira lançamentos com os totais da planilha', async () => {
  const abas = await A.lerXLSX(pastaNoFormatoGastos());
  const est = Dd.estadoVazio();
  const selecao = abas.map((a) => {
    const mensal = Dd.detectarMensal(a.linhas);
    const nome = Dd.pessoaDaAba(a.nome);
    const p = est.pessoas.find((x) => Dd.chaveNome(x.nome) === Dd.chaveNome(nome));
    return { nome: a.nome, mensal, incluir: !!mensal && !mensal.resumo, pessoa: p ? p.id : `__nova:${nome || 'Casa'}` };
  });
  const r = Dd.prepararImportacaoMensal(selecao, { anoPadrao: 2026 }, est, HOJE);
  const novo = Dd.sanear({ ...est, pessoas: r.pessoas, categorias: r.categorias, lancamentos: r.itens });
  const casa = novo.pessoas.find((p) => p.nome === 'Casa');
  assert.ok(casa, 'a aba sem dono vira a pessoa Casa');
  // "ração gato" encontra a categoria "Ração Gatos"; "agua" encontra "Água"
  assert.ok(!r.novasCategorias.some((c) => /racao|agua/.test(LC.dobrar(c.nome))));
  const marco25 = Dd.matrizMensal(novo, casa.id, 2025).meses[2];
  assert.equal(marco25.gasto, 1132);
  assert.equal(marco25.recebido, 2800);
  assert.equal(marco25.restante, 1668);
  const nathyFev = Dd.matrizMensal(novo, 'nathy', 2026).meses[1];
  assert.equal(nathyFev.gasto, LC.arred(1001 + 99.9 + 250.5));
  assert.equal(nathyFev.recebido, 3000);
  const total = Dd.resumoMes(novo, '2026-01');
  assert.equal(total.receitas, 6600);
  assert.equal(total.despesas, LC.arred(1000 + 99.9 + 420 + 1100 + 950));
});

test('planilha mensal: a aba antiga deixa de fora os anos das abas das pessoas', async () => {
  const abas = await A.lerXLSX(pastaNoFormatoGastos());
  const est = Dd.estadoVazio();
  const selecao = abas.map((a) => {
    const mensal = Dd.detectarMensal(a.linhas);
    const nome = Dd.pessoaDaAba(a.nome);
    const p = est.pessoas.find((x) => Dd.chaveNome(x.nome) === Dd.chaveNome(nome));
    return { nome: a.nome, mensal, incluir: !!mensal && !mensal.resumo, pessoa: p ? p.id : `__nova:${nome || 'Casa'}` };
  });
  const cobertos = Dd.anosJaCobertos(selecao, 2026);
  assert.deepEqual([...cobertos.keys()], [2026]);
  assert.deepEqual(cobertos.get(2026), ['Gastos Nathy', 'Gastos vini']);
  const antiga = selecao.find((a) => a.nome === 'Gastos');
  antiga.anosFora = new Set([2026]);
  const r = Dd.prepararImportacaoMensal(selecao, { anoPadrao: 2026 }, est, HOJE);
  const novo = Dd.sanear({ ...est, pessoas: r.pessoas, categorias: r.categorias, lancamentos: r.itens });
  const casa = novo.pessoas.find((p) => p.nome === 'Casa');
  assert.equal(Dd.matrizMensal(novo, casa.id, 2025).meses[2].gasto, 1132, '2025 continua');
  assert.equal(Dd.resumoMes(novo, '2026-01').despesas, LC.arred(1000 + 99.9 + 420 + 1100), 'o aluguel de 2026 da aba antiga não soma');
  assert.ok(!r.mesesSubstituidos.get(casa.id).has('2026-01'), 'não apaga o que já existe em 2026');
  // Com todos os anos de fora, a aba não entra e não cria a pessoa.
  antiga.anosFora = new Set([2025, 2026]);
  const r2 = Dd.prepararImportacaoMensal(selecao, { anoPadrao: 2026 }, est, HOJE);
  assert.ok(!r2.pessoas.some((p) => p.nome === 'Casa'));
});

test('gráficos por grupo e por fixo ou variável', () => {
  const est = Dd.estadoVazio();
  const lanca = (categoria, valor) => est.lancamentos.push(Dd.normalizarLancamento({ data: '2026-09-10', descricao: categoria, categoria, tipo: 'despesa', valor, pessoa: 'vini', situacao: 'pago' }));
  lanca('aluguel', 1100); lanca('agua', 60); lanca('comida', 300); lanca('racao-gatos', 90);
  const f = Dd.periodo({ periodo: 'personalizado', de: '2026-09-01', ate: '2026-09-30', pessoa: 'todas', situacao: 'todas' }, HOJE, est);
  const porGrupo = Dd.dadosGrafico({ medida: 'despesas', agrupar: 'grupo', tipo: 'rosca' }, est, f, HOJE);
  const valor = (d, rotulo) => d.series[0].valores[d.rotulos.indexOf(rotulo)];
  assert.equal(valor(porGrupo, 'Moradia'), 1160);
  assert.equal(valor(porGrupo, 'Pets'), 90);
  const fixos = Dd.dadosGrafico({ medida: 'despesas', agrupar: 'mes', dividir: 'fixo', tipo: 'colunas' }, est, f, HOJE);
  const serie = (nome) => fixos.series.find((s) => s.nome === nome).valores.reduce((a, b) => a + b, 0);
  assert.equal(serie('Fixos'), 1160);
  assert.equal(serie('Variáveis'), 390);
  // Livro-caixa antigo (sem grupos): categorias ganham grupo sugerido e os gráficos novos entram uma vez.
  const antigo = Dd.sanear({ categorias: [{ id: 'luz', nome: 'luz', tipo: 'despesa' }], graficos: [{ id: 'g-categorias', titulo: 'x' }] });
  assert.deepEqual([antigo.categorias[0].grupo, antigo.categorias[0].fixo], ['Moradia', true]);
  assert.deepEqual(antigo.graficos.map((g) => g.id), ['g-categorias', 'g-grupos', 'g-fixos']);
  const semOGrafico = Dd.sanear({ ...antigo, graficos: antigo.graficos.filter((g) => g.id !== 'g-fixos') });
  assert.ok(!semOGrafico.graficos.some((g) => g.id === 'g-fixos'), 'gráfico excluído não volta');
});

test('saldo de hoje: digitar o valor do banco acerta o saldo inicial', () => {
  const est = Dd.estadoVazio();
  const nathy = est.pessoas.find((p) => p.id === 'nathy');
  nathy.saldoInicial = 100;
  const lanca = (x) => est.lancamentos.push(Dd.normalizarLancamento({ pessoa: 'nathy', categoria: x.tipo === 'receita' ? 'salario' : 'comida', ...x }));
  lanca({ data: '2026-09-05', descricao: 'Salário', tipo: 'receita', valor: 1000, situacao: 'pago' });
  lanca({ data: '2026-09-20', descricao: 'Mercado', tipo: 'despesa', valor: 300, situacao: 'pago' });
  lanca({ data: '2026-11-01', descricao: 'Conta futura', tipo: 'despesa', valor: 50, situacao: 'pendente' });
  assert.equal(Dd.saldosPessoas(est, HOJE).get('nathy'), 800);
  Dd.ajustarSaldo(est, 'nathy', 1234.56, HOJE);
  assert.equal(Dd.saldosPessoas(est, HOJE).get('nathy'), 1234.56);
  assert.equal(nathy.saldoInicial, 534.56);
  Dd.ajustarSaldo(est, 'nathy', -20, HOJE);
  assert.equal(Dd.saldosPessoas(est, HOJE).get('nathy'), -20);
});

test('planilha mensal: digitar na célula respeita os lançamentos feitos um a um', () => {
  const est = Dd.estadoVazio();
  est.lancamentos.push(Dd.normalizarLancamento({ data: '2026-09-10', descricao: 'Mercado', categoria: 'comida', tipo: 'despesa', valor: 120, pessoa: 'nathy' }));
  Dd.definirValorMensal(est, 'nathy', 'comida', '2026-09', 300, HOJE);
  assert.equal(Dd.matrizMensal(est, 'nathy', 2026).meses[8].valor('comida'), 300);
  assert.equal(est.lancamentos.filter((t) => t.mensal).length, 1);
  assert.throws(() => Dd.definirValorMensal(est, 'nathy', 'comida', '2026-09', 50, HOJE), /lançados um a um/);
  Dd.definirValorMensal(est, 'nathy', 'comida', '2026-09', 120, HOJE);
  assert.equal(est.lancamentos.filter((t) => t.mensal).length, 0);
  Dd.definirValorMensal(est, 'vini', 'aluguel', '2026-11', 1100, HOJE);
  assert.equal(est.lancamentos.find((t) => t.categoria === 'aluguel').situacao, 'pendente');
});

test('Excel no formato Gastos: ida e volta mantém os totais de cada mês', async () => {
  const est = Dd.gerarExemplo(HOJE);
  const bytes = A.excelNoFormatoGastos(est, 2026, HOJE);
  const abas = await A.lerXLSX(bytes);
  assert.deepEqual(abas.map((a) => a.nome), ['Gastos Nathy', 'Gastos Vini', 'Total finanças', 'Lançamentos']);
  const base = { ...Dd.estadoVazio(), pessoas: [], categorias: Dd.clonar(est.categorias) };
  const selecao = abas.map((a) => {
    const mensal = Dd.detectarMensal(a.linhas);
    return { nome: a.nome, mensal, incluir: !!mensal && !mensal.resumo, pessoa: `__nova:${Dd.pessoaDaAba(a.nome) || 'Casa'}` };
  });
  assert.equal(selecao.find((s) => s.nome === 'Total finanças').mensal.resumo, true);
  const r = Dd.prepararImportacaoMensal(selecao, { anoPadrao: 2026 }, { ...base, pessoas: [{ id: 'x', nome: 'x', cor: 'p1', saldoInicial: 0, colunas: [] }] }, HOJE);
  const volta = Dd.sanear({ ...base, pessoas: r.pessoas, categorias: r.categorias, lancamentos: r.itens });
  for (let m = 1; m <= 12; m++) {
    const chave = `2026-${String(m).padStart(2, '0')}`;
    const a = Dd.resumoMes(est, chave), b = Dd.resumoMes(volta, chave);
    assert.equal(b.receitas, a.receitas, `recebido de ${chave}`);
    assert.equal(b.despesas, a.despesas, `gasto de ${chave}`);
  }
});

test('gráficos: fluxo soma recebido, gasto e restante por mês; filtro por pessoa', () => {
  const est = Dd.estadoVazio();
  const add = (data, categoria, tipo, valor, pessoa) => est.lancamentos.push(Dd.normalizarLancamento({ data, categoria, tipo, valor, pessoa, descricao: categoria }));
  add('2026-09-01', 'salario', 'receita', 3000, 'nathy');
  add('2026-09-01', 'cartao', 'despesa', 1000, 'nathy');
  add('2026-09-01', 'aluguel', 'despesa', 1100, 'vini');
  add('2026-10-01', 'salario', 'receita', 3600, 'vini');
  const f = Dd.periodo({ periodo: '3m' }, HOJE, est);
  const fluxo = Dd.dadosGrafico({ tipo: 'colunas', medida: 'fluxo', agrupar: 'mes' }, est, f, HOJE);
  assert.deepEqual(fluxo.rotulos, ['ago/26', 'set/26', 'out/26']);
  assert.deepEqual(fluxo.series.map((s) => s.valores), [[0, 3000, 3600], [0, 2100, 0], [0, 900, 3600]]);
  const soNathy = Dd.dadosGrafico({ tipo: 'barras', medida: 'despesas', agrupar: 'categoria', pessoas: ['nathy'] }, est, f, HOJE);
  assert.deepEqual(soNathy.rotulos, ['Cartão']);
  const porPessoa = Dd.dadosGrafico({ tipo: 'colunas', medida: 'despesas', agrupar: 'mes', dividir: 'pessoa' }, est, f, HOJE);
  assert.deepEqual(porPessoa.series.map((s) => s.nome).sort(), ['Nathy', 'Vini']);
});

test('exemplo é sempre o mesmo e sobrevive a sanear/salvar', () => {
  const a = Dd.gerarExemplo(HOJE), b = Dd.gerarExemplo(HOJE);
  assert.equal(LC.jsonEstavel(a), LC.jsonEstavel(b));
  assert.equal(LC.jsonEstavel(Dd.sanear(JSON.parse(JSON.stringify(a)))), LC.jsonEstavel(a));
  Dd.limparExemplos(a);
  assert.equal(a.lancamentos.length, 0);
  assert.ok(a.categorias.every((c) => c.orcamento === 0));
});
