/*
 * app.js — Liga tudo: navegação, filtros do topo, painel, planilha mensal, lançamentos, orçamento,
 * cadastros, formulários, importação e salvamento.
 *
 *   alterar(fn) ─► muda o estado ─► agenda salvamento (0,7 s) ─► redesenha a tela ativa
 *   filtros do topo (período, pessoa, situação) valem para o painel e para os lançamentos
 */
(function (LC) {
  'use strict';

  const { el, icone, esvaziar, fmt, $ } = LC;
  const D = LC.data;
  const Dd = LC.Dados, G = LC.Graficos, A = LC.Arquivos, S = LC.Armazenamento;
  const VISTAS = {
    painel: { titulo: 'Painel' },
    mensal: { titulo: 'Planilha mensal' },
    lancamentos: { titulo: 'Lançamentos' },
    orcamento: { titulo: 'Orçamento' },
    cadastros: { titulo: 'Cadastros' },
  };

  const app = {
    estado: null,
    armazenamento: null,
    prefs: { periodo: '6m', pessoa: 'todas', situacao: 'todas', de: '', ate: '', vista: 'painel', tema: 'sistema', abaCategorias: 'despesa' },
    modoExemplo: false,
    salvamento: 'ok',
    erroSalvar: '',
    errosNuvem: 0,
    cartoes: new Map(),
    gruposAbertos: new Map(), // gráfico por grupo → grupo aberto (mostrando as categorias)
    planilha: null,
    mensal: null,
  };

  const hoje = () => D.hoje();
  const filtro = () => Dd.periodo(app.prefs, hoje(), app.estado);
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const nomeMes = (chave) => Dd.MESES_NOMES[+chave.slice(5, 7) - 1].toLowerCase();

  function salvarPrefs(parcial) {
    Object.assign(app.prefs, parcial);
    S.gravarPrefs(app.prefs);
  }

  // ── Estado e salvamento ──────────────────────────────────────────────────

  function alterar(fn) {
    fn(app.estado);
    app.modoExemplo = false;
    agendarSalvar();
    render();
  }

  const salvarDepois = LC.adiar(salvarAgora, 700);
  function agendarSalvar() {
    app.salvamento = 'pendente';
    renderStatus();
    salvarDepois();
  }

  async function salvarAgora() {
    if (!app.armazenamento) return;
    app.salvamento = 'salvando';
    renderStatus();
    const errosAntes = app.errosNuvem;
    try {
      await app.armazenamento.salvar(app.estado);
      if (app.errosNuvem !== errosAntes) return; // o banco recusou algo no caminho: o aviso já apareceu
      app.salvamento = salvarDepois.pendente() ? 'pendente' : 'ok';
      app.erroSalvar = '';
    } catch (e) {
      app.salvamento = 'erro';
      app.erroSalvar = e.message;
      LC.UI.aviso(e.message, { tipo: 'erro', duracao: 9000 });
    }
    renderStatus();
  }

  // Firebase: uma gravação que já tinha ido para a fila do banco foi recusada pelo servidor.
  function aoErroNuvem(e) {
    app.errosNuvem++;
    const repetido = app.erroSalvar === e.message && app.salvamento === 'erro';
    app.salvamento = 'erro';
    app.erroSalvar = e.message;
    renderStatus();
    if (!repetido) LC.UI.aviso(e.message, { tipo: 'erro', duracao: 12000 });
  }

  function aoMudarRemoto(m) {
    // Na tela só havia exemplos (nada salvo): outra pessoa começou o livro-caixa. Abre de novo com os valores dela.
    if (app.modoExemplo && !m.estado && app.armazenamento.modo === 'nuvem') { location.reload(); return; }
    if (m.estado) app.estado = Dd.sanear(m.estado);
    if (m.config) {
      const s = Dd.sanear({ ...m.config, lancamentos: app.estado.lancamentos });
      app.estado.pessoas = s.pessoas;
      app.estado.categorias = s.categorias;
      app.estado.graficos = s.graficos;
      app.estado.lancamentos = s.lancamentos;
    }
    if (m.meses) {
      const trocados = new Set(m.meses.keys());
      const novos = [...m.meses.values()].filter(Boolean).flat().map(Dd.normalizarLancamento);
      app.estado.lancamentos = [...app.estado.lancamentos.filter((t) => !trocados.has(t.data.slice(0, 7))), ...novos];
    }
    app.modoExemplo = false;
    render();
  }

  function excluir(ids) {
    const conjunto = new Set(ids);
    const removidos = app.estado.lancamentos.filter((t) => conjunto.has(t.id));
    if (!removidos.length) return;
    alterar((e) => { e.lancamentos = e.lancamentos.filter((t) => !conjunto.has(t.id)); });
    LC.UI.aviso(removidos.length === 1 ? 'Lançamento excluído.' : `${removidos.length} lançamentos excluídos.`, {
      acao: { rotulo: 'Desfazer', fn: () => alterar((e) => { e.lancamentos.push(...removidos); }) },
    });
  }

  // ── Casca: navegação, filtros e topo ─────────────────────────────────────

  const ui = {};

  function montarCasca() {
    ui.titulo = $('#titulo-vista');
    ui.subtitulo = $('#subtitulo-vista');
    ui.filtros = $('#filtros');
    ui.faixa = $('#faixa');
    ui.status = $('#status-salvamento');

    for (const b of document.querySelectorAll('[data-vista]')) {
      b.addEventListener('click', () => irPara(b.dataset.vista));
    }
    window.addEventListener('hashchange', () => {
      const v = location.hash.slice(1);
      if (VISTAS[v] && v !== app.prefs.vista) irPara(v, { semHash: true });
    });

    ui.periodo = LC.UI.selecao('f-periodo', Object.entries(Dd.PERIODOS), app.prefs.periodo, (v) => {
      const extra = {};
      if (v === 'personalizado' && !(D.valida(app.prefs.de) && D.valida(app.prefs.ate))) {
        const f = filtro();
        extra.de = f.inicio; extra.ate = f.fim;
      }
      salvarPrefs({ periodo: v, ...extra });
      render();
    }, { 'aria-label': 'Período' });
    ui.de = el('input', { id: 'f-de', type: 'date', class: 'entrada', 'aria-label': 'Data inicial' });
    ui.ate = el('input', { id: 'f-ate', type: 'date', class: 'entrada', 'aria-label': 'Data final' });
    for (const [campo, entrada] of [['de', ui.de], ['ate', ui.ate]]) {
      entrada.addEventListener('change', () => { if (D.valida(entrada.value)) { salvarPrefs({ [campo]: entrada.value }); render(); } });
    }
    ui.intervalo = el('span', { class: 'filtro-intervalo' });
    ui.pessoa = el('select', { id: 'f-pessoa', class: 'entrada', 'aria-label': 'Pessoa' });
    ui.pessoa.addEventListener('change', () => { salvarPrefs({ pessoa: ui.pessoa.value }); render(); });
    ui.situacao = LC.UI.selecao('f-situacao', [['todas', 'Pagos e pendentes'], ['pago', 'Só pagos e recebidos'], ['pendente', 'Só pendentes']], app.prefs.situacao,
      (v) => { salvarPrefs({ situacao: v }); render(); }, { 'aria-label': 'Situação' });
    ui.personalizado = el('span', { class: 'filtro-personalizado' }, ui.de, el('span', { class: 'apagado', text: 'até' }), ui.ate);
    ui.filtros.append(
      el('div', { class: 'filtro' }, icone('calendario', 'ico ico-filtro'), ui.periodo), ui.personalizado, ui.intervalo,
      el('div', { class: 'filtro' }, icone('pessoas', 'ico ico-filtro'), ui.pessoa),
      el('div', { class: 'filtro' }, icone('filtro', 'ico ico-filtro'), ui.situacao));

    $('#acao-importar').addEventListener('click', () => abrirImportacao());
    $('#acao-exportar').addEventListener('click', (e) => menuExportar(e.currentTarget));
    $('#acao-novo').addEventListener('click', () => abrirFormulario());

    const tema = $('#acao-tema');
    if (window.claude) tema.hidden = true; // no Claude o tema segue o do visitante
    else {
      tema.hidden = false;
      tema.addEventListener('click', () => {
        const ordem = ['sistema', 'claro', 'escuro'];
        salvarPrefs({ tema: ordem[(ordem.indexOf(app.prefs.tema) + 1) % 3] });
        aplicarTema();
      });
    }

    document.addEventListener('keydown', (e) => {
      const alvo = e.target;
      const digitando = alvo.closest && alvo.closest('input, textarea, select, [contenteditable], dialog, .grade');
      if (e.defaultPrevented || digitando || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); abrirFormulario(); }
      else if (e.key === '/' && app.prefs.vista === 'lancamentos' && app.planilha) { e.preventDefault(); app.planilha.focarBusca(); }
    });

    G.aoMudarTema(() => { if (app.estado) render(); });
    window.addEventListener('pagehide', () => { if (salvarDepois.pendente()) salvarDepois.agora(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && salvarDepois.pendente()) salvarDepois.agora();
    });
  }

  function aplicarTema() {
    if (window.claude) return;
    const t = app.prefs.tema;
    if (t === 'claro') document.documentElement.setAttribute('data-theme', 'light');
    else if (t === 'escuro') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    const b = $('#acao-tema');
    if (!b) return;
    const nome = { sistema: 'Tema do sistema', claro: 'Tema claro', escuro: 'Tema escuro' }[t];
    esvaziar(b).append(icone(t === 'claro' ? 'sol' : t === 'escuro' ? 'lua' : 'monitor'), el('span', { class: 'trilho-rotulo', text: nome }));
    b.title = nome + ' (clique para trocar)';
  }

  function irPara(vista, { semHash = false } = {}) {
    if (!VISTAS[vista]) vista = 'painel';
    salvarPrefs({ vista });
    if (!semHash && location.hash.slice(1) !== vista) history.replaceState(null, '', '#' + vista);
    render();
    window.scrollTo({ top: 0 });
  }

  function rotuloPeriodo(f) {
    if (app.prefs.periodo === 'personalizado') return `${fmt.data(f.inicio)} a ${fmt.data(f.fim)}`;
    return Dd.PERIODOS[app.prefs.periodo] || 'Período';
  }

  function renderTopo() {
    const v = app.prefs.vista;
    const est = app.estado;
    const f = filtro();
    ui.titulo.textContent = VISTAS[v].titulo;
    for (const b of document.querySelectorAll('[data-vista]')) {
      if (b.dataset.vista === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    document.title = `${VISTAS[v].titulo} · Livro-Caixa`;
    const comFiltros = v === 'painel' || v === 'lancamentos';
    ui.filtros.hidden = !comFiltros;
    if (comFiltros) {
      ui.periodo.value = app.prefs.periodo;
      ui.personalizado.hidden = app.prefs.periodo !== 'personalizado';
      ui.de.value = app.prefs.periodo === 'personalizado' ? f.inicio : '';
      ui.ate.value = app.prefs.periodo === 'personalizado' ? f.fim : '';
      ui.intervalo.textContent = app.prefs.periodo === 'personalizado' ? '' : `${fmt.data(f.inicio)} a ${fmt.data(f.fim)}`;
      esvaziar(ui.pessoa).append(el('option', { value: 'todas' }, 'Todas as pessoas'), ...est.pessoas.map((p) => el('option', { value: p.id }, p.nome)));
      if (!est.pessoas.some((p) => p.id === app.prefs.pessoa)) app.prefs.pessoa = 'todas';
      ui.pessoa.value = app.prefs.pessoa;
      ui.situacao.value = app.prefs.situacao;
    }
    const n = Dd.filtrar(est, f).length;
    ui.subtitulo.textContent = {
      painel: `${rotuloPeriodo(f)} · ${plural(n, 'lançamento', 'lançamentos')}`,
      mensal: 'Um mês por linha e uma categoria por coluna, como as abas da planilha Gastos',
      lancamentos: `Cada gasto e recebimento, um por linha · ${rotuloPeriodo(f).toLowerCase()}`,
      orcamento: 'Quanto cada categoria pode gastar por mês, e quanto já foi',
      cadastros: 'Pessoas, categorias, exportação e backup',
    }[v];
  }

  function renderStatus() {
    if (!ui.status || !app.armazenamento) return;
    const s = app.salvamento;
    const nuvem = app.armazenamento.modo === 'nuvem';
    const firebase = app.armazenamento.provedor === 'firebase';
    const semInternet = firebase && navigator.onLine === false;
    let texto, classe;
    if (app.modoExemplo) { texto = 'Exemplo: nada salvo ainda'; classe = 'neutro'; }
    else if (s === 'erro') { texto = 'Não salvo'; classe = 'erro'; }
    else if (semInternet) { texto = 'Sem internet'; classe = 'salvando'; }
    else if (s === 'salvando' || s === 'pendente') { texto = 'Salvando…'; classe = 'salvando'; }
    else { texto = nuvem ? 'Salvo na nuvem' : 'Salvo neste navegador'; classe = 'ok'; }
    ui.status.className = 'status-salvamento status-' + classe;
    ui.status.title = s === 'erro' ? app.erroSalvar
      : semInternet ? 'Sem internet: o que você muda fica guardado neste aparelho e vai para a nuvem quando a internet voltar.'
        : firebase ? `Salvo no livro-caixa compartilhado, aberto com ${app.armazenamento.sessao.usuario.email}. Aparece em todos os aparelhos de quem usa.`
          : nuvem ? 'Salvo no armazenamento deste artefato do Claude (privado: dono e editores).' : 'Salvo no armazenamento deste navegador. Faça backups em Cadastros.';
    esvaziar(ui.status).append(el('span', { class: 'trilho-rotulo', text: texto }));
  }

  function renderFaixa() {
    esvaziar(ui.faixa);
    const exemplos = app.estado.lancamentos.filter((t) => t.exemplo).length;
    const leitor = app.armazenamento && app.armazenamento.motivo === 'leitor';
    if (leitor) {
      ui.faixa.append(el('div', { class: 'faixa faixa-info' }, icone('info'),
        el('p', null, el('strong', { text: 'Você está vendo como leitor. ' }), 'O livro-caixa do dono é privado; o que você lançar aqui fica só neste navegador.')));
    }
    if (exemplos) {
      ui.faixa.append(el('div', { class: 'faixa faixa-exemplo' }, icone('info'),
        el('p', null, el('strong', { text: 'Valores de exemplo, nas colunas da sua planilha. ' }),
          app.modoExemplo ? 'Para ver os seus números, importe o seu Gastos.xlsx (ou comece do zero e digite na planilha mensal).'
            : `${plural(exemplos, 'lançamento de exemplo continua', 'lançamentos de exemplo continuam')} no livro. Apague quando terminar de testar.`),
        el('div', { class: 'faixa-acoes' },
          el('button', { type: 'button', class: 'botao botao-pequeno botao-primario', onclick: () => abrirImportacao() }, icone('importar'), 'Importar minha planilha'),
          el('button', { type: 'button', class: 'botao botao-pequeno', onclick: apagarExemplos }, 'Começar do zero'))));
    }
  }

  async function apagarExemplos() {
    const ok = await LC.UI.confirmar({
      titulo: 'Apagar os valores de exemplo?',
      texto: 'Os valores e orçamentos de exemplo saem do livro. Pessoas, colunas da planilha, categorias e gráficos continuam, prontos para você digitar os seus.',
      botao: 'Apagar exemplos', perigo: true,
    });
    if (!ok) return;
    alterar((e) => {
      Dd.limparExemplos(e);
      for (const p of e.pessoas) p.saldoInicial = 0;
    });
    LC.UI.aviso('Pronto. Digite os valores do mês na planilha mensal ou importe o seu Excel.', { tipo: 'ok' });
    irPara('mensal');
  }

  // ── Render geral ─────────────────────────────────────────────────────────

  function render() {
    if (!app.estado) return;
    const v = app.prefs.vista;
    renderTopo();
    renderFaixa();
    renderStatus();
    for (const nome of Object.keys(VISTAS)) $('#vista-' + nome).hidden = nome !== v;
    if (v !== 'painel') for (const c of app.cartoes.values()) c.destruir();
    if (v !== 'mensal' && app.mensal) app.mensal.destruir();
    if (v === 'painel') renderPainel();
    else if (v === 'mensal') app.mensal.render();
    else if (v === 'lancamentos') app.planilha.render();
    else if (v === 'orcamento') renderOrcamento();
    else renderCadastros();
  }

  // ── Painel ───────────────────────────────────────────────────────────────

  function rotuloComparacao() {
    const p = app.prefs.periodo;
    if (p === 'mes' || p === 'mes-anterior') return 'vs. mês anterior';
    if (p === 'ano' || p === 'ano-anterior') return 'vs. ano anterior';
    if (/^\d+m$/.test(p)) return `vs. ${parseInt(p, 10)} meses anteriores`;
    return 'vs. período anterior';
  }

  function minilinha(valores) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 30');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'minilinha');
    svg.setAttribute('aria-hidden', 'true');
    const v = valores.map((x) => (x == null ? null : x));
    const nums = v.filter((x) => x != null);
    if (nums.length < 2) return svg;
    const min = Math.min(...nums), max = Math.max(...nums);
    const y = (x) => (max === min ? 15 : 27 - ((x - min) / (max - min)) * 24);
    const passo = 100 / (v.length - 1);
    let d = '', fim = null;
    v.forEach((x, i) => {
      if (x == null) return;
      d += `${d && v[i - 1] != null ? 'L' : 'M'}${(i * passo).toFixed(1)},${y(x).toFixed(1)}`;
      fim = [i * passo, y(x)];
    });
    const caminho = document.createElementNS(ns, 'path');
    caminho.setAttribute('d', d);
    caminho.setAttribute('class', 'minilinha-traco');
    caminho.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(caminho);
    if (min < 0 && max > 0) {
      const zero = document.createElementNS(ns, 'line');
      zero.setAttribute('x1', '0'); zero.setAttribute('x2', '100');
      zero.setAttribute('y1', y(0).toFixed(1)); zero.setAttribute('y2', y(0).toFixed(1));
      zero.setAttribute('class', 'minilinha-zero');
      zero.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.prepend(zero);
    }
    if (fim) {
      const ponto = document.createElementNS(ns, 'circle');
      ponto.setAttribute('cx', fim[0].toFixed(1)); ponto.setAttribute('cy', fim[1].toFixed(1)); ponto.setAttribute('r', '2.6');
      ponto.setAttribute('class', 'minilinha-ponto');
      svg.append(ponto);
    }
    return svg;
  }

  function indicador({ rotulo, valor, atual, anterior, bomSobe, serie, pct = false }) {
    let delta = null;
    if (anterior != null && atual != null) {
      if (pct) {
        const d = (atual - anterior) * 100;
        delta = { texto: `${d > 0 ? '+' : d < 0 ? '−' : ''}${fmt.numero(Math.abs(Math.round(d * 10) / 10))} p.p.`, sobe: d > 0.05, desce: d < -0.05 };
      } else if (anterior !== 0) {
        const d = (atual - anterior) / Math.abs(anterior);
        delta = { texto: `${d > 0 ? '+' : d < 0 ? '−' : ''}${fmt.pct(Math.abs(d))}`, sobe: d > 0.005, desce: d < -0.005 };
      }
    }
    let classe = 'neutro';
    if (delta && (delta.sobe || delta.desce)) classe = delta.sobe === bomSobe ? 'bom' : 'ruim';
    return el('div', { class: 'cartao indicador' },
      el('p', { class: 'indicador-rotulo', text: rotulo }),
      el('p', { class: 'indicador-valor', text: valor }),
      el('div', { class: 'indicador-rodape' },
        delta ? el('p', { class: 'delta delta-' + classe },
          delta.sobe || delta.desce ? icone(delta.sobe ? 'seta-cima' : 'seta-baixo', 'ico ico-mini') : null,
          el('strong', { text: delta.texto }), el('span', { text: ' ' + rotuloComparacao() }))
          : el('p', { class: 'delta delta-neutro', text: 'sem período anterior para comparar' }),
        minilinha(serie)));
  }

  function medidor(u, classe, rotulo = 'Uso') {
    const pct = Math.max(0, Math.min(1, u)) * 100;
    return el('div', { class: `medidor medidor-${classe}`, role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(u * 100)), 'aria-label': rotulo },
      el('span', { class: 'medidor-preenchido', style: { width: pct + '%' } }));
  }

  const classeUso = (u) => (u > 1 ? 'critico' : u >= 0.9 ? 'atencao' : 'bom');

  function renderPainel() {
    const est = app.estado;
    const f = filtro();
    const raiz = $('#vista-painel');
    const topo = $('#painel-topo', raiz);
    esvaziar(topo);

    // Herói: o saldo de hoje (quanto cada um tem), quanto sobra depois do que está agendado no mês,
    // e o "Total restante" do mês, como na aba Total finanças.
    const mesAtual = D.mes(hoje());
    const r = Dd.resumoMes(est, mesAtual, f.pessoa);
    const anoAtual = mesAtual.slice(0, 4);
    const guardado = LC.arred(D.meses(`${anoAtual}-01`, mesAtual).reduce((s, m) => s + Dd.resumoMes(est, m, f.pessoa).restante, 0));
    const saldos = Dd.saldosPessoas(est, hoje()); // saldo inicial + o que entrou − o que saiu (só o que já foi pago)
    const fimMes = `${mesAtual}-31`; // serve para qualquer mês: as datas se comparam como texto
    const depois = Dd.saldosPessoas(est, fimMes, { soPagos: false }); // contando também o agendado até o fim do mês
    const doFiltro = (p) => f.pessoa === 'todas' || p.id === f.pessoa;
    const soma = (m) => LC.arred(est.pessoas.filter(doFiltro).reduce((s, p) => s + (m.get(p.id) || 0), 0));
    const saldoTotal = soma(saldos);
    const saldoDepois = soma(depois);
    const lista = el('ul', { class: 'heroi-contas' });
    for (const x of Dd.resumoMes(est, mesAtual).pessoas) {
      const ativa = f.pessoa === x.pessoa.id;
      const saldo = saldos.get(x.pessoa.id) || 0;
      const uso = x.receitas > 0 ? x.despesas / x.receitas : x.despesas > 0 ? 2 : 0;
      lista.append(el('li', null, el('button', {
        type: 'button', class: 'heroi-conta' + (ativa ? ' ativa' : ''), 'aria-pressed': ativa ? 'true' : 'false',
        title: ativa ? 'Voltar para todas as pessoas' : `Ver o painel só de ${x.pessoa.nome}`,
        onclick: () => { salvarPrefs({ pessoa: ativa ? 'todas' : x.pessoa.id }); render(); },
      },
      el('span', { class: 'heroi-conta-linha' },
        el('span', { class: 'ponto', style: { background: LC.cor(x.pessoa.cor) } }),
        el('span', { class: 'heroi-conta-nome', text: x.pessoa.nome }),
        el('span', { class: 'heroi-conta-valor' + (saldo < 0 ? ' negativo' : ''), text: fmt.moeda(saldo) })),
      el('span', { class: 'heroi-conta-uso' },
        medidor(uso, classeUso(uso), `Quanto ${x.pessoa.nome} gastou do que recebeu em ${nomeMes(mesAtual)}`),
        el('span', { class: 'apagado', text: x.receitas ? `gastou ${fmt.pct(x.despesas / x.receitas)} do que recebeu` : x.despesas ? `gastou ${fmt.moeda(x.despesas)} sem recebimento lançado` : 'nada lançado no mês' })),
      el('span', { class: 'heroi-conta-saldo' }, `Restante de ${nomeMes(mesAtual)} `,
        el('strong', { class: x.restante < 0 ? 'negativo' : '', text: fmt.moeda(x.restante) })))));
    }
    const nomePessoa = f.pessoa !== 'todas' ? est.pessoas.find((p) => p.id === f.pessoa)?.nome : null;
    topo.append(el('section', { class: 'cartao heroi', 'aria-labelledby': 'heroi-rotulo' },
      el('p', { id: 'heroi-rotulo', class: 'heroi-rotulo', text: nomePessoa ? `Saldo de ${nomePessoa} hoje` : 'Saldo de todos hoje' }),
      el('p', { class: 'heroi-valor' + (saldoTotal < 0 ? ' negativo' : ''), text: fmt.moeda(saldoTotal) }),
      el('p', { class: 'heroi-previsto' },
        saldoDepois !== saldoTotal
          ? ['Depois do que está agendado em ', nomeMes(mesAtual), ': ', el('strong', { class: saldoDepois < 0 ? 'negativo' : '', text: fmt.moeda(saldoDepois) })]
          : 'Acerte o saldo de cada pessoa em Cadastros → Pessoas.'),
      lista,
      el('p', { class: 'heroi-guardado' },
        `Restante de ${nomeMes(mesAtual)}: `, el('strong', { class: r.restante < 0 ? 'negativo' : '', text: fmt.moeda(r.restante) }),
        el('span', { class: 'apagado', text: ` (recebido ${fmt.moeda(r.receitas)}, gasto ${fmt.moeda(r.despesas)})` }),
        el('br'), `Guardado em ${anoAtual} até agora: `, el('strong', { class: guardado < 0 ? 'negativo' : '', text: fmt.moeda(guardado) }))));

    // Indicadores do período
    const atual = Dd.totais(Dd.filtrar(est, f));
    const pAnt = Dd.periodoAnterior(f, app.prefs);
    const ant = pAnt ? Dd.totais(Dd.filtrar(est, pAnt)) : null;
    const serie = Dd.serieMensal(est, f, D.mes(f.fim), 12);
    topo.append(el('div', { class: 'indicadores' },
      indicador({ rotulo: 'Total recebido', valor: fmt.moeda(atual.receitas), atual: atual.receitas, anterior: ant?.receitas, bomSobe: true, serie: serie.map((s) => s.receitas) }),
      indicador({ rotulo: 'Total gasto', valor: fmt.moeda(atual.despesas), atual: atual.despesas, anterior: ant?.despesas, bomSobe: false, serie: serie.map((s) => s.despesas) }),
      indicador({ rotulo: 'Total restante', valor: fmt.moeda(atual.resultado), atual: atual.resultado, anterior: ant?.resultado, bomSobe: true, serie: serie.map((s) => s.resultado) }),
      indicador({ rotulo: '% guardado', valor: atual.poupanca == null ? '—' : fmt.pct(atual.poupanca), atual: atual.poupanca, anterior: ant?.poupanca, bomSobe: true, pct: true, serie: serie.map((s) => s.poupanca) })),
    renderPendencias(f));

    renderGraficos($('#painel-graficos', raiz), f);
  }

  function renderPendencias(f) {
    const est = app.estado;
    const lista = Dd.pendencias(est, hoje(), f.pessoa);
    const vencidos = lista.filter((t) => t.vencido);
    const proximos = lista.filter((t) => !t.vencido && t.dias <= 31);
    const aPagar = LC.arred([...vencidos, ...proximos].filter((t) => t.tipo === 'despesa').reduce((s, t) => s + t.valor, 0));
    const aReceber = LC.arred(proximos.filter((t) => t.tipo === 'receita').reduce((s, t) => s + t.valor, 0));
    const cats = Dd.mapaPorId(est.categorias), pessoas = Dd.mapaPorId(est.pessoas);
    const corpo = el('ul', { class: 'pendencias' });
    for (const t of [...vencidos, ...proximos].slice(0, 6)) {
      const quando = t.vencido ? `venceu há ${plural(-t.dias, 'dia', 'dias')}` : t.dias === 0 ? 'vence hoje' : t.dias === 1 ? 'vence amanhã' : `em ${t.dias} dias`;
      const cat = cats.get(t.categoria);
      corpo.append(el('li', { class: 'pendencia' + (t.vencido ? ' vencida' : '') },
        el('div', { class: 'pendencia-data' }, el('strong', { text: t.data.slice(8, 10) }), el('span', { text: fmt.mes(D.mes(t.data)).split('/')[0] })),
        el('div', { class: 'pendencia-info' },
          el('span', { class: 'pendencia-desc', text: t.descricao || 'Sem descrição' }),
          el('span', { class: 'pendencia-meta' }, el('span', { class: 'ponto', style: { background: LC.cor(cat?.cor) } }), el('span', { text: `${cat?.nome || ''} · ${pessoas.get(t.pessoa)?.nome || ''}` }),
            el('span', { class: 'pendencia-quando' + (t.vencido ? ' vencida' : ''), text: ' · ' + quando }))),
        el('span', { class: 'pendencia-valor valor-' + t.tipo, text: (t.tipo === 'receita' ? '+' : '−') + fmt.moeda(t.valor) }),
        el('button', {
          type: 'button', class: 'botao botao-pequeno', title: t.tipo === 'receita' ? 'Marcar como recebido' : 'Marcar como pago',
          onclick: () => {
            alterar((e) => { const x = e.lancamentos.find((y) => y.id === t.id); if (x) x.situacao = 'pago'; });
            LC.UI.aviso(`${t.descricao || 'Lançamento'} ${t.tipo === 'receita' ? 'recebido' : 'pago'}.`, {
              tipo: 'ok', acao: { rotulo: 'Desfazer', fn: () => alterar((e) => { const x = e.lancamentos.find((y) => y.id === t.id); if (x) x.situacao = 'pendente'; }) },
            });
          },
        }, icone('check'), t.tipo === 'receita' ? 'Receber' : 'Pagar')));
    }
    const vazio = !corpo.children.length;
    return el('section', { class: 'cartao pendencias-cartao', 'aria-labelledby': 'pend-titulo' },
      el('header', { class: 'cartao-cabeca' },
        el('div', null,
          el('h2', { id: 'pend-titulo', class: 'cartao-titulo', text: 'Contas a pagar e a receber' }),
          el('p', { class: 'cartao-sub' }, vazio ? 'Nada pendente no próximo mês.'
            : [`${fmt.moeda(aPagar)} a pagar`, aReceber ? ` · ${fmt.moeda(aReceber)} a receber` : '', ' no próximo mês',
              vencidos.length ? el('span', { class: 'texto-critico', text: ` · ${plural(vencidos.length, 'vencida', 'vencidas')}` }) : null])),
        el('button', {
          type: 'button', class: 'botao botao-pequeno botao-fantasma',
          onclick: () => { salvarPrefs({ situacao: 'pendente', periodo: 'tudo' }); irPara('lancamentos'); },
        }, 'Ver todas', icone('chevron-dir', 'ico ico-mini'))),
      vazio ? el('p', { class: 'pendencias-vazio' }, icone('check', 'ico'), 'Tudo em dia.') : corpo);
  }

  let arrastando = null;
  // Redesenha sem a página pular: o painel é refeito e, por um instante, fica mais curto.
  function renderParado() {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  function renderGraficos(grade, f) {
    const est = app.estado;
    if (!grade.dataset.pronto) {
      grade.dataset.pronto = '1';
      grade.addEventListener('dragstart', (e) => { arrastando = e.target.closest('.cg'); });
      grade.addEventListener('dragover', (e) => {
        if (!arrastando) return;
        e.preventDefault();
        const alvo = e.target.closest('.cg');
        if (!alvo || alvo === arrastando) return;
        const rr = alvo.getBoundingClientRect();
        const depois = alvo.dataset.largura === '2' ? e.clientY > rr.top + rr.height / 2 : e.clientX > rr.left + rr.width / 2;
        grade.insertBefore(arrastando, depois ? alvo.nextSibling : alvo);
      });
      grade.addEventListener('drop', (e) => e.preventDefault());
      grade.addEventListener('dragend', () => {
        if (!arrastando) return;
        arrastando = null;
        const ordem = [...grade.querySelectorAll('.cg')].map((n) => n.dataset.id);
        if (ordem.join() !== app.estado.graficos.map((g) => g.id).join()) {
          alterar((e2) => { e2.graficos.sort((a, b) => ordem.indexOf(a.id) - ordem.indexOf(b.id)); });
        } else render();
      });
    }
    const ids = new Set(est.graficos.map((g) => g.id));
    for (const [id, c] of app.cartoes) {
      if (!ids.has(id)) { c.destruir(); c.el.remove(); app.cartoes.delete(id); }
    }
    const rotulo = rotuloPeriodo(f);
    for (const g of est.graficos) {
      let c = app.cartoes.get(g.id);
      if (!c) { c = G.criarCartao(g, acoesCartao); app.cartoes.set(g.id, c); }
      grade.append(c.el);
      // Gráfico por grupo: clicar num grupo mostra as categorias dele no mesmo cartão.
      const aberto = g.agrupar === 'grupo' ? app.gruposAbertos.get(g.id) : undefined;
      if (aberto !== undefined) {
        const doGrupo = est.categorias.filter((x) => x.tipo === 'despesa' && (x.grupo || '') === aberto && (!g.categorias.length || g.categorias.includes(x.id))).map((x) => x.id);
        const vista = { ...g, agrupar: 'categoria', dividir: 'nenhum', categorias: doGrupo.length ? doGrupo : ['-'], corPorItem: true };
        const fechar = () => { app.gruposAbertos.delete(g.id); renderParado(); };
        c.atualizar(vista, Dd.dadosGrafico(vista, est, f, hoje()), `${aberto || 'Sem grupo'}: ${plural(doGrupo.length, 'categoria', 'categorias')} · ${rotulo}`,
          { voltar: { rotulo: 'Todos os grupos', fn: fechar } });
      } else {
        c.atualizar(g, Dd.dadosGrafico(g, est, f, hoje()), `${G.descrever(g, est)} · ${rotulo}${g.agrupar === 'grupo' ? ' · clique num grupo para abrir' : ''}`,
          g.agrupar === 'grupo' && g.dividir === 'nenhum' ? { aoClicar: (chave) => { app.gruposAbertos.set(g.id, chave); renderParado(); } } : {});
      }
    }
    let novo = $('#adicionar-grafico', grade);
    if (!novo) {
      novo = el('button', { id: 'adicionar-grafico', type: 'button', class: 'cartao cg-novo', onclick: novoGrafico },
        icone('adicionar', 'ico ico-grande'), el('strong', { text: 'Adicionar gráfico' }),
        el('span', { text: 'Escolha um modelo ou monte o seu: tipo, dados, pessoas, cores e tamanho.' }));
    }
    grade.append(novo);
  }

  const acoesCartao = {
    editar(id) {
      const cfg = app.estado.graficos.find((g) => g.id === id);
      if (!cfg) return;
      G.abrirEditor({
        cfg, novo: false, estado: app.estado,
        obterDados: (c) => Dd.dadosGrafico(c, app.estado, filtro(), hoje()),
        aoSalvar: (nova) => { alterar((e) => { const i = e.graficos.findIndex((g) => g.id === id); if (i >= 0) e.graficos[i] = nova; }); LC.UI.aviso('Gráfico salvo.', { tipo: 'ok' }); },
        aoExcluir: (gid) => excluirGrafico(gid),
      });
    },
    duplicar(id) {
      const i = app.estado.graficos.findIndex((g) => g.id === id);
      if (i < 0) return;
      const copia = { ...Dd.clonar(app.estado.graficos[i]), id: LC.novoId('g'), titulo: app.estado.graficos[i].titulo + ' (cópia)' };
      alterar((e) => { e.graficos.splice(i + 1, 0, copia); });
      LC.UI.aviso('Gráfico duplicado. Clique no lápis para mudar a cópia.', { tipo: 'ok' });
    },
    async png(id) {
      const c = app.cartoes.get(id);
      const chart = c && c.grafico();
      if (!chart) return;
      const cfg = c.config();
      const blob = await G.imagemPNG(chart, cfg.titulo, `${G.descrever(cfg, app.estado)} · ${rotuloPeriodo(filtro())}`);
      try { await S.baixar(`${nomeArquivo(cfg.titulo)}.png`, blob, 'image/png'); } catch (e) { LC.UI.aviso(e.message, { tipo: 'erro' }); }
    },
    mover(id, delta) {
      const i = app.estado.graficos.findIndex((g) => g.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= app.estado.graficos.length) return;
      alterar((e) => { const [g] = e.graficos.splice(i, 1); e.graficos.splice(j, 0, g); });
      const alca = app.cartoes.get(id)?.el.querySelector('.cg-alca');
      if (alca) alca.focus();
    },
    excluir(id) { excluirGrafico(id); },
  };

  async function excluirGrafico(id) {
    const i = app.estado.graficos.findIndex((g) => g.id === id);
    if (i < 0) return false;
    const g = app.estado.graficos[i];
    const ok = await LC.UI.confirmar({ titulo: `Excluir “${g.titulo}”?`, texto: 'O gráfico sai do painel. Os valores não mudam.', botao: 'Excluir gráfico', perigo: true });
    if (!ok) return false;
    alterar((e) => { e.graficos.splice(i, 1); });
    LC.UI.aviso('Gráfico excluído.', { acao: { rotulo: 'Desfazer', fn: () => alterar((e) => { e.graficos.splice(Math.min(i, e.graficos.length), 0, g); }) } });
    return true;
  }

  function novoGrafico() {
    const base = Dd.normalizarGrafico({ ...G.MODELOS[0], id: LC.novoId('g') });
    G.abrirEditor({
      cfg: base, novo: true, estado: app.estado,
      obterDados: (c) => Dd.dadosGrafico(c, app.estado, filtro(), hoje()),
      aoSalvar: (nova) => {
        alterar((e) => { e.graficos.push(nova); });
        LC.UI.aviso('Gráfico adicionado ao fim do painel.', { tipo: 'ok' });
        requestAnimationFrame(() => app.cartoes.get(nova.id)?.el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      },
      aoExcluir: async () => true,
    });
  }

  // ── Orçamento ────────────────────────────────────────────────────────────

  function renderOrcamento() {
    const est = app.estado;
    const raiz = esvaziar($('#vista-orcamento'));
    const mesAtual = D.mes(hoje());
    const mes = /^\d{4}-\d{2}$/.test(app.prefs.mesOrcamento || '') ? app.prefs.mesOrcamento : mesAtual;
    const inicio = D.inicioDoMes(mes), fim = D.fimDoMes(mes);
    const despesas = est.lancamentos.filter((t) => t.tipo === 'despesa' && t.data >= inicio && t.data <= fim);
    const porCat = new Map();
    for (const t of despesas) {
      const r = porCat.get(t.categoria) || { gasto: 0, pendente: 0 };
      r.gasto += t.valor;
      if (t.situacao === 'pendente') r.pendente += t.valor;
      porCat.set(t.categoria, r);
    }
    const linhas = est.categorias.filter((c) => c.tipo === 'despesa').map((c) => ({ c, gasto: LC.arred(porCat.get(c.id)?.gasto || 0), pendente: LC.arred(porCat.get(c.id)?.pendente || 0) }))
      .sort((a, b) => (b.c.orcamento > 0) - (a.c.orcamento > 0) || b.gasto - a.gasto);
    const comOrcamento = linhas.filter((l) => l.c.orcamento > 0);
    const orcado = LC.arred(comOrcamento.reduce((s, l) => s + l.c.orcamento, 0));
    const gastoOrcado = LC.arred(comOrcamento.reduce((s, l) => s + l.gasto, 0));
    const gastoTotal = LC.arred(linhas.reduce((s, l) => s + l.gasto, 0));
    const disponivel = LC.arred(orcado - gastoOrcado);
    const usado = orcado > 0 ? gastoOrcado / orcado : 0;

    const ir = (m) => { salvarPrefs({ mesOrcamento: m }); render(); };
    raiz.append(el('div', { class: 'orc-navegacao' },
      el('button', { type: 'button', class: 'botao-icone', 'aria-label': 'Mês anterior', title: 'Mês anterior', onclick: () => ir(D.somaMeses(mes, -1)) }, icone('chevron-esq')),
      el('h2', { class: 'orc-mes', text: fmt.mesLongo(mes) }),
      el('button', { type: 'button', class: 'botao-icone', 'aria-label': 'Próximo mês', title: 'Próximo mês', onclick: () => ir(D.somaMeses(mes, 1)) }, icone('chevron-dir')),
      mes !== mesAtual ? el('button', { type: 'button', class: 'botao botao-pequeno botao-fantasma', onclick: () => ir(mesAtual) }, 'Ir para o mês atual') : null));

    const estado = (u) => (u > 1 ? { classe: 'critico', rotulo: 'Estourou', icone: 'alerta' } : u >= 0.8 ? { classe: 'atencao', rotulo: 'Atenção', icone: 'relogio' } : { classe: 'bom', rotulo: 'No limite', icone: 'check' });
    if (!comOrcamento.length) {
      raiz.append(el('div', { class: 'faixa' }, icone('info'),
        el('p', null, el('strong', { text: 'Nenhuma categoria tem orçamento ainda. ' }), 'Digite na coluna "Orçamento mensal" quanto cada categoria pode gastar por mês (por exemplo, Comida: 600). O sistema mostra quanto já foi usado e avisa quando passar de 80%.')));
    } else {
      const geral = estado(usado);
      let ritmo = null;
      if (mes === mesAtual) {
        const restantes = D.diferencaDias(hoje(), fim) + 1;
        ritmo = disponivel > 0
          ? `Faltam ${plural(restantes, 'dia', 'dias')}: dá para gastar até ${fmt.moeda(disponivel / restantes)} por dia nas categorias com orçamento e fechar o mês dentro do combinado.`
          : `O orçamento do mês já foi ultrapassado em ${fmt.moeda(-disponivel)}.`;
      }
      raiz.append(el('section', { class: 'cartao orc-resumo' },
        el('div', { class: 'orc-numeros' },
          el('div', null, el('p', { class: 'indicador-rotulo', text: 'Orçado no mês' }), el('p', { class: 'orc-numero', text: fmt.moeda(orcado) })),
          el('div', null, el('p', { class: 'indicador-rotulo', text: 'Gasto (com agendados)' }), el('p', { class: 'orc-numero', text: fmt.moeda(gastoOrcado) })),
          el('div', null, el('p', { class: 'indicador-rotulo', text: 'Disponível' }), el('p', { class: 'orc-numero' + (disponivel < 0 ? ' negativo' : ''), text: fmt.moeda(disponivel) }))),
        el('div', { class: 'orc-geral' },
          medidor(usado, geral.classe, 'Uso do orçamento'),
          el('span', { class: `chip-status status-${geral.classe}` }, icone(geral.icone, 'ico ico-mini'), `${fmt.pct(usado)} usado · ${geral.rotulo}`)),
        ritmo ? el('p', { class: 'orc-ritmo', text: ritmo + (gastoTotal > gastoOrcado ? ` Categorias sem orçamento somam ${fmt.moeda(gastoTotal - gastoOrcado)} neste mês.` : '') }) : null));
    }

    const tabela = el('table', { class: 'tabela-orcamento' });
    tabela.append(el('thead', null, el('tr', null,
      el('th', { scope: 'col', text: 'Categoria' }), el('th', { scope: 'col', class: 'num', text: 'Orçamento mensal' }),
      el('th', { scope: 'col', class: 'num', text: 'Gasto' }), el('th', { scope: 'col', class: 'num', text: 'Disponível' }),
      el('th', { scope: 'col', class: 'c-medidor', text: 'Uso' }))));
    const corpo = el('tbody');
    for (const l of linhas) {
      const u = l.c.orcamento > 0 ? l.gasto / l.c.orcamento : l.gasto > 0 ? 2 : 0;
      const st = estado(u);
      const entrada = el('input', { class: 'entrada entrada-valor', type: 'text', inputmode: 'decimal', id: 'orc-' + l.c.id, value: l.c.orcamento ? fmt.numero(l.c.orcamento) : '', placeholder: 'sem orçamento', 'aria-label': 'Orçamento mensal de ' + l.c.nome, autocomplete: 'off' });
      entrada.addEventListener('change', () => {
        const n = entrada.value.trim() === '' ? 0 : LC.paraNumero(entrada.value);
        if (!Number.isFinite(n) || n < 0) { LC.UI.aviso('Digite um valor como 1.200,00 (ou deixe vazio para sem orçamento).', { tipo: 'erro' }); entrada.value = l.c.orcamento ? fmt.numero(l.c.orcamento) : ''; return; }
        alterar((e) => { const c = e.categorias.find((x) => x.id === l.c.id); if (c) c.orcamento = LC.arred(n); });
      });
      entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter') entrada.blur(); });
      const disp = LC.arred(l.c.orcamento - l.gasto);
      corpo.append(el('tr', null,
        el('th', { scope: 'row' }, el('span', { class: 'item-cor' }, el('span', { class: 'ponto', style: { background: LC.cor(l.c.cor) } }), el('span', { text: l.c.nome }))),
        el('td', { class: 'num' }, el('span', { class: 'entrada-prefixo' }, el('span', { text: 'R$' }), entrada)),
        el('td', { class: 'num' }, el('span', { class: 'tab-num', text: fmt.moeda(l.gasto) }), l.pendente ? el('span', { class: 'orc-pendente', text: `${fmt.moeda(l.pendente)} agendado` }) : null),
        el('td', { class: 'num' + (l.c.orcamento && disp < 0 ? ' negativo' : '') }, l.c.orcamento ? fmt.moeda(disp) : el('span', { class: 'apagado', text: '—' })),
        el('td', { class: 'c-medidor' }, l.c.orcamento
          ? el('div', { class: 'orc-uso' }, medidor(u, st.classe, 'Uso do orçamento de ' + l.c.nome), el('span', { class: `chip-status status-${st.classe}` }, icone(st.icone, 'ico ico-mini'), `${fmt.pct(u)} · ${st.rotulo}`))
          : el('span', { class: 'apagado', text: 'Sem orçamento' }))));
    }
    tabela.append(corpo, el('tfoot', null, el('tr', null, el('th', { scope: 'row', text: 'Total' }),
      el('td', { class: 'num', text: fmt.moeda(orcado) }), el('td', { class: 'num', text: fmt.moeda(gastoTotal) }),
      el('td', { class: 'num' + (disponivel < 0 ? ' negativo' : ''), text: orcado ? fmt.moeda(disponivel) : '—' }), el('td'))));
    raiz.append(el('section', { class: 'cartao' },
      el('header', { class: 'cartao-cabeca' }, el('div', null,
        el('h2', { class: 'cartao-titulo', text: 'Por categoria de gasto (as duas pessoas juntas)' }),
        el('p', { class: 'cartao-sub', text: 'O orçamento vale para todos os meses. Mude um valor e ele é salvo na hora.' }))),
      el('div', { class: 'rolagem-x' }, tabela)));
  }

  // ── Cadastros ────────────────────────────────────────────────────────────

  function renderCadastros() {
    const est = app.estado;
    const raiz = esvaziar($('#vista-cadastros'));
    const uso = new Map();
    for (const t of est.lancamentos) {
      uso.set(t.categoria, (uso.get(t.categoria) || 0) + 1);
      uso.set('p:' + t.pessoa, (uso.get('p:' + t.pessoa) || 0) + 1);
      if (t.destino) uso.set('p:' + t.destino, (uso.get('p:' + t.destino) || 0) + 1);
    }
    const tipo = app.prefs.abaCategorias === 'receita' ? 'receita' : 'despesa';

    const saldos = Dd.saldosPessoas(est, hoje());
    const listaPessoas = el('ul', { class: 'cadastro-lista' }, cabecalhoCadastro(['Nome', 'Saldo hoje', 'Colunas'], ' pessoa'));
    for (const p of est.pessoas) {
      listaPessoas.append(linhaCadastro({
        item: p, n: uso.get('p:' + p.id) || 0, rotulo: 'pessoa',
        valor: {
          campo: 'saldo-hoje', rotulo: 'Saldo hoje', dica: '0,00', negativo: true,
          ler: () => saldos.get(p.id) || 0,
          gravar: (v) => alterar((e) => Dd.ajustarSaldo(e, p.id, v, hoje())),
        },
        extra: el('button', {
          type: 'button', class: 'botao botao-pequeno botao-fantasma cadastro-colunas', title: `Abrir a planilha mensal de ${p.nome}`,
          onclick: () => { salvarPrefs({ abaMensal: p.id }); irPara('mensal'); },
        }, `${p.colunas.length} ${p.colunas.length === 1 ? 'coluna' : 'colunas'}`, icone('chevron-dir', 'ico ico-mini')),
        aoMudar: (fn) => alterar((e) => { const x = e.pessoas.find((y) => y.id === p.id); if (x) fn(x); }),
        aoExcluir: () => excluirPessoa(p.id),
      }));
    }
    const novaPessoa = () => {
      const p = { id: LC.novoId('p'), nome: 'Nova pessoa', cor: Dd.proximaCor(est.pessoas), saldoInicial: 0, colunas: est.categorias.some((c) => c.id === 'salario') ? ['salario'] : [] };
      alterar((e) => { e.pessoas.push(p); });
      requestAnimationFrame(() => { const i = document.getElementById('nome-' + p.id); if (i) { i.focus(); i.select(); } });
    };

    const listaCats = el('ul', { class: 'cadastro-lista' },
      cabecalhoCadastro(tipo === 'despesa' ? ['Nome', 'Orçamento mensal', 'Lançamentos'] : ['Nome', 'Lançamentos'], tipo === 'despesa' ? '' : ' sem-valor'));
    // Gastos aparecem por grupo (Moradia, Pets…), com o grupo e o "fixo" editáveis em cada categoria.
    const grupos = Dd.gruposDe(est);
    const daLista = est.categorias.filter((x) => x.tipo === tipo);
    const ordenadas = tipo === 'despesa'
      ? [...daLista].sort((a, b) => ((grupos.indexOf(a.grupo) + 1 || 99) - (grupos.indexOf(b.grupo) + 1 || 99)))
      : daLista;
    let grupoAnterior = null;
    for (const c of ordenadas) {
      const mudar = (fn) => alterar((e) => { const x = e.categorias.find((y) => y.id === c.id); if (x) fn(x); });
      if (tipo === 'despesa' && c.grupo !== grupoAnterior) {
        grupoAnterior = c.grupo;
        const doGrupo = daLista.filter((x) => x.grupo === c.grupo);
        listaCats.append(el('li', { class: 'cadastro-grupo' },
          el('span', { class: 'ponto', style: { background: LC.cor(c.grupo ? 'p' + ((grupos.indexOf(c.grupo) % 8) + 1) : 'neutro') } }),
          el('strong', { text: c.grupo || 'Sem grupo' }),
          el('span', { class: 'ajuda', text: `${plural(doGrupo.length, 'categoria', 'categorias')} · ${plural(doGrupo.filter((x) => x.fixo).length, 'fixa', 'fixas')}` })));
      }
      let abaixo = null;
      if (tipo === 'despesa') {
        const grupo = el('input', { id: 'grupo-' + c.id, class: 'entrada entrada-pequena', type: 'text', list: 'lista-grupos', maxlength: '40', value: c.grupo, placeholder: 'Sem grupo', autocomplete: 'off', 'aria-label': `Grupo de ${c.nome}` });
        grupo.addEventListener('change', () => { const v = grupo.value.trim(); if (v !== c.grupo) mudar((x) => { x.grupo = v; }); });
        grupo.addEventListener('keydown', (e) => { if (e.key === 'Enter') grupo.blur(); });
        const fixo = el('input', { id: 'fixo-' + c.id, type: 'checkbox', checked: c.fixo });
        fixo.addEventListener('change', () => mudar((x) => { x.fixo = fixo.checked; }));
        abaixo = el('div', { class: 'cadastro-abaixo' },
          el('label', { class: 'cadastro-grupo-campo', for: 'grupo-' + c.id }, el('span', { class: 'ajuda', text: 'Grupo' }), grupo),
          el('label', { class: 'cadastro-fixo', title: 'Conta que se repete todo mês (aluguel, internet, mensalidades)' }, fixo, el('span', { text: 'Gasto fixo' })));
      }
      listaCats.append(linhaCadastro({
        item: c, n: uso.get(c.id) || 0, rotulo: 'categoria', abaixo,
        valor: tipo === 'despesa' ? { campo: 'orcamento', rotulo: 'Orçamento mensal', dica: 'sem' } : null,
        aoMudar: mudar,
        aoExcluir: () => excluirCategoria(c.id),
      }));
    }
    if (tipo === 'despesa') listaCats.append(el('datalist', { id: 'lista-grupos' }, grupos.map((g) => el('option', { value: g }))));
    const novaCategoria = () => {
      const c = { id: LC.novoId('c'), nome: tipo === 'despesa' ? 'Nova categoria' : 'Novo recebimento', tipo, cor: Dd.proximaCor(est.categorias.filter((x) => x.tipo === tipo)), orcamento: 0, grupo: '', fixo: false };
      alterar((e) => { e.categorias.push(c); });
      requestAnimationFrame(() => { const i = document.getElementById('nome-' + c.id); if (i) { i.focus(); i.select(); } });
    };

    const nuvem = app.armazenamento.modo === 'nuvem';
    const firebase = app.armazenamento.provedor === 'firebase';
    const anos = Dd.anosComDados(est, hoje());
    raiz.append(
      el('section', { class: 'cartao cadastro' },
        el('header', { class: 'cartao-cabeca' },
          el('div', null, el('h2', { class: 'cartao-titulo', text: 'Pessoas' }), el('p', { class: 'cartao-sub', text: 'Cada pessoa tem a própria planilha mensal, como as abas "Gastos" do Excel. As colunas se escolhem na própria planilha.' }))),
        listaPessoas,
        el('p', { class: 'ajuda cadastro-nota', text: 'Saldo hoje: quanto a pessoa tem agora, somando o que recebeu e tirando o que gastou (só o que já foi pago). Se não bater com o banco, digite o valor certo: a diferença vira o saldo inicial.' }),
        el('button', { type: 'button', class: 'botao botao-fantasma', onclick: novaPessoa }, icone('adicionar'), 'Nova pessoa')),
      el('section', { class: 'cartao cadastro' },
        el('header', { class: 'cartao-cabeca' },
          el('div', null, el('h2', { class: 'cartao-titulo', text: 'Categorias' }), el('p', { class: 'cartao-sub', text: 'São as colunas das planilhas. A cor de cada uma é a mesma em todos os gráficos.' })),
          LC.UI.segmentado([{ valor: 'despesa', rotulo: 'Gastos' }, { valor: 'receita', rotulo: 'Recebimentos' }], tipo, (v) => { salvarPrefs({ abaCategorias: v }); render(); }, { rotulo: 'Tipo de categoria', compacto: true })),
        listaCats,
        el('button', { type: 'button', class: 'botao botao-fantasma', onclick: novaCategoria }, icone('adicionar'), tipo === 'despesa' ? 'Nova categoria de gasto' : 'Nova categoria de recebimento')),
      firebase ? cartaoAcesso() : null,
      el('section', { class: 'cartao cadastro dados' },
        el('header', { class: 'cartao-cabeca' },
          el('div', null, el('h2', { class: 'cartao-titulo', text: 'Dados e backup' }),
            el('p', { class: 'cartao-sub', text: firebase
              ? 'Os valores ficam na nuvem e aparecem em todos os aparelhos de quem usa este livro-caixa. Mesmo assim, baixe um backup de vez em quando.'
              : nuvem
                ? 'Seus dados ficam salvos no armazenamento deste artefato do Claude, visíveis só para você e para quem você der acesso de edição.'
                : 'Seus dados ficam salvos neste navegador, neste computador. Baixe um backup de vez em quando e guarde em lugar seguro.' }))),
        el('div', { class: 'dados-acoes' },
          instalado() ? null : botaoDado('monitor', 'Instalar como app', 'Ícone próprio no celular e no computador, abre em janela só dele e funciona sem internet.', instalarApp),
          botaoDado('excel', `Exportar Excel de ${anos[0]}`, 'No formato da sua planilha: uma aba "Gastos" por pessoa e a "Total finanças", com fórmulas e gráficos editáveis no Excel.', () => exportarAno(anos[0])),
          botaoDado('importar', 'Importar planilha ou extrato', 'O seu Gastos.xlsx (abas mensais), um .csv, um extrato .ofx do banco ou um backup .json.', () => abrirImportacao()),
          botaoDado('disco', 'Baixar backup', 'Arquivo .json com tudo: valores, pessoas, categorias e gráficos. Use para restaurar ou levar para outro computador.', exportarBackup),
          botaoDado('arquivo', 'Exportar CSV', 'Todos os lançamentos em CSV (separado por ponto e vírgula, como o Excel brasileiro abre).', () => exportarCSV(app.estado.lancamentos)),
          botaoDado('modelo', 'Baixar planilha modelo', 'Uma planilha no formato mensal, com as abas das pessoas e as colunas atuais, vazia para preencher no Excel.', baixarModelo),
          app.estado.lancamentos.some((t) => t.exemplo) ? null : botaoDado('info', 'Ver com valores de exemplo', 'Carrega 12 meses fictícios nas colunas da planilha para explorar o sistema.', carregarExemplo)),
        anos.length > 1 ? el('p', { class: 'ajuda dados-anos' }, 'Outros anos: ', anos.slice(1).map((a, i) => [i ? ', ' : '', el('button', { type: 'button', class: 'link', onclick: () => exportarAno(a) }, `Excel de ${a}`)])) : null,
        el('div', { class: 'zona-perigo' },
          el('div', null, el('strong', { text: 'Apagar todos os valores' }), el('p', { class: 'ajuda', text: 'Pessoas, colunas, categorias e gráficos continuam. Dá para desfazer logo em seguida.' })),
          el('button', { type: 'button', class: 'botao botao-perigo', onclick: apagarTudo, disabled: !est.lancamentos.length }, icone('lixeira'), 'Apagar valores'))),
      el('section', { class: 'cartao cadastro atalhos' },
        el('header', { class: 'cartao-cabeca' }, el('div', null, el('h2', { class: 'cartao-titulo', text: 'Atalhos de teclado' }))),
        el('dl', { class: 'lista-atalhos' },
          [['N', 'Novo lançamento'], ['/', 'Buscar nos lançamentos'], ['Setas', 'Andar pelas células das planilhas'], ['Enter ou F2', 'Editar a célula (Enter de novo confirma e desce)'],
            ['Digitar um número', 'Começa a editar a célula da planilha mensal'], ['Tab', 'Confirmar e ir para a próxima coluna'], ['Esc', 'Cancelar a edição'],
            ['Delete', 'Apagar o valor da célula (planilha mensal) ou o lançamento (lançamentos)'], ['Ctrl + Enter', 'Salvar no editor de gráfico']]
            .map(([k, d]) => [el('dt', null, el('kbd', { text: k })), el('dd', { text: d })]))));
  }

  // Login na nuvem (Firebase): quem pode abrir este livro-caixa, e a conta de quem está usando.
  function cartaoAcesso() {
    const s = app.armazenamento.sessao;
    const eu = s.usuario.email;
    const lista = el('ul', { class: 'lista-acesso' }, s.livro.emails.map((e) => el('li', null,
      icone('email', 'ico ico-mini'),
      el('span', { class: 'lista-acesso-email', text: e }),
      e === eu ? el('span', { class: 'etiqueta', text: 'você' }) : null,
      el('button', {
        type: 'button', class: 'botao-icone', title: e === eu ? 'Sair deste livro-caixa' : 'Tirar da lista',
        'aria-label': e === eu ? 'Sair deste livro-caixa' : `Tirar ${e} da lista`, disabled: s.livro.emails.length <= 1, onclick: () => tirarAcesso(e),
      }, icone('lixeira')))));
    const novo = el('input', {
      id: 'acesso-novo', class: 'entrada', type: 'text', inputmode: 'email', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
      placeholder: 'nome@gmail.com', 'aria-label': 'E-mail de quem vai usar',
    });
    const botao = el('button', { type: 'submit', class: 'botao' }, icone('adicionar'), 'Adicionar');
    const form = el('form', { class: 'acesso-novo', novalidate: true }, novo, botao);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      botao.disabled = true;
      try {
        const novos = await LC.Nuvem.adicionarEmails(novo.value);
        novo.value = '';
        const varios = novos.length > 1;
        LC.UI.aviso(`${novos.join(', ')} já ${varios ? 'podem' : 'pode'} entrar: é só abrir este mesmo endereço e criar a conta com ${varios ? 'esses e-mails' : 'esse e-mail'}.`, { tipo: 'ok', duracao: 9000 });
        render();
      } catch (e) {
        LC.UI.aviso(e.message, { tipo: 'erro', duracao: 7000 });
      } finally {
        if (botao.isConnected) botao.disabled = false;
      }
    });
    return el('section', { class: 'cartao cadastro acesso-cartao' },
      el('header', { class: 'cartao-cabeca' },
        el('div', null, el('h2', { class: 'cartao-titulo', text: 'Quem usa este livro-caixa' }),
          el('p', { class: 'cartao-sub', text: 'Cada e-mail da lista entra com a própria conta e vê os mesmos valores, em qualquer aparelho. Quem não está na lista não consegue abrir.' }))),
      lista,
      form,
      el('div', { class: 'conta-linha' },
        el('span', { class: 'ajuda' }, 'Você entrou como ', el('strong', { text: eu }), '.'),
        el('button', { type: 'button', class: 'link', onclick: trocarSenha }, 'Trocar a senha'),
        el('button', { type: 'button', class: 'botao botao-fantasma', onclick: sairDaConta }, icone('sair'), 'Sair da conta')));
  }

  async function tirarAcesso(email) {
    const euMesmo = email === app.armazenamento.sessao.usuario.email;
    const ok = await LC.UI.confirmar(euMesmo
      ? { titulo: 'Sair deste livro-caixa?', texto: 'Você perde o acesso a ele em todos os aparelhos. Os valores continuam para as outras pessoas da lista.', botao: 'Sair do livro-caixa', perigo: true }
      : { titulo: `Tirar ${email} da lista?`, texto: 'Essa pessoa deixa de abrir o livro-caixa. Os valores continuam.', botao: 'Tirar da lista', perigo: true });
    if (!ok) return;
    try {
      await LC.Nuvem.removerEmail(email);
      if (euMesmo) await LC.Nuvem.sair(); else render();
    } catch (e) {
      LC.UI.aviso(e.message, { tipo: 'erro', duracao: 7000 });
    }
  }

  async function trocarSenha() {
    try {
      await LC.Nuvem.trocarSenha();
      LC.UI.aviso(`Mandamos para ${app.armazenamento.sessao.usuario.email} um link para criar uma senha nova.`, { tipo: 'ok', duracao: 8000 });
    } catch (e) {
      LC.UI.aviso(e.message, { tipo: 'erro', duracao: 7000 });
    }
  }

  async function sairDaConta() {
    if (salvarDepois.pendente()) salvarDepois.agora();
    const ok = await LC.UI.confirmar({
      titulo: 'Sair da conta?',
      texto: navigator.onLine === false
        ? 'Sem internet agora: o que ainda não foi para a nuvem se perde ao sair. Se puder, espere a internet voltar.'
        : 'A cópia do livro-caixa guardada neste aparelho é apagada. Para abrir de novo, é só entrar com o e-mail e a senha.',
      botao: 'Sair',
    });
    if (ok) await LC.Nuvem.sair();
  }

  function botaoDado(nomeIcone, titulo, texto, acao) {
    return el('button', { type: 'button', class: 'dado-botao', onclick: acao },
      icone(nomeIcone, 'ico ico-dado'), el('span', { class: 'dado-textos' }, el('strong', { text: titulo }), el('span', { text: texto })));
  }

  function cabecalhoCadastro(rotulos, classe) {
    return el('li', { class: 'cadastro-linha cadastro-cabeca-lista' + classe, 'aria-hidden': 'true' }, el('span'), rotulos.map((r) => el('span', { text: r })), el('span'));
  }

  function linhaCadastro({ item, n, rotulo, valor, extra, abaixo, aoMudar, aoExcluir }) {
    const cor = el('button', { type: 'button', class: 'amostra-botao', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Mudar a cor', 'aria-label': `Mudar a cor de ${item.nome}` },
      el('span', { class: 'amostra', style: { background: LC.cor(item.cor) } }));
    cor.addEventListener('click', () => LC.UI.escolherCor(cor, item.cor, (ref) => aoMudar((x) => { x.cor = ref || 'neutro'; })));
    const nome = el('input', { id: 'nome-' + item.id, class: 'entrada entrada-nome', type: 'text', value: item.nome, maxlength: '60', 'aria-label': `Nome da ${rotulo}`, autocomplete: 'off' });
    nome.addEventListener('change', () => {
      const v = nome.value.trim();
      if (!v) { nome.value = item.nome; return; }
      aoMudar((x) => { x.nome = v; });
    });
    nome.addEventListener('keydown', (e) => { if (e.key === 'Enter') nome.blur(); });
    // valor: campo do item, ou ler/gravar próprios (o "Saldo hoje" é calculado e ajusta o saldo inicial).
    const entradas = (valor ? [valor] : []).map((c) => {
      const atual = () => (c.ler ? c.ler(item) : item[c.campo]);
      const texto = () => (atual() ? fmt.numero(atual()) : '');
      const entrada = el('input', { id: `${c.campo}-${item.id}`, class: 'entrada entrada-valor', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: c.dica, value: texto(), 'aria-label': `${c.rotulo} de ${item.nome}` });
      entrada.addEventListener('change', () => {
        const v = entrada.value.trim() === '' ? 0 : LC.paraNumero(entrada.value);
        if (!Number.isFinite(v) || (!c.negativo && v < 0)) { LC.UI.aviso('Digite um valor como 1.200,00.', { tipo: 'erro' }); entrada.value = texto(); return; }
        if (c.gravar) c.gravar(LC.arred(v)); else aoMudar((x) => { x[c.campo] = LC.arred(v); });
      });
      entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter') entrada.blur(); });
      return el('div', { class: 'cadastro-campo' }, el('span', { class: 'entrada-prefixo' }, el('span', { text: 'R$' }), entrada));
    });
    const classe = rotulo === 'pessoa' ? ' pessoa' : valor ? '' : ' sem-valor';
    return el('li', { class: 'cadastro-linha' + classe }, cor, nome, entradas, extra || null,
      rotulo === 'pessoa' ? null : el('span', { class: 'cadastro-uso', text: String(n) }),
      el('button', { type: 'button', class: 'botao-icone', title: `Excluir ${rotulo} (${plural(n, 'lançamento', 'lançamentos')})`, 'aria-label': `Excluir ${item.nome}`, onclick: aoExcluir }, icone('lixeira')),
      abaixo || null);
  }

  async function excluirCategoria(id) {
    const est = app.estado;
    const c = est.categorias.find((x) => x.id === id);
    if (!c) return;
    const irmas = est.categorias.filter((x) => x.tipo === c.tipo && x.id !== id);
    if (!irmas.length) { LC.UI.aviso('Precisa existir pelo menos uma categoria de ' + (c.tipo === 'despesa' ? 'gasto.' : 'recebimento.'), { tipo: 'erro' }); return; }
    const usados = est.lancamentos.filter((t) => t.categoria === id).length;
    let destino = Dd.categoriaPadrao({ categorias: irmas }, c.tipo);
    const seletor = usados ? LC.UI.campo(`Mover os ${plural(usados, 'lançamento', 'lançamentos')} para`, LC.UI.selecao('mover-categoria', irmas.map((x) => [x.id, x.nome]), destino, (v) => { destino = v; })) : null;
    const ok = await LC.UI.confirmar({ titulo: `Excluir a categoria “${c.nome}”?`, texto: usados ? 'Ela também sai das colunas das planilhas.' : 'Nenhum lançamento usa esta categoria. Ela sai das colunas das planilhas.', detalhe: seletor, botao: 'Excluir categoria', perigo: true });
    if (!ok) return;
    alterar((e) => {
      e.categorias = e.categorias.filter((x) => x.id !== id);
      for (const t of e.lancamentos) if (t.categoria === id) t.categoria = destino;
      for (const g of e.graficos) g.categorias = g.categorias.filter((x) => x !== id);
      for (const p of e.pessoas) p.colunas = p.colunas.filter((x) => x !== id);
    });
    LC.UI.aviso('Categoria excluída.', { tipo: 'ok' });
  }

  async function excluirPessoa(id) {
    const est = app.estado;
    const p = est.pessoas.find((x) => x.id === id);
    if (!p) return;
    const outras = est.pessoas.filter((x) => x.id !== id);
    if (!outras.length) { LC.UI.aviso('Precisa existir pelo menos uma pessoa.', { tipo: 'erro' }); return; }
    const usados = est.lancamentos.filter((t) => t.pessoa === id || t.destino === id).length;
    let destino = outras[0].id;
    const seletor = usados ? LC.UI.campo(`Passar os ${plural(usados, 'lançamento', 'lançamentos')} para`, LC.UI.selecao('mover-pessoa', outras.map((x) => [x.id, x.nome]), destino, (v) => { destino = v; })) : null;
    const ok = await LC.UI.confirmar({ titulo: `Excluir ${p.nome}?`, texto: usados ? 'A planilha mensal desta pessoa deixa de existir; os valores passam para quem você escolher.' : 'Nenhum lançamento é desta pessoa.', detalhe: seletor, botao: 'Excluir pessoa', perigo: true });
    if (!ok) return;
    alterar((e) => {
      const alvo = e.pessoas.find((x) => x.id === destino);
      e.pessoas = e.pessoas.filter((x) => x.id !== id);
      for (const t of e.lancamentos) {
        if (t.pessoa === id) t.pessoa = destino;
        if (t.destino === id) t.destino = destino;
      }
      if (alvo) for (const c of p.colunas) if (!alvo.colunas.includes(c)) alvo.colunas.push(c);
      e.lancamentos = e.lancamentos.filter((t) => !(t.tipo === 'transferencia' && t.pessoa === t.destino));
      for (const g of e.graficos) g.pessoas = g.pessoas.filter((x) => x !== id);
    });
    if (app.prefs.pessoa === id) salvarPrefs({ pessoa: 'todas' });
    LC.UI.aviso(`${p.nome} excluída dos cadastros.`, { tipo: 'ok' });
  }

  async function apagarTudo() {
    const ok = await LC.UI.confirmar({ titulo: 'Apagar todos os valores?', texto: `${plural(app.estado.lancamentos.length, 'lançamento vai', 'lançamentos vão')} sair do livro. Baixe um backup antes, se quiser guardar.`, botao: 'Apagar tudo', perigo: true });
    if (!ok) return;
    const antes = app.estado.lancamentos;
    alterar((e) => { e.lancamentos = []; });
    LC.UI.aviso('Valores apagados.', { acao: { rotulo: 'Desfazer', fn: () => alterar((e) => { e.lancamentos = antes; }) } });
  }

  async function carregarExemplo() {
    if (app.estado.lancamentos.length) {
      const ok = await LC.UI.confirmar({ titulo: 'Juntar valores de exemplo?', texto: 'Os valores de exemplo entram junto com os seus e ficam marcados como exemplo, para você apagar depois em um clique.', botao: 'Carregar exemplo' });
      if (!ok) return;
    }
    const ex = Dd.gerarExemplo(hoje());
    alterar((e) => {
      for (const c of ex.categorias) if (!e.categorias.some((x) => x.id === c.id)) e.categorias.push(c);
      for (const p of ex.pessoas) {
        const atual = e.pessoas.find((x) => x.id === p.id);
        if (!atual) e.pessoas.push(p);
        else for (const col of p.colunas) if (!atual.colunas.includes(col)) atual.colunas.push(col);
      }
      e.lancamentos.push(...ex.lancamentos);
    });
    irPara('painel');
  }

  // ── Exportação ───────────────────────────────────────────────────────────

  const nomeArquivo = (s) => LC.dobrar(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'livro-caixa';

  function menuExportar(ancora) {
    const anos = Dd.anosComDados(app.estado, hoje());
    LC.UI.menu(ancora, [
      ...anos.map((a) => ({ rotulo: `Excel de ${a} (formato Gastos)`, icone: 'excel', acao: () => exportarAno(a) })),
      { separador: true },
      { rotulo: 'CSV do que está filtrado', icone: 'arquivo', acao: () => exportarCSV(Dd.filtrar(app.estado, filtro())) },
      { rotulo: 'Backup completo (.json)', icone: 'disco', acao: exportarBackup },
    ]);
  }

  async function entregar(nome, dados, tipo, mensagem) {
    try {
      const ok = await S.baixar(nome, dados, tipo);
      if (ok) LC.UI.aviso(mensagem, { tipo: 'ok' });
    } catch (e) { LC.UI.aviso(e.message, { tipo: 'erro' }); }
  }

  function exportarAno(ano) {
    const bytes = A.excelNoFormatoGastos(app.estado, ano, hoje());
    entregar(`Gastos ${ano}.xlsx`, new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), null,
      `Planilha de ${ano} gerada no formato Gastos. Os gráficos dela são editáveis no Excel.`);
  }
  function exportarCSV(lista) {
    const ordenada = [...lista].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
    entregar(`lancamentos-${hoje()}.csv`, A.csvDosLancamentos(ordenada, app.estado), 'text/csv;charset=utf-8', `${plural(ordenada.length, 'lançamento exportado', 'lançamentos exportados')} em CSV.`);
  }
  function exportarBackup() {
    entregar(`livro-caixa-backup-${hoje()}.json`, A.backup(app.estado), 'application/json', 'Backup baixado. Guarde em um lugar seguro.');
  }
  function baixarModelo() {
    const vazio = { ...app.estado, lancamentos: [] };
    const ano = +hoje().slice(0, 4);
    const bytes = A.excelNoFormatoGastos(vazio, ano, hoje());
    entregar(`Modelo Gastos ${ano}.xlsx`, new Blob([bytes]), null, 'Planilha modelo baixada. Preencha no Excel e importe aqui.');
  }

  // ── Formulário de lançamento ─────────────────────────────────────────────

  function abrirFormulario(id) {
    const est = app.estado;
    const original = id ? est.lancamentos.find((t) => t.id === id) : null;
    const novo = !original;
    const f = filtro();
    const ultimo = [...est.lancamentos].reverse().find((t) => !t.exemplo);
    const t = original ? Dd.clonar(original) : {
      data: hoje(), tipo: 'despesa', valor: 0, descricao: '', categoria: Dd.categoriaPadrao(est, 'despesa'),
      pessoa: f.pessoa !== 'todas' ? f.pessoa : ultimo ? ultimo.pessoa : est.pessoas[0].id, situacao: 'pago',
    };
    let categoriaTocada = !novo;
    let repetir = 'nao', vezes = 2;

    const dlg = el('dialog', { class: 'dialogo dialogo-form', 'aria-labelledby': 'form-titulo' });
    const form = el('form', { class: 'form-lancamento', novalidate: true });
    const erro = el('p', { class: 'form-erro', role: 'alert', hidden: true });
    const valor = el('input', { id: 'fl-valor', class: 'entrada entrada-grande', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', value: t.valor ? fmt.numero(t.valor) : '' });
    const descricao = el('input', { id: 'fl-descricao', class: 'entrada', type: 'text', autocomplete: 'off', maxlength: '300', value: t.descricao, list: 'fl-sugestoes', placeholder: 'Ex.: Mercado, Salário, Aluguel' });
    const sugestoes = el('datalist', { id: 'fl-sugestoes' }, [...new Set(est.lancamentos.slice(-400).map((x) => x.descricao).filter(Boolean))].slice(-150).map((d) => el('option', { value: d })));
    const data = el('input', { id: 'fl-data', class: 'entrada', type: 'date', value: t.data });
    const obs = el('textarea', { id: 'fl-obs', class: 'entrada', rows: '2', maxlength: '500', placeholder: 'Opcional' });
    obs.value = t.obs || '';
    const blocoCategoria = el('div', { class: 'form-linha' });
    const blocoSituacao = el('div');
    const blocoRepetir = el('div', { class: 'form-repetir', hidden: !novo });

    function montarCategoria() {
      esvaziar(blocoCategoria);
      if (t.tipo === 'transferencia') {
        if (!t.destino || t.destino === t.pessoa) t.destino = (est.pessoas.find((p) => p.id !== t.pessoa) || est.pessoas[0]).id;
        blocoCategoria.append(
          LC.UI.campo('Quem passa', LC.UI.selecao('fl-pessoa', est.pessoas.map((p) => [p.id, p.nome]), t.pessoa, (v) => { t.pessoa = v; montarCategoria(); })),
          LC.UI.campo('Quem recebe', LC.UI.selecao('fl-destino', est.pessoas.filter((p) => p.id !== t.pessoa).map((p) => [p.id, p.nome]), t.destino, (v) => { t.destino = v; })));
      } else {
        if (!est.categorias.some((c) => c.id === t.categoria && c.tipo === t.tipo)) t.categoria = Dd.categoriaPadrao(est, t.tipo);
        const pessoa = est.pessoas.find((p) => p.id === t.pessoa);
        const daPessoa = est.categorias.filter((c) => c.tipo === t.tipo && pessoa && pessoa.colunas.includes(c.id));
        const outras = est.categorias.filter((c) => c.tipo === t.tipo && !daPessoa.includes(c));
        const opcoes = daPessoa.length
          ? [{ grupo: `Colunas de ${pessoa.nome}`, itens: daPessoa.map((c) => [c.id, c.nome]) }, ...(outras.length ? [{ grupo: 'Outras', itens: outras.map((c) => [c.id, c.nome]) }] : [])]
          : outras.map((c) => [c.id, c.nome]);
        blocoCategoria.append(
          LC.UI.campo('Pessoa', LC.UI.selecao('fl-pessoa', est.pessoas.map((p) => [p.id, p.nome]), t.pessoa, (v) => { t.pessoa = v; montarCategoria(); })),
          LC.UI.campo('Categoria', LC.UI.selecao('fl-categoria', opcoes, t.categoria, (v) => { t.categoria = v; categoriaTocada = true; })));
      }
      esvaziar(blocoSituacao).append(LC.UI.campo('Situação', LC.UI.segmentado([
        { valor: 'pago', rotulo: Dd.ROTULO_SITUACAO[t.tipo].pago }, { valor: 'pendente', rotulo: Dd.ROTULO_SITUACAO[t.tipo].pendente },
      ], t.situacao, (v) => { t.situacao = v; }, { rotulo: 'Situação', compacto: true }), { para: null }));
    }

    const tipo = LC.UI.segmentado([
      { valor: 'despesa', rotulo: 'Gasto', icone: 'saida', mostrarRotulo: true },
      { valor: 'receita', rotulo: 'Recebimento', icone: 'entrada', mostrarRotulo: true },
      { valor: 'transferencia', rotulo: 'Transferência', icone: 'transferencia', mostrarRotulo: true },
    ], t.tipo, (v) => { t.tipo = v; categoriaTocada = false; montarCategoria(); dlg.dataset.tipo = v; }, { rotulo: 'Tipo de lançamento' });
    tipo.classList.add('tipo-lancamento');
    dlg.dataset.tipo = t.tipo;

    descricao.addEventListener('change', () => {
      if (categoriaTocada || t.tipo === 'transferencia') return;
      const alvo = LC.dobrar(descricao.value);
      const igual = [...est.lancamentos].reverse().find((x) => x.tipo === t.tipo && LC.dobrar(x.descricao) === alvo);
      if (igual) {
        t.categoria = igual.categoria;
        if (novo) t.pessoa = igual.pessoa;
        montarCategoria();
      }
    });
    data.addEventListener('change', () => {
      if (novo && D.valida(data.value)) {
        t.situacao = data.value > hoje() ? 'pendente' : 'pago';
        montarCategoria();
      }
    });

    const vezesEntrada = el('input', { id: 'fl-vezes', class: 'entrada entrada-curta', type: 'number', min: '2', max: '120', value: '2', disabled: true });
    vezesEntrada.addEventListener('input', () => { vezes = parseInt(vezesEntrada.value, 10) || 2; atualizarResumoRepetir(); });
    const resumoRepetir = el('p', { class: 'ajuda' });
    function atualizarResumoRepetir() {
      const v = LC.paraNumero(valor.value);
      if (repetir === 'nao' || !Number.isFinite(v) || v <= 0) { resumoRepetir.textContent = ''; return; }
      resumoRepetir.textContent = repetir === 'parcelas'
        ? `${vezes} parcelas de ${fmt.moeda(Math.floor((v / vezes) * 100) / 100)}, uma por mês.`
        : `${vezes} lançamentos de ${fmt.moeda(v)}, um por mês. Os futuros entram como pendentes.`;
    }
    valor.addEventListener('input', atualizarResumoRepetir);
    blocoRepetir.append(
      LC.UI.campo('Repetir', LC.UI.segmentado([{ valor: 'nao', rotulo: 'Não repete' }, { valor: 'mensal', rotulo: 'Todo mês' }, { valor: 'parcelas', rotulo: 'Parcelado' }], 'nao',
        (v) => { repetir = v; vezesEntrada.disabled = v === 'nao'; atualizarResumoRepetir(); }, { rotulo: 'Repetir', compacto: true }), { para: null }),
      LC.UI.campo('Vezes', vezesEntrada), resumoRepetir);

    montarCategoria();
    form.append(
      tipo,
      el('div', { class: 'form-valor' }, el('label', { for: 'fl-valor', class: 'campo-rotulo', text: 'Valor' }),
        el('div', { class: 'entrada-prefixo entrada-prefixo-grande' }, el('span', { text: 'R$' }), valor)),
      LC.UI.campo('Descrição', descricao), sugestoes,
      el('div', { class: 'form-linha' }, LC.UI.campo('Data', data), blocoSituacao),
      blocoCategoria,
      blocoRepetir,
      LC.UI.campo('Observação', obs),
      erro);

    const salvarOutro = el('button', { type: 'button', class: 'botao', hidden: !novo }, 'Salvar e lançar outro');
    dlg.append(
      el('header', { class: 'dialogo-cabeca' },
        el('h2', { id: 'form-titulo', class: 'dialogo-titulo', text: novo ? 'Novo lançamento' : 'Editar lançamento' }),
        el('button', { type: 'button', class: 'botao-icone', 'aria-label': 'Fechar', title: 'Fechar', onclick: () => dlg.close() }, icone('fechar'))),
      el('div', { class: 'dialogo-corpo' }, form),
      el('footer', { class: 'dialogo-rodape' },
        !novo ? el('button', { type: 'button', class: 'botao botao-fantasma perigo', onclick: () => { dlg.close(); excluir([original.id]); } }, icone('lixeira'), 'Excluir') : el('span'),
        el('div', { class: 'grupo-botoes' },
          el('button', { type: 'button', class: 'botao', onclick: () => dlg.close() }, 'Cancelar'),
          salvarOutro,
          el('button', { type: 'submit', class: 'botao botao-primario', form: 'form-lancamento' }, novo ? 'Lançar' : 'Salvar'))));
    form.id = 'form-lancamento';

    function gravar() {
      const v = LC.paraNumero(valor.value);
      const problemas = [];
      if (!Number.isFinite(v) || v === 0) problemas.push('Informe o valor (ex.: 1.234,56).');
      if (!D.valida(data.value)) problemas.push('Informe uma data válida.');
      if (problemas.length) {
        erro.textContent = problemas.join(' ');
        erro.hidden = false;
        (!Number.isFinite(v) || v === 0 ? valor : data).focus();
        return false;
      }
      let tipoFinal = t.tipo;
      let categoria = t.categoria;
      if (v < 0 && t.tipo === 'receita') { tipoFinal = 'despesa'; categoria = Dd.categoriaPadrao(est, 'despesa'); }
      const base = Dd.normalizarLancamento({ ...t, id: original ? original.id : LC.novoId('l'), tipo: tipoFinal, categoria, valor: Math.abs(v), data: data.value, descricao: descricao.value.trim(), obs: obs.value.trim(), mensal: original ? original.mensal : false, exemplo: false });
      const lista = novo ? Dd.expandirRecorrencia(base, repetir, vezes, hoje()) : [base];
      alterar((e) => {
        if (novo) e.lancamentos.push(...lista);
        else { const i = e.lancamentos.findIndex((x) => x.id === original.id); if (i >= 0) e.lancamentos[i] = base; }
        const p = e.pessoas.find((x) => x.id === base.pessoa);
        if (p && base.tipo !== 'transferencia' && !p.colunas.includes(base.categoria)) p.colunas.push(base.categoria);
      });
      const f2 = filtro();
      const fora = app.prefs.vista !== 'mensal' && lista.every((x) => x.data < f2.inicio || x.data > f2.fim);
      LC.UI.aviso(novo ? (lista.length > 1 ? `${lista.length} lançamentos criados.` : 'Lançamento registrado.') + (fora ? ' Ele está fora do período do filtro no topo.' : '') : 'Lançamento atualizado.', { tipo: 'ok' });
      return true;
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); if (gravar()) dlg.close(); });
    salvarOutro.addEventListener('click', () => {
      if (!gravar()) return;
      valor.value = ''; descricao.value = ''; obs.value = '';
      erro.hidden = true;
      categoriaTocada = false;
      valor.focus();
    });
    dlg.addEventListener('close', () => { LC.UI.fecharPopover(); dlg.remove(); });
    document.body.append(dlg);
    dlg.showModal();
    (novo ? valor : descricao).focus();
  }

  // ── Importação ───────────────────────────────────────────────────────────

  function abrirImportacao() {
    const dlg = el('dialog', { class: 'dialogo dialogo-largo', 'aria-labelledby': 'imp-titulo' });
    const corpo = el('div', { class: 'dialogo-corpo' });
    const rodape = el('footer', { class: 'dialogo-rodape' });
    const titulo = el('h2', { id: 'imp-titulo', class: 'dialogo-titulo', text: 'Importar planilha' });
    dlg.append(el('header', { class: 'dialogo-cabeca' }, titulo,
      el('button', { type: 'button', class: 'botao-icone', 'aria-label': 'Fechar', title: 'Fechar', onclick: () => dlg.close() }, icone('fechar'))), corpo, rodape);
    dlg.addEventListener('close', () => { LC.UI.fecharPopover(); dlg.remove(); });
    document.body.append(dlg);
    dlg.showModal();

    function passoArquivo(mensagemErro) {
      titulo.textContent = 'Importar planilha';
      esvaziar(corpo);
      esvaziar(rodape);
      const entrada = el('input', { id: 'imp-arquivo', type: 'file', class: 'visualmente-oculto', accept: '.xlsx,.xlsm,.csv,.txt,.ofx,.qfx,.json' });
      const zona = el('label', { class: 'zona-arquivo', for: 'imp-arquivo' },
        icone('importar', 'ico ico-grande'),
        el('strong', { text: 'Escolha o arquivo ou arraste para cá' }),
        el('span', { text: 'O seu Gastos.xlsx, outra planilha .xlsx, um .csv, um extrato .ofx do banco ou um backup do Livro-Caixa (.json)' }));
      entrada.addEventListener('change', () => { if (entrada.files[0]) ler(entrada.files[0]); });
      zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('sobre'); });
      zona.addEventListener('dragleave', () => zona.classList.remove('sobre'));
      zona.addEventListener('drop', (e) => { e.preventDefault(); zona.classList.remove('sobre'); const f = e.dataTransfer.files[0]; if (f) ler(f); });
      corpo.append(entrada, zona,
        mensagemErro ? el('p', { class: 'form-erro', role: 'alert', text: mensagemErro }) : null,
        el('ul', { class: 'imp-dicas' },
          el('li', { text: 'Planilhas mensais (um mês por linha, uma categoria por coluna), como as abas "Gastos Nathy" e "Gastos vini", são reconhecidas sozinhas, inclusive abas ocultas e blocos por ano.' }),
          el('li', { text: 'Listas de lançamentos (data, descrição, valor) também: valores negativos viram gastos.' }),
          el('li', null, 'Arquivo .xls antigo? Abra no Excel e salve como .xlsx. Não tem planilha? ',
            el('button', { type: 'button', class: 'link', onclick: baixarModelo }, 'Baixe a planilha modelo'), '.')));
      rodape.append(el('span'), el('button', { type: 'button', class: 'botao', onclick: () => dlg.close() }, 'Cancelar'));
    }

    async function ler(arquivo) {
      esvaziar(corpo).append(el('p', { class: 'carregando-texto', text: `Lendo ${arquivo.name}…` }));
      try {
        const r = await A.lerArquivo(arquivo);
        if (r.tipo === 'backup') { dlg.close(); restaurarBackup(r.estado, arquivo.name); return; }
        const mensais = r.ofx ? [] : r.abas.map((a) => ({ nome: a.nome, mensal: Dd.detectarMensal(a.linhas) })).filter((a) => a.mensal);
        if (mensais.some((a) => !a.mensal.resumo)) passoMensal(r, mensais);
        else passoColunas(r);
      } catch (e) {
        passoArquivo(e.message || 'Não foi possível ler o arquivo.');
      }
    }

    // Planilha mensal: uma aba por pessoa (e abas antigas com blocos por ano)
    function passoMensal(arq, mensais) {
      const est = app.estado;
      const anoAtual = +hoje().slice(0, 4);
      const op = { anoPadrao: anoAtual, substituir: true, tirarExemplos: est.lancamentos.some((t) => t.exemplo) };
      const abas = mensais.map((a) => {
        const sugestao = Dd.pessoaDaAba(a.nome);
        const existente = sugestao && est.pessoas.find((p) => Dd.chaveNome(p.nome) === Dd.chaveNome(sugestao));
        return {
          nome: a.nome, mensal: a.mensal, papeis: {},
          pessoa: existente ? existente.id : `__nova:${sugestao || 'Casa'}`,
          incluir: !a.mensal.resumo,
          anosFora: new Set(),
        };
      });
      titulo.textContent = `Importar ${arq.nome}`;
      const juntar = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}` : l.join(''));

      const desenhar = () => {
        esvaziar(corpo);
        // A aba sem dono (a "Gastos" antiga) deixa de fora os anos que as abas das pessoas já cobrem,
        // a não ser que a pessoa tenha mexido nos anos dela.
        const cobertos = Dd.anosJaCobertos(abas, op.anoPadrao);
        for (const aba of abas) {
          if (aba.anosMexidos || aba.mensal.resumo || Dd.pessoaDaAba(aba.nome)) continue;
          aba.anosFora = new Set(aba.mensal.anos.filter((a) => cobertos.has(a)));
        }
        const r = Dd.prepararImportacaoMensal(abas, op, est, hoje());
        corpo.append(el('p', { class: 'dialogo-texto' }, `Encontrei ${plural(abas.length, 'planilha mensal', 'planilhas mensais')} (um mês por linha, uma categoria por coluna). Confira de quem é cada uma:`));
        const lista = el('ul', { class: 'imp-abas' });
        for (const aba of abas) {
          const m = aba.mensal;
          const usaveis = m.colunas.filter((c) => (aba.papeis[c.indice] || c.papel) !== 'ignorar');
          const valores = m.entradas.filter((e) => usaveis.some((c) => c.indice === e.coluna)).length;
          const info = m.resumo ? 'só totais calculados: não precisa importar'
            : `${plural(usaveis.length, 'coluna', 'colunas')} · ${valores ? `${plural(valores, 'valor', 'valores')}${m.anos.length ? ' · ' + m.anos.join(', ') : ''}` : 'nenhum valor preenchido ainda'}`;
          const nomesNovos = new Set();
          const opcoesPessoa = [...est.pessoas.map((p) => [p.id, p.nome])];
          for (const a of abas) if (a.pessoa.startsWith('__nova:')) nomesNovos.add(a.pessoa);
          if (!aba.pessoa.startsWith('__nova:')) nomesNovos.add(`__nova:${Dd.pessoaDaAba(aba.nome) || 'Casa'}`);
          for (const n of nomesNovos) if (!opcoesPessoa.some(([v]) => v === n)) opcoesPessoa.push([n, `Nova pessoa: ${n.slice(7)}`]);
          const colunasDet = el('details', { class: 'imp-colunas' }, el('summary', { text: 'Ver as colunas' }),
            el('div', { class: 'imp-mapa' }, m.colunas.map((c) => LC.UI.campo(c.nome, LC.UI.selecao(`imp-${abas.indexOf(aba)}-${c.indice}`,
              [['despesa', 'Gasto'], ['receita', 'Recebimento'], ['ignorar', 'Não importar (total)']], aba.papeis[c.indice] || c.papel,
              (v) => { aba.papeis[c.indice] = v; desenhar(); })))));
          let anos = null;
          if (!m.resumo && aba.incluir && (m.anos.length > 1 || aba.anosFora.size)) {
            const sobrepostos = m.anos.filter((a) => cobertos.has(a));
            const fora = sobrepostos.filter((a) => aba.anosFora.has(a));
            const dentro = sobrepostos.filter((a) => !aba.anosFora.has(a));
            const donos = (lista) => juntar([...new Set(lista.flatMap((a) => cobertos.get(a)))]);
            anos = el('div', { class: 'imp-anos' },
              el('span', { class: 'campo-rotulo', text: 'Anos' }),
              el('div', { class: 'chips', role: 'group', 'aria-label': `Anos da aba ${aba.nome}` }, m.anos.map((ano) => {
                const marcado = !aba.anosFora.has(ano);
                const n = m.entradas.filter((e) => (e.ano || op.anoPadrao) === ano && usaveis.some((c) => c.indice === e.coluna)).length;
                return el('button', {
                  type: 'button', class: 'chip', 'aria-pressed': String(marcado),
                  onclick: () => { aba.anosMexidos = true; if (marcado) aba.anosFora.add(ano); else aba.anosFora.delete(ano); desenhar(); },
                }, `${ano} · ${plural(n, 'valor', 'valores')}`);
              })),
              fora.length ? el('p', { class: 'ajuda imp-anos-aviso' },
                `${juntar(fora)} ${fora.length > 1 ? 'ficaram' : 'ficou'} de fora porque ${fora.length > 1 ? 'já são os anos' : 'já é o ano'} de ${donos(fora)}, e a Total finanças da planilha soma só essas abas. Marque se quiser trazer esses valores também.`) : null,
              dentro.length ? el('p', { class: 'ajuda imp-anos-aviso alerta' }, icone('alerta', 'ico ico-mini'),
                ` ${juntar(dentro)} também ${dentro.length > 1 ? 'são os anos' : 'é o ano'} de ${donos(dentro)}. O que for lançado nos dois lugares conta duas vezes.`) : null);
          }
          lista.append(el('li', { class: 'imp-aba' + (aba.incluir ? '' : ' desligada') },
            el('div', { class: 'imp-aba-topo' },
              LC.UI.interruptor(`imp-incluir-${abas.indexOf(aba)}`, aba.nome, aba.incluir, (v) => { aba.incluir = v; desenhar(); }, { ajuda: info }),
              m.resumo ? null : LC.UI.campo('De quem é', LC.UI.selecao(`imp-pessoa-${abas.indexOf(aba)}`, opcoesPessoa, aba.pessoa, (v) => { aba.pessoa = v; desenhar(); }), { classe: 'imp-pessoa' })),
            anos,
            m.resumo ? null : colunasDet));
        }
        corpo.append(lista);
        const semAno = abas.some((a) => a.incluir && a.mensal.semAno);
        corpo.append(el('div', { class: 'imp-opcoes' },
          semAno ? LC.UI.campo('Ano das abas sem ano escrito', LC.UI.selecao('imp-ano', [anoAtual + 1, anoAtual, anoAtual - 1, anoAtual - 2].map((a) => [a, String(a)]), op.anoPadrao, (v) => { op.anoPadrao = +v; desenhar(); })) : null,
          el('div', { class: 'grupo-interruptores' },
            LC.UI.interruptor('imp-subst-mes', 'Substituir os valores desses meses', op.substituir, (v) => { op.substituir = v; desenhar(); }, { ajuda: 'Para importar a planilha de novo sem somar duas vezes.' }),
            op.tirarExemplos !== false && est.lancamentos.some((t) => t.exemplo)
              ? LC.UI.interruptor('imp-tirar-ex', 'Tirar os valores de exemplo', op.tirarExemplos, (v) => { op.tirarExemplos = v; desenhar(); }) : null)));

        const porAno = new Map();
        for (const t of r.itens) {
          const a = t.data.slice(0, 4);
          const x = porAno.get(a) || { r: 0, g: 0, meses: new Set() };
          if (t.tipo === 'receita') x.r += t.valor; else x.g += t.valor;
          x.meses.add(t.data.slice(0, 7));
          porAno.set(a, x);
        }
        corpo.append(el('h3', { class: 'editor-secao-titulo', text: 'O que vai entrar' }),
          el('ul', { class: 'imp-resumo' },
            el('li', { class: r.itens.length ? 'ok' : 'aviso-linha' }, icone(r.itens.length ? 'check' : 'info', 'ico ico-mini'),
              r.itens.length ? `${plural(r.itens.length, 'valor', 'valores')} das planilhas` : 'Nenhum valor preenchido: entram só as colunas, prontas para digitar'),
            [...porAno.entries()].sort().map(([a, x]) => el('li', null, icone('calendario', 'ico ico-mini'), `${a}: ${plural(x.meses.size, 'mês', 'meses')}, recebido ${fmt.moeda(x.r)}, gasto ${fmt.moeda(x.g)}`)),
            r.novasPessoas.length ? el('li', null, icone('adicionar', 'ico ico-mini'), `Pessoas novas: ${r.novasPessoas.map((p) => p.nome).join(', ')}`) : null,
            r.novasCategorias.length ? el('li', null, icone('adicionar', 'ico ico-mini'), `Colunas novas: ${r.novasCategorias.map((c) => c.nome).join(', ')}`) : null,
            r.ignorados ? el('li', { class: 'aviso-linha' }, icone('alerta', 'ico ico-mini'), `${plural(r.ignorados, 'valor ficou', 'valores ficaram')} sem ano e não ${r.ignorados === 1 ? 'entra' : 'entram'}`) : null));

        const nada = !abas.some((a) => a.incluir);
        esvaziar(rodape).append(
          el('button', { type: 'button', class: 'botao botao-fantasma', onclick: () => passoArquivo() }, 'Escolher outro arquivo'),
          el('div', { class: 'grupo-botoes' },
            el('button', { type: 'button', class: 'botao', onclick: () => dlg.close() }, 'Cancelar'),
            el('button', { type: 'button', class: 'botao botao-primario', disabled: nada, onclick: () => { dlg.close(); aplicarMensal(r, op, abas); } },
              r.itens.length ? `Importar ${plural(r.itens.length, 'valor', 'valores')}` : 'Importar as colunas')));
      };
      desenhar();
    }

    // Lista de lançamentos (extrato, CSV)
    function passoColunas(arq) {
      const est = app.estado;
      const op = { aba: 0, cabecalho: 0, mapa: {}, modoTipo: 'sinal', pessoaPadrao: app.prefs.pessoa !== 'todas' ? app.prefs.pessoa : est.pessoas[0].id, ignorarDuplicados: true, substituir: false };
      const preparar = (redefinir) => {
        const linhas = arq.abas[op.aba].linhas;
        if (redefinir) {
          op.cabecalho = Dd.detectarCabecalho(linhas);
          op.mapa = Dd.sugerirMapa((linhas[op.cabecalho] || []).map(String));
          op.modoTipo = arq.ofx ? 'sinal' : Dd.sugerirModoTipo(op.mapa, linhas.slice(op.cabecalho + 1));
        }
      };
      preparar(true);
      titulo.textContent = `Importar ${arq.nome}`;

      const desenhar = () => {
        const linhas = arq.abas[op.aba].linhas;
        const cab = (linhas[op.cabecalho] || []).map((x) => String(x ?? ''));
        const nCols = Math.max(cab.length, ...linhas.slice(op.cabecalho, op.cabecalho + 30).map((l) => l.length));
        const opcoesColuna = [['', '— não usar —'], ...Array.from({ length: nCols }, (_, i) => [String(i), `${LC.letraColuna(i)} · ${cab[i] || 'sem título'}`])];
        const r = Dd.prepararImportacao(linhas.slice(op.cabecalho + 1), op.mapa, op, est, hoje());

        esvaziar(corpo);
        const topo = el('div', { class: 'imp-topo' });
        if (arq.abas.length > 1) {
          topo.append(LC.UI.campo('Aba', LC.UI.selecao('imp-aba', arq.abas.map((a, i) => [i, a.nome]), op.aba, (v) => { op.aba = +v; preparar(true); desenhar(); })));
        }
        if (!arq.ofx) {
          topo.append(LC.UI.campo('Linha dos títulos', LC.UI.selecao('imp-cab', Array.from({ length: Math.min(15, linhas.length) }, (_, i) => [i, `Linha ${i + 1}: ${(linhas[i] || []).filter((x) => x !== '').slice(0, 3).join(', ').slice(0, 50) || '(vazia)'}`]),
            op.cabecalho, (v) => { op.cabecalho = +v; op.mapa = Dd.sugerirMapa((linhas[op.cabecalho] || []).map(String)); desenhar(); })));
        }
        corpo.append(topo);

        if (!arq.ofx) {
          const mapa = el('div', { class: 'imp-mapa' });
          for (const [campo, def] of Object.entries(Dd.CAMPOS_IMPORTACAO)) {
            if ((campo === 'entrada' || campo === 'saida') && op.modoTipo !== 'colunas') continue;
            if (campo === 'valor' && op.modoTipo === 'colunas') continue;
            mapa.append(LC.UI.campo(def.nome + (def.obrigatorio ? ' *' : ''), LC.UI.selecao('imp-' + campo, opcoesColuna, op.mapa[campo] ?? '', (v) => {
              if (v === '') delete op.mapa[campo]; else op.mapa[campo] = +v;
              desenhar();
            })));
          }
          corpo.append(el('h3', { class: 'editor-secao-titulo', text: 'De onde vem cada informação' }), mapa);
        }

        corpo.append(el('div', { class: 'imp-opcoes' },
          !arq.ofx ? LC.UI.campo('Recebimento ou gasto', LC.UI.selecao('imp-modo', [
            ['sinal', 'Pelo sinal: negativo é gasto'], ['coluna', 'Pela coluna Tipo'], ['colunas', 'Colunas separadas de entrada e saída'],
            ['despesa', 'Tudo é gasto'], ['receita', 'Tudo é recebimento']], op.modoTipo, (v) => { op.modoTipo = v; desenhar(); })) : null,
          LC.UI.campo(arq.ofx ? 'De quem é o extrato' : 'Pessoa das linhas sem pessoa', LC.UI.selecao('imp-pessoa', est.pessoas.map((p) => [p.id, p.nome]), op.pessoaPadrao, (v) => { op.pessoaPadrao = v; desenhar(); })),
          el('div', { class: 'grupo-interruptores' },
            LC.UI.interruptor('imp-dup', 'Pular os que já existem', op.ignorarDuplicados, (v) => { op.ignorarDuplicados = v; desenhar(); }, { ajuda: 'Mesma data, valor, tipo e descrição.' }),
            LC.UI.interruptor('imp-subst', 'Substituir todos os lançamentos atuais', op.substituir, (v) => { op.substituir = v; desenhar(); }, { ajuda: 'Apaga o que existe hoje antes de importar.' }))));

        const cats = new Map(r.categorias.map((c) => [c.id, c])), pessoas = new Map(r.pessoas.map((p) => [p.id, p]));
        const previa = el('table', { class: 'tabela-dados imp-previa' },
          el('thead', null, el('tr', null, ['Data', 'Descrição', 'Categoria', 'Pessoa', 'Situação', 'Valor'].map((h, i) => el('th', { scope: 'col', class: i === 5 ? 'num' : null, text: h })))),
          el('tbody', null, r.itens.slice(0, 8).map((t) => el('tr', null,
            el('td', { class: 'tab-num', text: fmt.data(t.data) }), el('td', { text: t.descricao }),
            el('td', null, el('span', { class: 'item-cor' }, el('span', { class: 'ponto', style: { background: LC.cor(cats.get(t.categoria)?.cor) } }), cats.get(t.categoria)?.nome || '')),
            el('td', { text: pessoas.get(t.pessoa)?.nome || '' }), el('td', { text: Dd.ROTULO_SITUACAO[t.tipo][t.situacao] }),
            el('td', { class: 'num valor-' + t.tipo, text: (t.tipo === 'receita' ? '+' : '−') + fmt.moeda(t.valor) })))));
        const resumo = el('ul', { class: 'imp-resumo' },
          el('li', { class: r.itens.length ? 'ok' : 'erro' }, icone(r.itens.length ? 'check' : 'alerta', 'ico ico-mini'), `${plural(r.itens.length, 'lançamento pronto', 'lançamentos prontos')} para importar`),
          r.erros.length ? el('li', { class: 'aviso-linha' }, icone('alerta', 'ico ico-mini'), `${plural(r.erros.length, 'linha ignorada', 'linhas ignoradas')} (sem data ou valor reconhecível)`) : null,
          r.duplicados ? el('li', null, icone('info', 'ico ico-mini'), `${plural(r.duplicados, 'já existia', 'já existiam')} e ${r.duplicados === 1 ? 'será pulado' : 'serão pulados'}`) : null,
          r.novasCategorias.length ? el('li', null, icone('adicionar', 'ico ico-mini'), `Categorias novas: ${r.novasCategorias.map((c) => c.nome).join(', ')}`) : null,
          r.novasPessoas.length ? el('li', null, icone('adicionar', 'ico ico-mini'), `Pessoas novas: ${r.novasPessoas.map((p) => p.nome).join(', ')}`) : null);
        corpo.append(el('h3', { class: 'editor-secao-titulo', text: 'Prévia' }), resumo,
          r.itens.length ? el('div', { class: 'rolagem-x' }, previa) : el('p', { class: 'ajuda', text: op.mapa.data == null ? 'Escolha qual coluna tem a data.' : 'Confira se as colunas de data e valor estão certas.' }));

        esvaziar(rodape).append(
          el('button', { type: 'button', class: 'botao botao-fantasma', onclick: () => passoArquivo() }, 'Escolher outro arquivo'),
          el('div', { class: 'grupo-botoes' },
            el('button', { type: 'button', class: 'botao', onclick: () => dlg.close() }, 'Cancelar'),
            el('button', { type: 'button', class: 'botao botao-primario', disabled: !r.itens.length, onclick: () => { dlg.close(); aplicarImportacao(r, op.substituir); } },
              `Importar ${plural(r.itens.length, 'lançamento', 'lançamentos')}`)));
      };
      desenhar();
    }

    passoArquivo();
  }

  function guardarParaDesfazer() {
    const e = app.estado;
    return { pessoas: Dd.clonar(e.pessoas), categorias: Dd.clonar(e.categorias), lancamentos: e.lancamentos };
  }

  function aplicarMensal(r, op, abas) {
    const antes = guardarParaDesfazer();
    alterar((e) => {
      e.pessoas = r.pessoas;
      e.categorias = r.categorias;
      if (op.tirarExemplos) Dd.limparExemplos(e);
      let lista = e.lancamentos;
      if (op.substituir) {
        lista = lista.filter((t) => {
          const meses = r.mesesSubstituidos.get(t.pessoa);
          return !(meses && meses.has(t.data.slice(0, 7)) && t.tipo !== 'transferencia');
        });
      }
      e.lancamentos = [...lista, ...r.itens];
    });
    const anos = [...new Set(r.itens.map((t) => +t.data.slice(0, 4)))].sort((a, b) => b - a);
    const primeira = abas.find((a) => a.incluir && !a.mensal.resumo && a.mensal.entradas.length) || abas.find((a) => a.incluir);
    const pessoaAba = primeira && (primeira.pessoa.startsWith('__nova:')
      ? app.estado.pessoas.find((p) => Dd.chaveNome(p.nome) === Dd.chaveNome(primeira.pessoa.slice(7)))?.id : primeira.pessoa);
    salvarPrefs({ abaMensal: pessoaAba || app.estado.pessoas[0].id, anoMensal: anos[0] || +hoje().slice(0, 4) });
    irPara('mensal');
    LC.UI.aviso(r.itens.length ? `${plural(r.itens.length, 'valor importado', 'valores importados')} da planilha.` : 'Colunas importadas. Agora é só digitar os valores de cada mês.', {
      tipo: 'ok', acao: { rotulo: 'Desfazer', fn: () => alterar((e) => Object.assign(e, antes)) },
    });
  }

  function aplicarImportacao(r, substituir) {
    const antes = guardarParaDesfazer();
    const exemplos = app.estado.lancamentos.some((t) => t.exemplo);
    alterar((e) => {
      e.categorias = r.categorias;
      e.pessoas = r.pessoas;
      for (const t of r.itens) {
        const p = e.pessoas.find((x) => x.id === t.pessoa);
        if (p && !p.colunas.includes(t.categoria)) p.colunas.push(t.categoria);
      }
      e.lancamentos = substituir ? [...r.itens] : [...e.lancamentos, ...r.itens];
    });
    const f = filtro();
    if (!r.itens.some((t) => t.data >= f.inicio && t.data <= f.fim)) salvarPrefs({ periodo: 'tudo' });
    irPara('lancamentos');
    LC.UI.aviso(`${plural(r.itens.length, 'lançamento importado', 'lançamentos importados')}.` + (exemplos && !substituir ? ' Os valores de exemplo continuam; apague-os pela faixa no topo.' : ''), {
      tipo: 'ok', acao: { rotulo: 'Desfazer', fn: () => alterar((e) => Object.assign(e, antes)) },
    });
  }

  async function restaurarBackup(bruto, nome) {
    const novo = Dd.sanear(bruto);
    const ok = await LC.UI.confirmar({
      titulo: 'Restaurar este backup?',
      texto: `${nome}: ${plural(novo.lancamentos.length, 'lançamento', 'lançamentos')}, ${plural(novo.pessoas.length, 'pessoa', 'pessoas')}, ${plural(novo.categorias.length, 'categoria', 'categorias')} e ${plural(novo.graficos.length, 'gráfico', 'gráficos')}. Tudo o que está no livro agora será substituído.`,
      botao: 'Restaurar backup', perigo: true,
    });
    if (!ok) return;
    const antes = { ...app.estado };
    alterar((e) => Object.assign(e, novo));
    LC.UI.aviso('Backup restaurado.', { tipo: 'ok', acao: { rotulo: 'Desfazer', fn: () => alterar((e) => Object.assign(e, antes)) } });
  }

  // ── App instalável (PWA) ─────────────────────────────────────────────────

  let pedidoInstalar = null; // Chrome e Edge guardam aqui o pedido de instalação
  const instalado = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const noIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function prepararApp() {
    const web = /^https?:$/.test(location.protocol) && !(window.claude && typeof window.claude.use === 'function');
    if (web && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* sem app offline neste navegador */ });
    const botao = $('#acao-instalar');
    const mostrar = () => { botao.hidden = instalado() || !(pedidoInstalar || (noIphone() && web)); };
    botao.addEventListener('click', instalarApp);
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pedidoInstalar = e; mostrar(); if (app.prefs.vista === 'cadastros') render(); });
    window.addEventListener('appinstalled', () => { pedidoInstalar = null; mostrar(); LC.UI.aviso('Pronto: o Livro-Caixa está instalado como app.', { tipo: 'ok' }); render(); });
    mostrar();
  }

  async function instalarApp() {
    if (pedidoInstalar) {
      pedidoInstalar.prompt();
      try { await pedidoInstalar.userChoice; } catch (_) { /* fechou a janela */ }
      pedidoInstalar = null;
      $('#acao-instalar').hidden = true;
      render();
      return;
    }
    const passos = noIphone()
      ? 'No Safari, toque no botão Compartilhar (o quadrado com a seta para cima) e depois em "Adicionar à Tela de Início".'
      : /android/i.test(navigator.userAgent)
        ? 'No Chrome, toque no menu ⋮ (canto de cima) e depois em "Instalar app" ou "Adicionar à tela inicial".'
        : 'No Chrome ou no Edge, clique no ícone de instalar no fim da barra de endereço (um monitor com uma seta) ou no menu ⋮ → "Instalar Livro-Caixa".';
    await LC.UI.confirmar({ titulo: 'Instalar o Livro-Caixa', texto: passos, botao: 'Entendi' });
  }

  // ── Início ───────────────────────────────────────────────────────────────

  async function iniciar() {
    app.prefs = { ...app.prefs, ...S.lerPrefs() };
    prepararApp();
    const vistaHash = location.hash.slice(1);
    if (VISTAS[vistaHash]) app.prefs.vista = vistaHash;
    if (!VISTAS[app.prefs.vista]) app.prefs.vista = 'painel';
    aplicarTema();
    montarCasca();
    app.planilha = LC.Planilha.criar($('#vista-lancamentos'), {
      prefs: () => app.prefs, salvarPrefs, estado: () => app.estado, filtro, hoje,
      alterar, excluir, novoLancamento: () => abrirFormulario(), editarLancamento: (id) => abrirFormulario(id), importar: () => abrirImportacao(),
    });
    app.mensal = LC.Mensal.criar($('#vista-mensal'), {
      prefs: () => app.prefs, salvarPrefs, estado: () => app.estado, hoje, alterar, exportarAno,
    });

    // Com o Firebase ligado, aqui aparecem as telas de login e cadastro até haver um livro-caixa aberto.
    app.armazenamento = await S.iniciar({ obterEstado: () => (app.modoExemplo ? null : app.estado) });
    const firebase = app.armazenamento.provedor === 'firebase';
    let bruto = await app.armazenamento.carregar();
    if (bruto && bruto.falhou) {
      if (firebase) {
        const negado = bruto.erro && bruto.erro.code === 'permission-denied';
        await LC.Nuvem.telaErro(negado
          ? 'O seu e-mail não tem permissão para abrir este livro-caixa. Peça para alguém da lista conferir em Cadastros, ou confira as regras do Firebase (veja o README).'
          : 'O livro-caixa não respondeu. Confira a internet e tente de novo.');
      }
      app.armazenamento = S.local('falha');
      bruto = await app.armazenamento.carregar();
      LC.UI.aviso('Não foi possível abrir o armazenamento do Claude agora. Usando o deste navegador.', { tipo: 'erro', duracao: 9000 });
    }
    // Livro-caixa novo, ainda vazio: leva o que já estava guardado neste navegador (de antes de ligar o login).
    let trouxe = false;
    if (!bruto && firebase) {
      const local = await S.local().carregar();
      if (local && Array.isArray(local.lancamentos) && local.lancamentos.some((t) => !t.exemplo)) { bruto = local; trouxe = true; }
    }
    if (bruto) app.estado = Dd.sanear(bruto);
    else { app.estado = Dd.gerarExemplo(hoje()); app.modoExemplo = true; }
    app.armazenamento.escutar(aoMudarRemoto);
    if (app.armazenamento.escutarErros) app.armazenamento.escutarErros(aoErroNuvem);
    if (firebase) {
      LC.Nuvem.aoMudarLivro(() => { if (app.prefs.vista === 'cadastros') render(); });
      window.addEventListener('online', renderStatus);
      window.addEventListener('offline', renderStatus);
    }

    $('#carregando').hidden = true;
    $('#app').removeAttribute('aria-busy');
    if (typeof Chart === 'undefined') {
      LC.UI.aviso('A biblioteca de gráficos não carregou. Confira se a pasta vendor/ está junto do index.html.', { tipo: 'erro', duracao: 0 });
    }
    render();
    if (trouxe) {
      agendarSalvar();
      LC.UI.aviso('Os valores que estavam neste navegador foram para o livro-caixa na nuvem.', { tipo: 'ok', duracao: 8000 });
    }
  }

  window.LivroCaixa = app; // ajuda a inspecionar pelo console do navegador
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})(globalThis.LC = globalThis.LC || {});
