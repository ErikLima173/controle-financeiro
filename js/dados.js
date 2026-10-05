/*
 * dados.js — O livro-caixa em memória, no formato da planilha "Gastos": pessoas, categorias e meses.
 *
 *   planilha de cada pessoa (Mês × categorias) ◄─► lançamentos ─► painel, orçamento, Total finanças
 *   filtro do painel (período, pessoa, situação) ─► filtrar ─► totais / dadosGrafico(cfg)
 *
 * Lançamento: { id, data "AAAA-MM-DD", descricao, categoria, tipo, valor (sempre positivo),
 *               pessoa, destino (só transferência), situacao "pago" | "pendente", obs,
 *               mensal (total do mês digitado na planilha mensal), exemplo }
 * Pessoa:     { id, nome, cor, saldoInicial, colunas: [ids das categorias, na ordem da planilha] }
 */
(function (LC) {
  'use strict';

  const D = LC.data;
  const { arred, dobrar, novoId } = LC;

  const ROTULO_TIPO = { despesa: 'Gasto', receita: 'Recebimento', transferencia: 'Transferência' };
  const ROTULO_SITUACAO = {
    despesa: { pago: 'Pago', pendente: 'A pagar' },
    receita: { pago: 'Recebido', pendente: 'A receber' },
    transferencia: { pago: 'Feita', pendente: 'Agendada' },
  };
  const MESES_NOMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  // As colunas das abas "Gastos Nathy" e "Gastos vini". Cores: as maiores categorias da casa nunca repetem
  // (Aluguel, Cartão, Comida, Gastos extras, Compras, Gasolina, Faculdade, Seguro Carro); as menores reaproveitam.
  const CATEGORIAS_PADRAO = [
    { id: 'cartao', nome: 'Cartão', tipo: 'despesa', cor: 'p2' },
    { id: 'academia', nome: 'Academia', tipo: 'despesa', cor: 'p6' },
    { id: 'oculos', nome: 'Óculos', tipo: 'despesa', cor: 'p7' },
    { id: 'maquina', nome: 'Máquina', tipo: 'despesa', cor: 'p1' },
    { id: 'pc', nome: 'PC', tipo: 'despesa', cor: 'p8' },
    { id: 'areia-gatos', nome: 'Areia Gatos', tipo: 'despesa', cor: 'p4' },
    { id: 'racao-athena', nome: 'Ração Athena', tipo: 'despesa', cor: 'p7' },
    { id: 'racao-gatos', nome: 'Ração Gatos', tipo: 'despesa', cor: 'p4' },
    { id: 'comida', nome: 'Comida', tipo: 'despesa', cor: 'p3' },
    { id: 'compras', nome: 'Compras', tipo: 'despesa', cor: 'p5' },
    { id: 'jogos', nome: 'Jogos', tipo: 'despesa', cor: 'p8' },
    { id: 'gasolina', nome: 'Gasolina', tipo: 'despesa', cor: 'p6' },
    { id: 'outros', nome: 'Outros', tipo: 'despesa', cor: 'neutro' },
    { id: 'faculdade', nome: 'Faculdade', tipo: 'despesa', cor: 'p7' },
    { id: 'internet', nome: 'Internet', tipo: 'despesa', cor: 'p3' },
    { id: 'seguro-carro', nome: 'Seguro Carro', tipo: 'despesa', cor: 'p8' },
    { id: 'aluguel', nome: 'Aluguel', tipo: 'despesa', cor: 'p1' },
    { id: 'agua', nome: 'Água', tipo: 'despesa', cor: 'p5' },
    { id: 'gastos-extras', nome: 'Gastos extras', tipo: 'despesa', cor: 'p4' },
    { id: 'salario', nome: 'Salário', tipo: 'receita', cor: 'p1' },
    { id: 'outros-recebimentos', nome: 'Outros recebimentos', tipo: 'receita', cor: 'neutro' },
  ].map((c) => ({ orcamento: 0, ...c }));

  const PESSOAS_PADRAO = [
    { id: 'nathy', nome: 'Nathy', cor: 'p1', saldoInicial: 0,
      colunas: ['cartao', 'academia', 'oculos', 'maquina', 'pc', 'areia-gatos', 'racao-athena', 'racao-gatos', 'comida', 'compras', 'jogos', 'gasolina', 'outros', 'salario'] },
    { id: 'vini', nome: 'Vini', cor: 'p2', saldoInicial: 0,
      colunas: ['faculdade', 'internet', 'seguro-carro', 'academia', 'aluguel', 'agua', 'gastos-extras', 'salario'] },
  ];

  const GRAFICOS_PADRAO = [
    { id: 'g-fluxo', titulo: 'Recebido x gasto', tipo: 'colunas', medida: 'fluxo', agrupar: 'mes', largura: 2 },
    { id: 'g-categorias', titulo: 'Gastos por categoria', tipo: 'rosca', medida: 'despesas', agrupar: 'categoria', maxItens: 7 },
    { id: 'g-pessoas', titulo: 'Gastos por pessoa', tipo: 'colunas', medida: 'despesas', agrupar: 'mes', dividir: 'pessoa', empilhar: true },
    { id: 'g-nathy', titulo: 'Gastos Nathy', tipo: 'barras', medida: 'despesas', agrupar: 'categoria', pessoas: ['nathy'], corPorItem: true, maxItens: 8, altura: 'g' },
    { id: 'g-vini', titulo: 'Gastos Vini', tipo: 'barras', medida: 'despesas', agrupar: 'categoria', pessoas: ['vini'], corPorItem: true, maxItens: 8, altura: 'g' },
    { id: 'g-guardado', titulo: '% guardado por mês', tipo: 'linha', medida: 'poupanca', agrupar: 'mes', meta: 0.2, largura: 2, altura: 'p' },
  ];

  // Opções do editor de gráficos. "tempo" = eixo contínuo (meses sem lançamento aparecem zerados).
  const AGRUPAMENTOS = {
    mes: { nome: 'Mês', tempo: true },
    semana: { nome: 'Semana', tempo: true },
    dia: { nome: 'Dia', tempo: true },
    diaSemana: { nome: 'Dia da semana' },
    categoria: { nome: 'Categoria' },
    pessoa: { nome: 'Pessoa' },
    tipo: { nome: 'Tipo (recebimento ou gasto)' },
    situacao: { nome: 'Situação (pago ou pendente)' },
  };

  const MEDIDAS = {
    despesas: { nome: 'Gastos', unidade: 'moeda' },
    receitas: { nome: 'Recebido', unidade: 'moeda' },
    resultado: { nome: 'Restante (recebido − gasto)', unidade: 'moeda' },
    receitasDespesas: { nome: 'Recebido e gasto', unidade: 'moeda', multi: true },
    fluxo: { nome: 'Recebido, gasto e restante', unidade: 'moeda', multi: true },
    acumulado: { nome: 'Saldo acumulado', unidade: 'moeda', soTempo: true },
    poupanca: { nome: '% guardado', unidade: 'pct' },
    orcamento: { nome: 'Orçado x gasto', unidade: 'moeda', multi: true },
    quantidade: { nome: 'Quantidade de lançamentos', unidade: 'n' },
  };

  const DIVISOES = { nenhum: 'Nenhuma', categoria: 'Categoria', pessoa: 'Pessoa', tipo: 'Tipo', situacao: 'Situação' };

  const PERIODOS = {
    mes: 'Este mês',
    'mes-anterior': 'Mês passado',
    '3m': 'Últimos 3 meses',
    '6m': 'Últimos 6 meses',
    '12m': 'Últimos 12 meses',
    ano: 'Este ano',
    'ano-anterior': 'Ano passado',
    tudo: 'Todo o período',
    personalizado: 'Personalizado',
  };

  // ── Estado ───────────────────────────────────────────────────────────────

  function clonar(v) { return JSON.parse(JSON.stringify(v)); }

  function estadoVazio() {
    return {
      versao: 2,
      pessoas: clonar(PESSOAS_PADRAO),
      categorias: clonar(CATEGORIAS_PADRAO),
      graficos: GRAFICOS_PADRAO.map(normalizarGrafico),
      lancamentos: [],
    };
  }

  // Campos em ordem fixa: a mesma forma no navegador, na nuvem e na exportação.
  function normalizarLancamento(t) {
    const tipo = ROTULO_TIPO[t.tipo] ? t.tipo : 'despesa';
    const n = {
      id: String(t.id || novoId('l')),
      data: D.valida(t.data) ? t.data : D.hoje(),
      descricao: String(t.descricao ?? '').slice(0, 300),
      categoria: tipo === 'transferencia' ? '' : String(t.categoria || ''),
      tipo,
      valor: Math.abs(arred(t.valor)),
      pessoa: String(t.pessoa || t.conta || ''),
      situacao: t.situacao === 'pendente' ? 'pendente' : 'pago',
    };
    if (tipo === 'transferencia') n.destino = String(t.destino || '');
    if (t.obs) n.obs = String(t.obs).slice(0, 500);
    if (t.mensal && tipo !== 'transferencia') n.mensal = true;
    if (t.exemplo) n.exemplo = true;
    return n;
  }

  // Aceita qualquer coisa que pareça um estado (backup, nuvem, localStorage) e devolve um válido.
  function sanear(bruto) {
    const base = estadoVazio();
    if (!bruto || typeof bruto !== 'object') return base;
    const pessoasBrutas = bruto.pessoas || bruto.contas;
    const est = {
      versao: 2,
      pessoas: Array.isArray(pessoasBrutas) && pessoasBrutas.length ? pessoasBrutas : base.pessoas,
      categorias: Array.isArray(bruto.categorias) && bruto.categorias.length ? bruto.categorias : base.categorias,
      graficos: Array.isArray(bruto.graficos) ? bruto.graficos : base.graficos,
      lancamentos: Array.isArray(bruto.lancamentos) ? bruto.lancamentos : [],
    };
    est.categorias = est.categorias.filter((c) => c && c.nome).map((c) => ({
      id: String(c.id || novoId('c')),
      nome: String(c.nome).slice(0, 60),
      tipo: c.tipo === 'receita' ? 'receita' : 'despesa',
      cor: typeof c.cor === 'string' ? c.cor : 'neutro',
      orcamento: Math.max(0, arred(c.orcamento)),
    }));
    const idsCat = new Set(est.categorias.map((c) => c.id));
    est.pessoas = est.pessoas.filter((p) => p && p.nome).map((p) => ({
      id: String(p.id || novoId('p')),
      nome: String(p.nome).slice(0, 40),
      cor: typeof p.cor === 'string' ? p.cor : 'neutro',
      saldoInicial: arred(p.saldoInicial),
      colunas: [...new Set((Array.isArray(p.colunas) ? p.colunas : []).map(String))].filter((id) => idsCat.has(id)),
    }));
    if (!est.pessoas.length) est.pessoas = base.pessoas;
    est.graficos = est.graficos.filter((g) => g && typeof g === 'object').map(normalizarGrafico);
    est.lancamentos = est.lancamentos.filter((t) => t && D.valida(t.data) && Number.isFinite(+t.valor))
      .map(normalizarLancamento);
    const pessoas = new Set(est.pessoas.map((p) => p.id));
    for (const t of est.lancamentos) {
      if (!pessoas.has(t.pessoa)) t.pessoa = est.pessoas[0].id;
      if (t.tipo === 'transferencia') {
        if (!pessoas.has(t.destino) || t.destino === t.pessoa) {
          t.destino = (est.pessoas.find((p) => p.id !== t.pessoa) || est.pessoas[0]).id;
        }
      } else {
        const cat = est.categorias.find((c) => c.id === t.categoria);
        if (!cat || cat.tipo !== t.tipo) t.categoria = categoriaPadrao(est, t.tipo);
      }
    }
    return est;
  }

  function normalizarGrafico(g) {
    const tipos = ['colunas', 'barras', 'linha', 'area', 'rosca', 'pizza'];
    const agrupar = g.agrupar === 'conta' ? 'pessoa' : g.agrupar;
    const dividir = g.dividir === 'conta' ? 'pessoa' : g.dividir;
    return {
      id: String(g.id || novoId('g')),
      titulo: String(g.titulo ?? 'Gráfico').slice(0, 80),
      tipo: tipos.includes(g.tipo) ? g.tipo : 'colunas',
      medida: MEDIDAS[g.medida] ? g.medida : 'despesas',
      agrupar: AGRUPAMENTOS[agrupar] ? agrupar : 'mes',
      dividir: DIVISOES[dividir] ? dividir : 'nenhum',
      categorias: Array.isArray(g.categorias) ? g.categorias.map(String) : [],
      pessoas: Array.isArray(g.pessoas) ? g.pessoas.map(String) : [],
      maxItens: Number.isInteger(g.maxItens) && g.maxItens > 0 ? g.maxItens : 0,
      ordem: ['valor-desc', 'valor-asc', 'alfa'].includes(g.ordem) ? g.ordem : 'valor-desc',
      empilhar: !!g.empilhar,
      corPorItem: !!g.corPorItem,
      suave: !!g.suave,
      rotulos: ['nenhum', 'destaques', 'todos'].includes(g.rotulos) ? g.rotulos : 'destaques',
      legenda: g.legenda !== false,
      grade: g.grade !== false,
      zero: g.zero !== false,
      meta: Number.isFinite(g.meta) ? g.meta : null,
      cores: g.cores && typeof g.cores === 'object' ? { ...g.cores } : {},
      largura: g.largura === 2 ? 2 : 1,
      altura: ['p', 'm', 'g'].includes(g.altura) ? g.altura : 'm',
    };
  }

  function categoriaPadrao(est, tipo) {
    const id = tipo === 'receita' ? 'outros-recebimentos' : 'outros';
    let c = est.categorias.find((x) => x.id === id) || est.categorias.find((x) => x.tipo === tipo);
    if (!c) {
      c = { id, nome: tipo === 'receita' ? 'Outros recebimentos' : 'Outros', tipo, cor: 'neutro', orcamento: 0 };
      est.categorias.push(c);
    }
    return c.id;
  }

  // Próxima cor da paleta para um cadastro novo: a primeira que ainda não está em uso.
  function proximaCor(lista) {
    const usadas = new Set(lista.map((x) => x.cor));
    for (let i = 1; i <= 8; i++) if (!usadas.has('p' + i)) return 'p' + i;
    return 'p' + ((lista.length % 8) + 1);
  }

  const mapaPorId = (lista) => new Map(lista.map((x) => [x.id, x]));

  // Nomes iguais sem acento, caixa ou plural simples: "ração gato" encontra "Ração Gatos".
  const chaveNome = (s) => dobrar(s).replace(/s\b/g, '');

  // ── Períodos e filtros ───────────────────────────────────────────────────

  function limitesDados(est) {
    let min = null, max = null;
    for (const t of est.lancamentos) {
      if (!min || t.data < min) min = t.data;
      if (!max || t.data > max) max = t.data;
    }
    return { min, max };
  }

  // Período escolhido no painel → datas. Fim sempre no último dia do mês (inclui o que está agendado).
  function periodo(prefs, hoje, est) {
    const mes = D.mes(hoje);
    const p = prefs.periodo;
    let inicio, fim;
    if (p === 'mes') { inicio = D.inicioDoMes(mes); fim = D.fimDoMes(mes); }
    else if (p === 'mes-anterior') { const m = D.somaMeses(mes, -1); inicio = D.inicioDoMes(m); fim = D.fimDoMes(m); }
    else if (p === '3m' || p === '6m' || p === '12m') {
      const n = parseInt(p, 10);
      inicio = D.inicioDoMes(D.somaMeses(mes, -(n - 1))); fim = D.fimDoMes(mes);
    }
    else if (p === 'ano') { inicio = `${hoje.slice(0, 4)}-01-01`; fim = `${hoje.slice(0, 4)}-12-31`; }
    else if (p === 'ano-anterior') { const a = +hoje.slice(0, 4) - 1; inicio = `${a}-01-01`; fim = `${a}-12-31`; }
    else if (p === 'personalizado' && D.valida(prefs.de) && D.valida(prefs.ate)) {
      inicio = prefs.de <= prefs.ate ? prefs.de : prefs.ate;
      fim = prefs.de <= prefs.ate ? prefs.ate : prefs.de;
    } else {
      const lim = limitesDados(est);
      inicio = lim.min ? D.inicioDoMes(D.mes(lim.min)) : D.inicioDoMes(mes);
      fim = lim.max ? D.fimDoMes(D.mes(lim.max > hoje ? lim.max : hoje)) : D.fimDoMes(mes);
    }
    const meses = D.meses(D.mes(inicio), D.mes(fim)).length;
    return { inicio, fim, meses, pessoa: prefs.pessoa || 'todas', situacao: prefs.situacao || 'todas' };
  }

  // Mesmo tamanho, imediatamente antes (para as variações dos indicadores).
  function periodoAnterior(f, prefs) {
    if (prefs.periodo === 'tudo') return null;
    const inicioMes = f.inicio.endsWith('-01');
    const fimMes = f.fim === D.fimDoMes(D.mes(f.fim));
    if (inicioMes && fimMes) {
      return { ...f, inicio: D.inicioDoMes(D.somaMeses(D.mes(f.inicio), -f.meses)), fim: D.fimDoMes(D.somaMeses(D.mes(f.fim), -f.meses)) };
    }
    const dias = D.diferencaDias(f.inicio, f.fim) + 1;
    return { ...f, inicio: D.somaDias(f.inicio, -dias), fim: D.somaDias(f.fim, -dias) };
  }

  function envolvePessoa(t, pessoa) {
    return pessoa === 'todas' || t.pessoa === pessoa || (t.tipo === 'transferencia' && t.destino === pessoa);
  }

  function filtrar(est, f) {
    return est.lancamentos.filter((t) => t.data >= f.inicio && t.data <= f.fim
      && envolvePessoa(t, f.pessoa) && (f.situacao === 'todas' || t.situacao === f.situacao));
  }

  function totais(lista) {
    let receitas = 0, despesas = 0;
    for (const t of lista) {
      if (t.tipo === 'receita') receitas += t.valor;
      else if (t.tipo === 'despesa') despesas += t.valor;
    }
    receitas = arred(receitas); despesas = arred(despesas);
    const resultado = arred(receitas - despesas);
    return { receitas, despesas, resultado, poupanca: receitas > 0 ? resultado / receitas : null };
  }

  // Efeito de um lançamento no saldo de um grupo de pessoas (transferência dentro do grupo = 0).
  function efeito(t, pessoas) {
    if (t.tipo === 'receita') return pessoas.has(t.pessoa) ? t.valor : 0;
    if (t.tipo === 'despesa') return pessoas.has(t.pessoa) ? -t.valor : 0;
    return (pessoas.has(t.destino) ? t.valor : 0) - (pessoas.has(t.pessoa) ? t.valor : 0);
  }

  function saldosPessoas(est, ate, { soPagos = true } = {}) {
    const saldos = new Map(est.pessoas.map((p) => [p.id, p.saldoInicial]));
    for (const t of est.lancamentos) {
      if (t.data > ate || (soPagos && t.situacao !== 'pago')) continue;
      if (t.tipo === 'receita') saldos.set(t.pessoa, (saldos.get(t.pessoa) || 0) + t.valor);
      else if (t.tipo === 'despesa') saldos.set(t.pessoa, (saldos.get(t.pessoa) || 0) - t.valor);
      else {
        saldos.set(t.pessoa, (saldos.get(t.pessoa) || 0) - t.valor);
        saldos.set(t.destino, (saldos.get(t.destino) || 0) + t.valor);
      }
    }
    for (const [k, v] of saldos) saldos.set(k, arred(v));
    return saldos;
  }

  // "Ajustar o saldo": a pessoa diz quanto tem hoje e o saldo inicial absorve a diferença;
  // daí em diante o saldo segue somando os recebimentos e tirando os gastos pagos.
  function ajustarSaldo(est, pessoaId, saldoHoje, hoje) {
    const p = est.pessoas.find((x) => x.id === pessoaId);
    if (!p) return;
    const atual = saldosPessoas(est, hoje).get(pessoaId) || 0;
    p.saldoInicial = arred(p.saldoInicial + (saldoHoje - atual));
  }

  function pendencias(est, hoje, pessoa = 'todas') {
    return est.lancamentos
      .filter((t) => t.situacao === 'pendente' && t.tipo !== 'transferencia' && envolvePessoa(t, pessoa))
      .map((t) => ({ ...t, vencido: t.data < hoje, dias: D.diferencaDias(hoje, t.data) }))
      .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  }

  // Série mensal (para as minilinhas dos indicadores).
  function serieMensal(est, f, ateMes, n) {
    const meses = D.meses(D.somaMeses(ateMes, -(n - 1)), ateMes);
    const idx = new Map(meses.map((m, i) => [m, i]));
    const r = meses.map(() => ({ receitas: 0, despesas: 0 }));
    for (const t of est.lancamentos) {
      const i = idx.get(D.mes(t.data));
      if (i === undefined || !envolvePessoa(t, f.pessoa) || (f.situacao !== 'todas' && t.situacao !== f.situacao)) continue;
      if (t.tipo === 'receita') r[i].receitas += t.valor;
      else if (t.tipo === 'despesa') r[i].despesas += t.valor;
    }
    return r.map((x) => ({
      receitas: x.receitas, despesas: x.despesas, resultado: x.receitas - x.despesas,
      poupanca: x.receitas > 0 ? (x.receitas - x.despesas) / x.receitas : null,
    }));
  }

  // Recebido, gasto e restante de um mês, no total e por pessoa (a aba "Total finanças").
  function resumoMes(est, chaveMes, pessoa = 'todas') {
    const porPessoa = new Map(est.pessoas.map((p) => [p.id, { receitas: 0, despesas: 0 }]));
    for (const t of est.lancamentos) {
      if (D.mes(t.data) !== chaveMes || t.tipo === 'transferencia') continue;
      const r = porPessoa.get(t.pessoa);
      if (!r) continue;
      if (t.tipo === 'receita') r.receitas += t.valor; else r.despesas += t.valor;
    }
    const linhas = est.pessoas.filter((p) => pessoa === 'todas' || p.id === pessoa).map((p) => {
      const r = porPessoa.get(p.id);
      return { pessoa: p, receitas: arred(r.receitas), despesas: arred(r.despesas), restante: arred(r.receitas - r.despesas) };
    });
    const total = linhas.reduce((s, l) => ({ receitas: s.receitas + l.receitas, despesas: s.despesas + l.despesas }), { receitas: 0, despesas: 0 });
    return { pessoas: linhas, receitas: arred(total.receitas), despesas: arred(total.despesas), restante: arred(total.receitas - total.despesas) };
  }

  function anosComDados(est, hoje) {
    const anos = new Set(est.lancamentos.map((t) => +t.data.slice(0, 4)));
    anos.add(+hoje.slice(0, 4));
    return [...anos].sort((a, b) => b - a);
  }

  // ── Planilha mensal (a aba de cada pessoa) ───────────────────────────────

  /*
   * Mês × categoria de uma pessoa num ano. Cada célula soma os lançamentos daquele mês;
   * "mensal" é o valor digitado direto na planilha, "detalhados" os lançados um a um.
   */
  function matrizMensal(est, pessoaId, ano) {
    const pessoa = est.pessoas.find((p) => p.id === pessoaId);
    const cats = mapaPorId(est.categorias);
    const colunas = (pessoa ? pessoa.colunas : []).filter((id) => cats.has(id));
    const celulas = new Map();
    const extras = [];
    for (const t of est.lancamentos) {
      if (t.pessoa !== pessoaId || t.tipo === 'transferencia' || !t.data.startsWith(ano + '-')) continue;
      const chave = t.data.slice(0, 7) + '|' + t.categoria;
      const c = celulas.get(chave) || { total: 0, mensal: null, detalhados: 0, valorDetalhado: 0, pendente: false };
      c.total += t.valor;
      if (t.mensal && !c.mensal) c.mensal = t;
      else { c.detalhados++; c.valorDetalhado += t.valor; }
      if (t.situacao === 'pendente') c.pendente = true;
      celulas.set(chave, c);
      if (!colunas.includes(t.categoria) && !extras.includes(t.categoria) && cats.has(t.categoria)) extras.push(t.categoria);
    }
    const todas = [...colunas, ...extras];
    const despesas = todas.filter((id) => cats.get(id).tipo === 'despesa');
    const receitas = todas.filter((id) => cats.get(id).tipo === 'receita');
    const meses = MESES_NOMES.map((nome, i) => {
      const chaveMes = `${ano}-${String(i + 1).padStart(2, '0')}`;
      const valor = (id) => arred(celulas.get(chaveMes + '|' + id)?.total || 0);
      const gasto = arred(despesas.reduce((s, id) => s + valor(id), 0));
      const recebido = arred(receitas.reduce((s, id) => s + valor(id), 0));
      return { nome, chave: chaveMes, celula: (id) => celulas.get(chaveMes + '|' + id) || null, valor, gasto, recebido, restante: arred(recebido - gasto) };
    });
    return { pessoa, despesas, receitas, extras, meses };
  }

  // Digitar um valor numa célula da planilha mensal: ajusta o lançamento "mensal" daquele mês.
  function definirValorMensal(est, pessoaId, catId, chaveMes, valor, hoje) {
    const cat = est.categorias.find((c) => c.id === catId);
    if (!cat) throw new Error('Categoria não encontrada.');
    const doMes = est.lancamentos.filter((t) => t.pessoa === pessoaId && t.categoria === catId && D.mes(t.data) === chaveMes && t.tipo !== 'transferencia');
    const mensal = doMes.find((t) => t.mensal);
    const detalhado = arred(doMes.filter((t) => t !== mensal).reduce((s, t) => s + t.valor, 0));
    const resto = arred(valor - detalhado);
    if (resto < 0) {
      throw new Error(`Este mês já tem ${fmtMoeda(detalhado)} lançados um a um em ${cat.nome}. Digite um total maior ou ajuste os lançamentos na planilha de lançamentos.`);
    }
    if (resto === 0) {
      if (mensal) est.lancamentos = est.lancamentos.filter((t) => t !== mensal);
      return;
    }
    if (mensal) {
      mensal.valor = resto;
      delete mensal.exemplo;
      return;
    }
    const data = `${chaveMes}-01`;
    est.lancamentos.push(normalizarLancamento({
      id: novoId('l'), data, descricao: cat.nome, categoria: catId, tipo: cat.tipo, valor: resto,
      pessoa: pessoaId, situacao: data <= hoje ? 'pago' : 'pendente', mensal: true,
    }));
  }

  const fmtMoeda = (v) => (LC.fmt ? LC.fmt.moeda(v) : String(v));

  // ── Dados dos gráficos ───────────────────────────────────────────────────

  const COR_MEDIDA = { receitas: 'p1', despesas: 'p2', resultado: 'p3', acumulado: 'p1', poupanca: 'p3', quantidade: 'p1' };
  const OUTROS = '__outros';

  function sequenciaTempo(agrupar, inicio, fim) {
    if (agrupar === 'mes') return D.meses(D.mes(inicio), D.mes(fim));
    const passo = agrupar === 'semana' ? 7 : 1;
    const lista = [];
    for (let d = agrupar === 'semana' ? D.inicioSemana(inicio) : inicio; d <= fim && lista.length < 2000; d = D.somaDias(d, passo)) lista.push(d);
    return lista;
  }

  function chaveGrupo(agrupar, t) {
    switch (agrupar) {
      case 'mes': return D.mes(t.data);
      case 'semana': return D.inicioSemana(t.data);
      case 'dia': return t.data;
      case 'diaSemana': return String(D.diaSemana(t.data));
      case 'categoria': return t.categoria;
      case 'pessoa': return t.pessoa;
      case 'tipo': return t.tipo;
      case 'situacao': return t.situacao;
      default: return '';
    }
  }

  function descreverItem(dim, chave, est) {
    if (chave === OUTROS) return { rotulo: 'Outros', cor: 'neutro' };
    switch (dim) {
      case 'mes': return { rotulo: LC.fmt.mes(chave) };
      case 'semana': case 'dia': return { rotulo: LC.fmt.dataCurta(chave) };
      case 'diaSemana': return { rotulo: LC.fmt.diaSemana(+chave) };
      case 'categoria': { const c = est.categorias.find((x) => x.id === chave); return { rotulo: c ? c.nome : 'Sem categoria', cor: c ? c.cor : 'neutro' }; }
      case 'pessoa': { const p = est.pessoas.find((x) => x.id === chave); return { rotulo: p ? p.nome : 'Sem pessoa', cor: p ? p.cor : 'neutro' }; }
      case 'tipo': return chave === 'receita' ? { rotulo: 'Recebido', cor: 'p1' } : { rotulo: 'Gasto', cor: 'p2' };
      case 'situacao': return chave === 'pago' ? { rotulo: 'Pagos', cor: 'p3' } : { rotulo: 'Pendentes', cor: 'p4' };
      default: return { rotulo: String(chave) };
    }
  }

  // Configuração efetiva: o editor pode deixar combinações sem sentido; aqui elas viram algo desenhável.
  function configEfetiva(cfg) {
    const c = normalizarGrafico(cfg);
    const m = MEDIDAS[c.medida];
    if (m.soTempo && !AGRUPAMENTOS[c.agrupar].tempo) c.agrupar = 'mes';
    if (c.medida === 'orcamento' && c.agrupar !== 'categoria' && c.agrupar !== 'mes') c.agrupar = 'categoria';
    if (c.medida === 'poupanca' && !AGRUPAMENTOS[c.agrupar].tempo && c.agrupar !== 'pessoa') c.agrupar = 'mes';
    if (m.multi || c.medida === 'acumulado' || c.medida === 'poupanca' || c.dividir === c.agrupar) c.dividir = 'nenhum';
    if ((c.tipo === 'rosca' || c.tipo === 'pizza') && (m.multi || c.dividir !== 'nenhum')) c.tipo = 'colunas';
    return c;
  }

  function dadosGrafico(cfgBruta, est, f, hoje) {
    const cfg = configEfetiva(cfgBruta);
    const medida = MEDIDAS[cfg.medida];
    const ag = AGRUPAMENTOS[cfg.agrupar];
    const restritas = cfg.categorias.length ? new Set(cfg.categorias) : null;
    const idsPessoas = new Set(est.pessoas.map((p) => p.id));
    const soPessoas = cfg.pessoas.filter((id) => idsPessoas.has(id));
    const pessoasDoGrafico = soPessoas.length ? new Set(soPessoas) : null;
    let lista = filtrar(est, f).filter((t) => t.tipo !== 'transferencia');
    if (pessoasDoGrafico) lista = lista.filter((t) => pessoasDoGrafico.has(t.pessoa));
    if (restritas && cfg.medida !== 'acumulado') lista = lista.filter((t) => restritas.has(t.categoria));
    if (cfg.medida === 'despesas') lista = lista.filter((t) => t.tipo === 'despesa');
    if (cfg.medida === 'receitas') lista = lista.filter((t) => t.tipo === 'receita');

    const saida = { cfg, unidade: medida.unidade, tempo: !!ag.tempo, chaves: [], rotulos: [], series: [], coresItens: null, total: 0 };

    let chaves;
    if (ag.tempo) {
      const lim = limitesDados(est);
      const inicio = f.inicio || lim.min, fim = f.fim || lim.max;
      chaves = inicio && fim ? sequenciaTempo(cfg.agrupar, inicio, fim) : [];
    } else if (cfg.agrupar === 'diaSemana') {
      chaves = ['0', '1', '2', '3', '4', '5', '6'];
    } else if (cfg.medida === 'orcamento') {
      const gasto = new Set(lista.filter((t) => t.tipo === 'despesa').map((t) => t.categoria));
      chaves = est.categorias.filter((c) => c.tipo === 'despesa' && (!restritas || restritas.has(c.id))
        && (c.orcamento > 0 || gasto.has(c.id))).map((c) => c.id);
    } else {
      chaves = [...new Set(lista.map((t) => chaveGrupo(cfg.agrupar, t)))];
    }
    const posicao = new Map(chaves.map((k, i) => [k, i]));
    const zeros = () => chaves.map(() => 0);

    // Acúmulo genérico: soma[série][grupo]
    const somar = (definicoes, filtroSerie) => {
      const series = definicoes.map((d) => ({ ...d, valores: zeros() }));
      const porChave = new Map(series.map((s) => [s.chave, s]));
      for (const t of lista) {
        const i = posicao.get(chaveGrupo(cfg.agrupar, t));
        if (i === undefined) continue;
        for (const [chave, v] of filtroSerie(t)) {
          const s = porChave.get(chave);
          if (s) s.valores[i] += v;
        }
      }
      return series;
    };

    const sinal = (t) => (t.tipo === 'receita' ? t.valor : -t.valor);
    let series;

    if (cfg.medida === 'receitasDespesas' || cfg.medida === 'fluxo') {
      const defs = [
        { chave: 'receitas', nome: 'Recebido', cor: 'p1' },
        { chave: 'despesas', nome: 'Gasto', cor: 'p2' },
      ];
      if (cfg.medida === 'fluxo') defs.push({ chave: 'resultado', nome: 'Restante', cor: 'p3', marca: 'linha' });
      series = somar(defs, (t) => {
        const r = [[t.tipo === 'receita' ? 'receitas' : 'despesas', t.valor]];
        if (cfg.medida === 'fluxo') r.push(['resultado', sinal(t)]);
        return r;
      });
    } else if (cfg.medida === 'orcamento') {
      series = somar([
        { chave: 'orcado', nome: 'Orçado', cor: 'neutro' },
        { chave: 'realizado', nome: 'Gasto', cor: 'p2' },
      ], (t) => (t.tipo === 'despesa' ? [['realizado', t.valor]] : []));
      const orcado = series[0];
      if (cfg.agrupar === 'categoria') {
        chaves.forEach((k, i) => { const c = est.categorias.find((x) => x.id === k); orcado.valores[i] = (c ? c.orcamento : 0) * f.meses; });
      } else {
        const total = est.categorias.filter((c) => c.tipo === 'despesa' && (!restritas || restritas.has(c.id)))
          .reduce((s, c) => s + c.orcamento, 0);
        orcado.valores = chaves.map(() => total);
      }
    } else if (cfg.medida === 'acumulado') {
      const grupo = new Set(pessoasDoGrafico ? [...pessoasDoGrafico] : f.pessoa === 'todas' ? est.pessoas.map((p) => p.id) : [f.pessoa]);
      const passa = (t) => f.situacao === 'todas' || t.situacao === f.situacao;
      let saldo = est.pessoas.filter((p) => grupo.has(p.id)).reduce((s, p) => s + p.saldoInicial, 0);
      const primeiro = chaves[0];
      const movimentos = zeros();
      for (const t of est.lancamentos) {
        if (!passa(t)) continue;
        if (primeiro && t.data < (cfg.agrupar === 'mes' ? D.inicioDoMes(primeiro) : primeiro)) { saldo += efeito(t, grupo); continue; }
        if (t.data > f.fim) continue;
        const i = posicao.get(chaveGrupo(cfg.agrupar, t));
        if (i !== undefined) movimentos[i] += efeito(t, grupo);
      }
      const valores = movimentos.map((m) => (saldo += m));
      series = [{ chave: 'acumulado', nome: 'Saldo', cor: COR_MEDIDA.acumulado, valores }];
    } else if (cfg.medida === 'poupanca') {
      const base = somar([{ chave: 'r', nome: 'r' }, { chave: 'd', nome: 'd' }],
        (t) => [[t.tipo === 'receita' ? 'r' : 'd', t.valor]]);
      const valores = base[0].valores.map((r, i) => (r > 0 ? (r - base[1].valores[i]) / r : null));
      series = [{ chave: 'poupanca', nome: '% guardado', cor: COR_MEDIDA.poupanca, valores }];
    } else {
      const valor = cfg.medida === 'quantidade' ? () => 1 : cfg.medida === 'resultado' ? sinal : (t) => t.valor;
      if (cfg.dividir !== 'nenhum') {
        const chavesSerie = [...new Set(lista.map((t) => chaveGrupo(cfg.dividir, t)))];
        series = somar(chavesSerie.map((k) => ({ chave: k, nome: descreverItem(cfg.dividir, k, est).rotulo, cor: descreverItem(cfg.dividir, k, est).cor })),
          (t) => [[chaveGrupo(cfg.dividir, t), valor(t)]]);
        series.sort((a, b) => soma(b.valores) - soma(a.valores));
        if (cfg.maxItens && series.length > cfg.maxItens) {
          const resto = series.splice(cfg.maxItens);
          series.push({ chave: OUTROS, nome: 'Outros', cor: 'neutro', valores: chaves.map((_, i) => resto.reduce((s, x) => s + x.valores[i], 0)) });
        }
      } else {
        const nome = MEDIDAS[cfg.medida].nome.split(' (')[0];
        series = somar([{ chave: cfg.medida, nome, cor: COR_MEDIDA[cfg.medida] || 'p1' }], (t) => [[cfg.medida, valor(t)]]);
      }
    }

    // Ordenação e "Outros" nos agrupamentos por item (categoria, pessoa...).
    if (!ag.tempo && cfg.agrupar !== 'diaSemana') {
      const ref = cfg.medida === 'orcamento' ? series[1] : series[0];
      const peso = chaves.map((_, i) => series.reduce((s, x) => s + Math.abs(x.valores[i] || 0), 0));
      const ordemIdx = chaves.map((_, i) => i);
      if (cfg.ordem === 'alfa') {
        ordemIdx.sort((a, b) => descreverItem(cfg.agrupar, chaves[a], est).rotulo.localeCompare(descreverItem(cfg.agrupar, chaves[b], est).rotulo, 'pt-BR'));
      } else {
        const v = cfg.medida === 'orcamento' ? ref.valores : peso;
        ordemIdx.sort((a, b) => (cfg.ordem === 'valor-asc' ? v[a] - v[b] : v[b] - v[a]));
      }
      if (cfg.dividir === 'nenhum' && cfg.maxItens && ordemIdx.length > cfg.maxItens && cfg.medida !== 'orcamento') {
        const resto = ordemIdx.splice(cfg.maxItens);
        chaves.push(OUTROS);
        for (const s of series) s.valores.push(resto.reduce((acc, i) => acc + s.valores[i], 0));
        ordemIdx.push(chaves.length - 1);
      }
      chaves = ordemIdx.map((i) => chaves[i]);
      for (const s of series) s.valores = ordemIdx.map((i) => s.valores[i]);
      if (series.length === 1) saida.coresItens = chaves.map((k) => descreverItem(cfg.agrupar, k, est).cor || series[0].cor);
    }

    for (const s of series) s.valores = s.valores.map((v) => (v == null ? null : cfg.medida === 'poupanca' || cfg.medida === 'quantidade' ? v : arred(v)));
    saida.chaves = chaves;
    saida.rotulos = chaves.map((k) => descreverItem(cfg.agrupar, k, est).rotulo);
    saida.series = series;
    saida.total = series.length ? soma(series[0].valores) : 0;
    saida.vazio = !chaves.length || series.every((s) => s.valores.every((v) => !v));
    saida.hoje = hoje;
    return saida;
  }

  function soma(v) { return v.reduce((s, x) => s + (x || 0), 0); }

  // ── Recorrência e parcelamento ───────────────────────────────────────────

  // "Repetir mensalmente" copia o valor; "parcelado" divide e marca (1/10), (2/10)...
  function expandirRecorrencia(base, modo, vezes, hoje) {
    if (modo !== 'mensal' && modo !== 'parcelas') return [base];
    const n = Math.max(2, Math.min(120, vezes | 0));
    const dia = +base.data.slice(8, 10);
    const mes0 = D.mes(base.data);
    const parcela = modo === 'parcelas' ? Math.floor((base.valor / n) * 100) / 100 : base.valor;
    const lista = [];
    for (let i = 0; i < n; i++) {
      const dataI = D.noMes(D.somaMeses(mes0, i), dia);
      const valor = modo === 'parcelas' && i === n - 1 ? arred(base.valor - parcela * (n - 1)) : parcela;
      lista.push({
        ...base,
        id: novoId('l'),
        data: dataI,
        valor,
        descricao: modo === 'parcelas' ? `${base.descricao} (${i + 1}/${n})` : base.descricao,
        situacao: i === 0 ? base.situacao : dataI <= hoje ? base.situacao : 'pendente',
      });
    }
    return lista;
  }

  // ── Importação: lista de lançamentos (extrato, CSV) ──────────────────────

  const CAMPOS_IMPORTACAO = {
    data: { nome: 'Data', obrigatorio: true, sinonimos: ['data', 'date', 'dt', 'dia', 'data lancamento', 'data do lancamento', 'data da transacao', 'data movimento', 'data mov', 'vencimento', 'data de vencimento', 'data compra'] },
    descricao: { nome: 'Descrição', sinonimos: ['descricao', 'historico', 'description', 'titulo', 'lancamento', 'estabelecimento', 'memo', 'detalhes', 'detalhe', 'item', 'favorecido'] },
    valor: { nome: 'Valor', sinonimos: ['valor', 'value', 'amount', 'quantia', 'montante', 'valor (r$)', 'valor r$', 'valor em r$', 'total', 'preco'] },
    entrada: { nome: 'Entradas (crédito)', sinonimos: ['entrada', 'entradas', 'credito', 'creditos', 'receita', 'receitas', 'recebido', 'valor entrada'] },
    saida: { nome: 'Saídas (débito)', sinonimos: ['saida', 'saidas', 'debito', 'debitos', 'despesa', 'despesas', 'gasto', 'gastos', 'valor saida'] },
    tipo: { nome: 'Tipo', sinonimos: ['tipo', 'type', 'natureza', 'operacao', 'movimento', 'entrada/saida', 'receita/despesa', 'd/c', 'c/d', 'credito/debito'] },
    categoria: { nome: 'Categoria', sinonimos: ['categoria', 'category', 'classificacao', 'grupo', 'subcategoria', 'centro de custo'] },
    pessoa: { nome: 'Pessoa', sinonimos: ['pessoa', 'quem', 'responsavel', 'nome', 'titular', 'dono', 'conta', 'pagador'] },
    situacao: { nome: 'Situação', sinonimos: ['situacao', 'status', 'pago?', 'quitado', 'efetivado', 'estado', 'pago'] },
    obs: { nome: 'Observação', sinonimos: ['observacao', 'observacoes', 'obs', 'notas', 'nota', 'comentario', 'comentarios', 'notes'] },
  };
  const ORDEM_SUGESTAO = ['data', 'valor', 'entrada', 'saida', 'descricao', 'tipo', 'categoria', 'pessoa', 'situacao', 'obs'];

  function pontuarCabecalho(celula, campo) {
    const t = dobrar(celula).replace(/[:.]$/, '');
    if (!t) return 0;
    const sin = CAMPOS_IMPORTACAO[campo].sinonimos;
    if (sin.includes(t)) return 3;
    if (sin.some((s) => s.length > 2 && t.startsWith(s + ' '))) return 2;
    if (sin.some((s) => s.length > 3 && t.includes(s))) return 1;
    return 0;
  }

  // Primeira linha (entre as 15 primeiras) que parece um cabeçalho.
  function detectarCabecalho(linhas) {
    let melhor = 0, pontos = -1;
    for (let i = 0; i < Math.min(15, linhas.length); i++) {
      const p = (linhas[i] || []).reduce((s, cel) => s + Math.max(...Object.keys(CAMPOS_IMPORTACAO).map((c) => pontuarCabecalho(cel, c))), 0);
      if (p > pontos) { pontos = p; melhor = i; }
    }
    return pontos > 0 ? melhor : 0;
  }

  function sugerirMapa(cabecalho) {
    const mapa = {}; const usadas = new Set();
    for (const campo of ORDEM_SUGESTAO) {
      let melhor = -1, pontos = 0;
      cabecalho.forEach((cel, i) => {
        if (usadas.has(i)) return;
        const p = pontuarCabecalho(cel, campo);
        if (p > pontos) { pontos = p; melhor = i; }
      });
      if (melhor >= 0) { mapa[campo] = melhor; usadas.add(melhor); }
    }
    return mapa;
  }

  function sugerirModoTipo(mapa, linhas) {
    if (mapa.entrada != null || mapa.saida != null) return 'colunas';
    if (mapa.tipo != null) return 'coluna';
    if (mapa.valor != null && linhas.some((l) => LC.paraNumero(l[mapa.valor]) < 0)) return 'sinal';
    return 'despesa';
  }

  function lerTipo(texto) {
    const t = dobrar(texto);
    if (!t) return null;
    if (/^transf/.test(t)) return 'transferencia';
    if (/^(c|cr|\+|r|e|entrada|receita|recebimento|recebido|credito|cred|income|deposito|ganho|salario)\b/.test(t)) return 'receita';
    if (/^(d|db|-|s|g|saida|despesa|gasto|debito|deb|pagamento|expense|compra|custo)\b/.test(t)) return 'despesa';
    return null;
  }

  function lerSituacao(texto, dataISO, hoje) {
    const t = dobrar(texto);
    if (/^(pago|paga|pagos|sim|s|ok|x|quitad|liquidad|recebid|efetivad|conciliad|confirmad|feit|realizad|true|verdadeiro|1)\b/.test(t)) return 'pago';
    if (/^(pendente|nao|n|aberto|em aberto|a pagar|a receber|agendad|previst|false|falso|0)\b/.test(t)) return 'pendente';
    return dataISO <= hoje ? 'pago' : 'pendente';
  }

  const chaveDuplicado = (t) => `${t.data}|${t.valor.toFixed(2)}|${t.tipo}|${dobrar(t.descricao)}`;

  // Cadastros que a importação pode criar, numa cópia do estado (nada é alterado até confirmar).
  function cadastrosDeTrabalho(est) {
    const categorias = clonar(est.categorias);
    const pessoas = clonar(est.pessoas);
    const novasCategorias = [], novasPessoas = [];
    return {
      categorias, pessoas, novasCategorias, novasPessoas,
      categoria(nome, tipo) {
        const alvo = chaveNome(nome);
        if (!alvo) return null;
        let c = categorias.find((x) => x.tipo === tipo && chaveNome(x.nome) === alvo);
        if (!c) {
          const limpo = String(nome).trim().replace(/\s+/g, ' ');
          c = { id: novoId('c'), nome: (limpo[0].toUpperCase() + limpo.slice(1)).slice(0, 60), tipo, cor: proximaCor(categorias.filter((x) => x.tipo === tipo)), orcamento: 0 };
          categorias.push(c); novasCategorias.push(c);
        }
        return c.id;
      },
      pessoa(nome) {
        const alvo = chaveNome(nome);
        if (!alvo) return null;
        let p = pessoas.find((x) => chaveNome(x.nome) === alvo);
        if (!p) {
          const limpo = String(nome).trim();
          p = { id: novoId('p'), nome: (limpo[0].toUpperCase() + limpo.slice(1)).slice(0, 40), cor: proximaCor(pessoas), saldoInicial: 0, colunas: [] };
          pessoas.push(p); novasPessoas.push(p);
        }
        return p.id;
      },
    };
  }

  /*
   * linhas (já sem cabeçalho) + mapa {campo: índice} + opções ─► lançamentos prontos para entrar.
   */
  function prepararImportacao(linhas, mapa, opcoes, est, hoje) {
    const cad = cadastrosDeTrabalho(est);
    const itens = []; const erros = [];
    const anoPadrao = +hoje.slice(0, 4);
    const cel = (l, campo) => (mapa[campo] == null || mapa[campo] === '' ? '' : l[mapa[campo]]);

    linhas.forEach((l, i) => {
      if (!l || l.every((x) => x === '' || x == null)) return;
      const dataISO = LC.paraData(cel(l, 'data'), anoPadrao);
      let valor = NaN, tipo = null;
      if (opcoes.modoTipo === 'colunas') {
        const e = LC.paraNumero(cel(l, 'entrada')), s = LC.paraNumero(cel(l, 'saida'));
        if (Number.isFinite(e) && e !== 0) { valor = Math.abs(e); tipo = e > 0 ? 'receita' : 'despesa'; }
        else if (Number.isFinite(s) && s !== 0) { valor = Math.abs(s); tipo = 'despesa'; }
      } else {
        const v = LC.paraNumero(cel(l, 'valor'));
        if (Number.isFinite(v)) {
          valor = Math.abs(v);
          if (opcoes.modoTipo === 'receita') tipo = 'receita';
          else if (opcoes.modoTipo === 'despesa') tipo = 'despesa';
          else if (opcoes.modoTipo === 'coluna') tipo = lerTipo(cel(l, 'tipo')) || (v < 0 ? 'despesa' : 'receita');
          else tipo = v < 0 ? 'despesa' : 'receita';
        }
      }
      if (tipo === 'transferencia') tipo = 'despesa';
      if (!dataISO || !Number.isFinite(valor) || valor === 0) {
        erros.push({ linha: i, motivo: !dataISO ? 'data não reconhecida' : 'valor vazio ou inválido' });
        return;
      }
      const descricao = String(cel(l, 'descricao') ?? '').trim() || (tipo === 'receita' ? 'Recebimento' : 'Gasto');
      itens.push(normalizarLancamento({
        id: novoId('l'),
        data: dataISO,
        descricao,
        tipo,
        valor,
        categoria: cad.categoria(cel(l, 'categoria'), tipo) || categoriaPadrao({ categorias: cad.categorias }, tipo),
        pessoa: cad.pessoa(cel(l, 'pessoa')) || opcoes.pessoaPadrao || cad.pessoas[0].id,
        situacao: mapa.situacao != null ? lerSituacao(cel(l, 'situacao'), dataISO, hoje) : dataISO <= hoje ? 'pago' : 'pendente',
        obs: String(cel(l, 'obs') ?? '').trim(),
      }));
    });

    let duplicados = 0;
    let finais = itens;
    if (opcoes.ignorarDuplicados && !opcoes.substituir) {
      const existentes = new Set(est.lancamentos.map(chaveDuplicado));
      finais = itens.filter((t) => {
        if (existentes.has(chaveDuplicado(t))) { duplicados++; return false; }
        return true;
      });
    }
    return fecharCadastros(cad, finais, { itens: finais, erros, duplicados });
  }

  // Só leva cadastros novos que algum lançamento realmente usa.
  function fecharCadastros(cad, itens, extra) {
    const usadasCat = new Set(itens.map((t) => t.categoria));
    const usadasPessoa = new Set(itens.map((t) => t.pessoa));
    return {
      ...extra,
      categorias: cad.categorias.filter((c) => !cad.novasCategorias.includes(c) || usadasCat.has(c.id)),
      pessoas: cad.pessoas.filter((p) => !cad.novasPessoas.includes(p) || usadasPessoa.has(p.id) || p.colunas.length),
      novasCategorias: cad.novasCategorias.filter((c) => usadasCat.has(c.id)),
      novasPessoas: cad.novasPessoas.filter((p) => usadasPessoa.has(p.id) || p.colunas.length),
    };
  }

  // ── Importação: planilha mensal (Mês × categorias), como a "Gastos" ──────

  const MESES_CHAVE = MESES_NOMES.map((m) => dobrar(m));
  const MESES_CURTOS = MESES_CHAVE.map((m) => m.slice(0, 3));

  function mesDaCelula(celula) {
    if (celula == null || celula === '') return null;
    const t = dobrar(String(celula)).replace(/[.:]$/, '');
    let i = MESES_CHAVE.indexOf(t);
    if (i < 0) i = MESES_CURTOS.indexOf(t);
    if (i >= 0) return { mes: i + 1, ano: null };
    const m = t.match(/^([a-z]{3})[a-z]*[\s/.-]+(\d{2}|\d{4})$/);
    if (m && MESES_CURTOS.includes(m[1])) return { mes: MESES_CURTOS.indexOf(m[1]) + 1, ano: m[2].length === 2 ? 2000 + +m[2] : +m[2] };
    return null;
  }

  // Coluna de total ou restante é calculada: não vira lançamento.
  function papelColuna(nome) {
    const t = dobrar(nome);
    if (!t) return 'ignorar';
    if (/^(total|subtotal|soma|saldo|resultado|diferenca|sobra|media|categoria|mes|ano)\b/.test(t) || /restante|sobrou|sobra\b|guardad|%|percent/.test(t)) return 'ignorar';
    if (/salario|recebid|receb|renda|receita|entrada|ganho|provento|bonus|13o|decimo|ferias|freela/.test(t)) return 'receita';
    return 'despesa';
  }

  // "Gastos Nathy" → "Nathy"; "Gastos" → "" (aba sem dono).
  function pessoaDaAba(nome) {
    if (/^\s*(total|resumo|lan[cç]amentos)\b/i.test(String(nome))) return '';
    const resto = String(nome).replace(/\b(gastos?|despesas?|finan[cç]as|planilha|controle|mensal|mensais|de|do|da|dos|das)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!resto || /^\d+$/.test(resto)) return '';
    return resto[0].toUpperCase() + resto.slice(1);
  }

  /*
   * Lê uma aba no formato mensal. Aceita blocos por ano (uma linha só com "2026" separa os anos)
   * e cabeçalho com o ano ao lado ("Mes | 2025"). Devolve null se a aba não tem esse formato.
   */
  function detectarMensal(linhas) {
    const ehAno = (v) => {
      const n = typeof v === 'number' ? v : /^\s*\d{4}\s*$/.test(String(v ?? '')) ? +v : NaN;
      return n >= 2000 && n <= 2100 ? n : null;
    };
    let ano = null;
    for (const l of linhas.slice(0, 3)) for (const v of l || []) if (ano == null && ehAno(v)) ano = ehAno(v);
    let cabecalho = null;
    const colunas = new Map();
    const entradas = [];
    let mesesVistos = 0;
    const anos = new Set();
    for (const l of linhas) {
      if (!l || !l.length) continue;
      const primeiro = l[0];
      const resto = l.slice(1).filter((x) => x !== '' && x != null);
      if (ehAno(primeiro) && (!resto.length || (resto.length === 1 && ehAno(resto[0])))) { ano = ehAno(primeiro); continue; }
      const mes = mesDaCelula(primeiro);
      if (mes) {
        if (!cabecalho) continue;
        mesesVistos++;
        const anoLinha = mes.ano || ano;
        for (const [j] of cabecalho) {
          const v = LC.paraNumero(l[j]);
          if (Number.isFinite(v) && v !== 0) { entradas.push({ ano: anoLinha, mes: mes.mes, coluna: j, valor: v }); if (anoLinha) anos.add(anoLinha); }
        }
        continue;
      }
      const textos = l.map((x, j) => [j, x]).filter(([j, x]) => j > 0 && typeof x === 'string' && x.trim() && !/^[\d.,\s]+$/.test(x));
      if (textos.length >= 2) {
        cabecalho = new Map(textos.map(([j, x]) => [j, x.trim().replace(/\s+/g, ' ')]));
        for (const [j, nome] of cabecalho) if (!colunas.has(j)) colunas.set(j, { indice: j, nome, papel: papelColuna(nome) });
        const anoNoCabecalho = l.map(ehAno).find(Boolean);
        if (anoNoCabecalho) ano = anoNoCabecalho;
      }
    }
    if (mesesVistos < 2 || !colunas.size) return null;
    const lista = [...colunas.values()];
    return {
      colunas: lista,
      entradas,
      anos: [...anos].sort(),
      semAno: entradas.some((e) => !e.ano),
      resumo: lista.every((c) => c.papel === 'ignorar'),
    };
  }

  /*
   * Anos que as abas com nome de pessoa ("Gastos Nathy") já cobrem: ano → nomes dessas abas.
   * Uma aba sem pessoa no nome (a "Gastos" antiga, que vira "Casa") não deve repetir esses anos: a Total finanças
   * da planilha soma só as abas das pessoas, e importar as duas coisas conta os mesmos gastos duas vezes.
   * Aba de pessoa sem ano escrito (nem valor) é do ano escolhido para as abas sem ano.
   */
  function anosJaCobertos(abas, anoPadrao) {
    const cobertos = new Map();
    for (const a of abas) {
      if (!a.mensal || a.mensal.resumo || a.incluir === false || !pessoaDaAba(a.nome)) continue;
      const anos = a.mensal.anos.length ? [...a.mensal.anos, ...(a.mensal.semAno ? [anoPadrao] : [])] : [anoPadrao];
      for (const ano of anos) {
        if (!cobertos.has(ano)) cobertos.set(ano, []);
        if (!cobertos.get(ano).includes(a.nome)) cobertos.get(ano).push(a.nome);
      }
    }
    return cobertos;
  }

  /*
   * abas: [{ nome, mensal (de detectarMensal), pessoa: id | '__nova:Nome', papeis: {indice: papel}, incluir, anosFora: Set(ano) }]
   * Cada valor vira um lançamento "mensal" no dia 1º do mês, na categoria com o nome da coluna.
   * Os anos em anosFora não entram; uma aba com todos os anos de fora não entra (nem cria a pessoa).
   */
  function prepararImportacaoMensal(abas, opcoes, est, hoje) {
    const cad = cadastrosDeTrabalho(est);
    const itens = [];
    const mesesSubstituidos = new Map(); // pessoa → Set(mês)
    let ignorados = 0;
    for (const aba of abas) {
      if (!aba.incluir || !aba.mensal) continue;
      const fora = aba.anosFora || new Set();
      const anosAba = new Set(aba.mensal.entradas.map((e) => e.ano || opcoes.anoPadrao).filter(Boolean));
      if (anosAba.size && [...anosAba].every((a) => fora.has(a))) continue;
      let pessoaId = aba.pessoa;
      if (!pessoaId || pessoaId.startsWith('__nova:')) pessoaId = cad.pessoa(pessoaId ? pessoaId.slice(7) : 'Casa');
      const pessoa = cad.pessoas.find((p) => p.id === pessoaId);
      const categoriaDaColuna = new Map();
      for (const col of aba.mensal.colunas) {
        const papel = (aba.papeis && aba.papeis[col.indice]) || col.papel;
        if (papel === 'ignorar') continue;
        const catId = cad.categoria(col.nome, papel);
        categoriaDaColuna.set(col.indice, { catId, papel });
        if (pessoa && !pessoa.colunas.includes(catId)) pessoa.colunas.push(catId);
      }
      for (const e of aba.mensal.entradas) {
        const col = categoriaDaColuna.get(e.coluna);
        if (!col) continue;
        const ano = e.ano || opcoes.anoPadrao;
        if (!ano) { ignorados++; continue; }
        if (fora.has(ano)) continue;
        const chaveMes = `${ano}-${String(e.mes).padStart(2, '0')}`;
        const data = `${chaveMes}-01`;
        const cat = cad.categorias.find((c) => c.id === col.catId);
        itens.push(normalizarLancamento({
          id: novoId('l'), data, descricao: cat.nome, categoria: col.catId, tipo: col.papel, valor: Math.abs(e.valor),
          pessoa: pessoaId, situacao: data <= hoje ? 'pago' : 'pendente', mensal: true,
        }));
        if (!mesesSubstituidos.has(pessoaId)) mesesSubstituidos.set(pessoaId, new Set());
        mesesSubstituidos.get(pessoaId).add(chaveMes);
      }
    }
    const r = fecharCadastros(cad, itens, { itens, ignorados, mesesSubstituidos });
    // Colunas de pessoas novas que ficaram sem uso continuam (a aba existia, só estava vazia).
    return r;
  }

  // ── Dados de exemplo ─────────────────────────────────────────────────────

  // 12 meses fictícios no formato da planilha: fixos e totais mensais, alguns gastos lançados um a um
  // e as contas fixas do mês seguinte já agendadas. Valores inventados, marcados como exemplo.
  const ORCAMENTOS_EXEMPLO = { comida: 650, cartao: 1200, gasolina: 320, compras: 300, 'gastos-extras': 450, jogos: 120, outros: 150 };

  function gerarExemplo(hoje) {
    const est = estadoVazio();
    for (const c of est.categorias) if (ORCAMENTOS_EXEMPLO[c.id]) c.orcamento = ORCAMENTOS_EXEMPLO[c.id];

    const rnd = LC.prng(2026);
    const entre = (a, b) => a + (b - a) * rnd();
    const dia = (a, b) => Math.floor(entre(a, b + 1));
    const chance = (p) => rnd() < p;
    const mesAtual = D.mes(hoje);
    const lanc = [];

    const add = (pessoa, categoria, dataISO, valor, extra = {}) => {
      const cat = est.categorias.find((c) => c.id === categoria);
      lanc.push(normalizarLancamento({
        id: 'ex-' + lanc.length.toString(36) + '-' + dataISO.slice(0, 7), data: dataISO, descricao: extra.descricao || cat.nome,
        categoria, tipo: cat.tipo, valor: arred(valor), pessoa, situacao: dataISO > hoje ? 'pendente' : 'pago',
        mensal: !extra.descricao, exemplo: true,
      }));
    };

    for (let k = -11; k <= 1; k++) {
      const mes = D.somaMeses(mesAtual, k);
      const m = +mes.slice(5, 7);
      const d1 = `${mes}-01`;
      const futuro = k === 1;
      // fixos (também no mês seguinte, como na aba antiga que já trazia os fixos do ano)
      add('vini', 'aluguel', d1, 1100);
      add('vini', 'faculdade', d1, 420);
      add('vini', 'internet', d1, 120);
      add('vini', 'seguro-carro', d1, 165);
      add('vini', 'academia', d1, 89.9);
      add('nathy', 'academia', d1, 99.9);
      if (k >= -9 && k <= -2) add('nathy', 'pc', d1, 350);
      add('nathy', 'salario', d1, m === 12 ? 4650 : 3100);
      add('vini', 'salario', d1, m === 12 ? 5400 : 3600);
      if (futuro) continue;
      add('nathy', 'cartao', d1, entre(650, 1350));
      add('nathy', 'areia-gatos', d1, entre(45, 72));
      add('nathy', 'racao-athena', d1, entre(140, 190));
      add('nathy', 'racao-gatos', d1, entre(90, 135));
      add('nathy', 'compras', d1, entre(110, 420));
      if (chance(0.6)) add('nathy', 'jogos', d1, entre(40, 160));
      add('nathy', 'outros', d1, entre(30, 170));
      add('vini', 'agua', d1, entre(52, 96));
      add('vini', 'gastos-extras', d1, entre(140, 620));
      if (k === -8) add('nathy', 'oculos', d1, 480);
      if (k === -5) add('nathy', 'maquina', d1, 1290);
      // Comida e gasolina lançadas uma a uma (a planilha mensal soma sozinha)
      for (let i = 0, n = dia(3, 5); i < n; i++) {
        const data = D.noMes(mes, dia(2, 27));
        if (data <= hoje) add('nathy', 'comida', data, entre(70, 190), { descricao: chance(0.5) ? 'Mercado' : 'Feira e padaria' });
      }
      for (let i = 0; i < 2; i++) {
        const data = D.noMes(mes, dia(3, 26));
        if (data <= hoje) add('nathy', 'gasolina', data, entre(110, 170), { descricao: 'Posto' });
      }
    }
    est.lancamentos = lanc.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
    return est;
  }

  // Tira o que veio do exemplo: lançamentos marcados e os orçamentos que ainda têm o valor do exemplo.
  function limparExemplos(est) {
    est.lancamentos = est.lancamentos.filter((t) => !t.exemplo);
    for (const c of est.categorias) if (ORCAMENTOS_EXEMPLO[c.id] && c.orcamento === ORCAMENTOS_EXEMPLO[c.id]) c.orcamento = 0;
  }

  LC.Dados = {
    ROTULO_TIPO, ROTULO_SITUACAO, MESES_NOMES, CATEGORIAS_PADRAO, PESSOAS_PADRAO, GRAFICOS_PADRAO,
    AGRUPAMENTOS, MEDIDAS, DIVISOES, PERIODOS, CAMPOS_IMPORTACAO, OUTROS,
    clonar, estadoVazio, sanear, normalizarLancamento, normalizarGrafico, categoriaPadrao, proximaCor, mapaPorId, chaveNome,
    limitesDados, periodo, periodoAnterior, filtrar, envolvePessoa, totais, efeito, saldosPessoas, ajustarSaldo, pendencias, serieMensal,
    resumoMes, anosComDados, matrizMensal, definirValorMensal,
    configEfetiva, dadosGrafico, expandirRecorrencia,
    detectarCabecalho, sugerirMapa, sugerirModoTipo, lerTipo, lerSituacao, prepararImportacao, chaveDuplicado,
    mesDaCelula, papelColuna, pessoaDaAba, detectarMensal, anosJaCobertos, prepararImportacaoMensal,
    gerarExemplo, limparExemplos,
  };
})(globalThis.LC = globalThis.LC || {});
