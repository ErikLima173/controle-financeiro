/*
 * planilha.js — A grade de lançamentos, com cara e teclado de planilha.
 *
 *   setas movem a célula ativa · Enter/F2 ou digitar começa a editar
 *   Enter confirma e desce · Tab confirma e anda · Esc cancela
 *   coluna Saldo = saldo corrido do livro-caixa (só faz sentido ordenado por data)
 */
(function (LC) {
  'use strict';

  const { el, icone, esvaziar, fmt } = LC;
  const Dd = LC.Dados;
  const POR_PAGINA = 200;

  const COLUNAS = [
    { campo: 'data', titulo: 'Data', classe: 'c-data' },
    { campo: 'descricao', titulo: 'Descrição', classe: 'c-desc' },
    { campo: 'categoria', titulo: 'Categoria', classe: 'c-cat' },
    { campo: 'tipo', titulo: 'Tipo', classe: 'c-tipo' },
    { campo: 'valor', titulo: 'Valor', classe: 'c-valor num' },
    { campo: 'pessoa', titulo: 'Pessoa', classe: 'c-pessoa' },
    { campo: 'situacao', titulo: 'Situação', classe: 'c-sit' },
    { campo: 'saldo', titulo: 'Saldo', classe: 'c-saldo num', leitura: true },
    { campo: 'obs', titulo: 'Observação', classe: 'c-obs' },
  ];
  const EDITAVEIS = COLUNAS.filter((c) => !c.leitura).map((c) => c.campo);

  function criar(raiz, ctx) {
    const prefs = ctx.prefs();
    const vista = {
      busca: '', tipo: 'todos', categoria: 'todas',
      ordem: prefs.ordemPlanilha || { campo: 'data', dir: 'desc' },
      limite: POR_PAGINA,
      selecionados: new Set(),
      ativo: null, // { id, campo }
      editando: null,
      novaLinha: null,
    };
    let linhasVisiveis = [];
    let saldoCorrido = new Map();

    // ── Estrutura fixa ────────────────────────────────────────────────────
    const busca = el('input', { id: 'pl-busca', class: 'entrada entrada-busca', type: 'search', placeholder: 'Buscar descrição, categoria, pessoa ou valor', autocomplete: 'off', 'aria-label': 'Buscar lançamentos' });
    busca.addEventListener('input', LC.adiar(() => { vista.busca = busca.value; vista.limite = POR_PAGINA; render(); }, 150));
    const filtroTipo = LC.UI.selecao('pl-tipo', [['todos', 'Todos os tipos'], ['despesa', 'Despesas'], ['receita', 'Receitas'], ['transferencia', 'Transferências']], vista.tipo,
      (v) => { vista.tipo = v; vista.limite = POR_PAGINA; render(); }, { 'aria-label': 'Filtrar por tipo' });
    const filtroCategoria = el('select', { id: 'pl-categoria', class: 'entrada', 'aria-label': 'Filtrar por categoria' });
    filtroCategoria.addEventListener('change', () => { vista.categoria = filtroCategoria.value; vista.limite = POR_PAGINA; render(); });

    const barraLote = el('div', { class: 'barra-lote', hidden: true, role: 'region', 'aria-label': 'Ações nos lançamentos selecionados' });
    const refCelula = el('span', { class: 'fx-ref', 'aria-label': 'Célula ativa' }, '—');
    const valorCelula = el('span', { class: 'fx-valor' });
    const barraFormula = el('div', { class: 'barra-formula', 'aria-hidden': 'true' }, refCelula, el('span', { class: 'fx-rotulo', text: 'fx' }), valorCelula);
    const tabela = el('table', { class: 'grade', role: 'grid', 'aria-label': 'Lançamentos', 'aria-rowcount': '0' });
    const rolagem = el('div', { class: 'grade-rolagem' }, tabela);
    const vazio = el('div', { class: 'grade-vazia', hidden: true });
    const rodape = el('div', { class: 'grade-rodape' });
    const status = el('div', { class: 'barra-status' });
    const sugestoes = el('datalist', { id: 'sugestoes-descricao' });

    raiz.append(
      el('div', { class: 'planilha-ferramentas' },
        el('div', { class: 'ferramentas-filtros' }, el('div', { class: 'busca-envolucro' }, icone('busca', 'ico ico-busca'), busca), filtroTipo, filtroCategoria),
        el('div', { class: 'ferramentas-acoes' },
          el('button', { type: 'button', class: 'botao', onclick: () => novaLinha() }, icone('linha-nova'), 'Nova linha'),
          el('button', { type: 'button', class: 'botao botao-primario', onclick: () => ctx.novoLancamento() }, icone('adicionar'), 'Lançamento'))),
      barraLote,
      el('div', { class: 'cartao planilha' }, barraFormula, rolagem, vazio, rodape, status),
      sugestoes);

    // ── Dados da vista ────────────────────────────────────────────────────
    function calcularLinhas() {
      const est = ctx.estado();
      const f = ctx.filtro();
      const cats = Dd.mapaPorId(est.categorias), pessoas = Dd.mapaPorId(est.pessoas);
      const termo = LC.dobrar(vista.busca);
      let lista = Dd.filtrar(est, f);
      if (vista.tipo !== 'todos') lista = lista.filter((t) => t.tipo === vista.tipo);
      if (vista.categoria !== 'todas') lista = lista.filter((t) => t.categoria === vista.categoria);
      if (termo) {
        lista = lista.filter((t) => LC.dobrar([t.descricao, cats.get(t.categoria)?.nome, pessoas.get(t.pessoa)?.nome,
          pessoas.get(t.destino)?.nome, t.obs, fmt.moeda(t.valor), fmt.data(t.data)].join(' ')).includes(termo));
      }
      const posicao = new Map(est.lancamentos.map((t, i) => [t.id, i]));
      const { campo, dir } = vista.ordem;
      const sinal = dir === 'asc' ? 1 : -1;
      const nome = (mapa, id) => mapa.get(id)?.nome || '';
      const chave = {
        data: (t) => t.data,
        descricao: (t) => LC.dobrar(t.descricao),
        categoria: (t) => LC.dobrar(t.tipo === 'transferencia' ? nome(pessoas, t.destino) : nome(cats, t.categoria)),
        tipo: (t) => t.tipo,
        valor: (t) => (t.tipo === 'receita' ? t.valor : -t.valor),
        pessoa: (t) => LC.dobrar(nome(pessoas, t.pessoa)),
        situacao: (t) => t.situacao,
        saldo: (t) => t.data,
        obs: (t) => LC.dobrar(t.obs || ''),
      }[campo] || ((t) => t.data);
      lista.sort((a, b) => {
        const x = chave(a), y = chave(b);
        if (x < y) return -sinal;
        if (x > y) return sinal;
        return (posicao.get(a.id) - posicao.get(b.id)) * sinal;
      });
      if (vista.novaLinha) { // a linha recém-criada fica no topo até ser preenchida
        const i = lista.findIndex((t) => t.id === vista.novaLinha);
        if (i > 0) lista.unshift(...lista.splice(i, 1));
      }
      return lista;
    }

    function calcularSaldoCorrido() {
      const est = ctx.estado();
      const f = ctx.filtro();
      const pessoas = new Set(f.pessoa === 'todas' ? est.pessoas.map((c) => c.id) : [f.pessoa]);
      let saldo = est.pessoas.filter((c) => pessoas.has(c.id)).reduce((s, c) => s + c.saldoInicial, 0);
      const ordem = est.lancamentos.map((t, i) => [t, i])
        .filter(([t]) => f.situacao === 'todas' || t.situacao === f.situacao)
        .sort((a, b) => (a[0].data < b[0].data ? -1 : a[0].data > b[0].data ? 1 : a[1] - b[1]));
      const mapa = new Map();
      for (const [t] of ordem) {
        saldo += Dd.efeito(t, pessoas);
        mapa.set(t.id, LC.arred(saldo));
      }
      return mapa;
    }

    // ── Desenho das células ───────────────────────────────────────────────
    function conteudoCelula(t, campo, est, hoje) {
      switch (campo) {
        case 'data': return el('span', { class: 'tab-num', text: fmt.data(t.data) });
        case 'descricao': return [el('span', { class: 'desc-texto', text: t.descricao || 'Sem descrição' }), t.exemplo ? el('span', { class: 'etiqueta etiqueta-exemplo', text: 'exemplo' }) : null];
        case 'categoria': {
          if (t.tipo === 'transferencia') {
            const c = est.pessoas.find((x) => x.id === t.destino);
            return el('span', { class: 'item-cor' }, icone('seta-dir', 'ico ico-mini'), el('span', { text: c ? c.nome : '—' }));
          }
          const c = est.categorias.find((x) => x.id === t.categoria);
          return el('span', { class: 'item-cor' }, el('span', { class: 'ponto', style: { background: LC.cor(c?.cor) } }), el('span', { text: c ? c.nome : '—' }));
        }
        case 'tipo': return el('span', { class: `chip-tipo chip-${t.tipo}` }, icone(t.tipo === 'receita' ? 'entrada' : t.tipo === 'despesa' ? 'saida' : 'transferencia', 'ico ico-mini'), Dd.ROTULO_TIPO[t.tipo]);
        case 'valor': {
          const texto = t.tipo === 'receita' ? '+' + fmt.moeda(t.valor) : t.tipo === 'despesa' ? '−' + fmt.moeda(t.valor) : fmt.moeda(t.valor);
          return el('span', { class: `valor valor-${t.tipo}${t.valor === 0 ? ' valor-zero' : ''}`, text: texto });
        }
        case 'pessoa': {
          const c = est.pessoas.find((x) => x.id === t.pessoa);
          return el('span', { class: 'item-cor' }, el('span', { class: 'ponto', style: { background: LC.cor(c?.cor) } }), el('span', { text: c ? c.nome : '—' }));
        }
        case 'situacao': {
          const vencido = t.situacao === 'pendente' && t.data < hoje && t.tipo !== 'transferencia';
          const rotulo = vencido ? 'Vencido' : Dd.ROTULO_SITUACAO[t.tipo][t.situacao];
          return el('span', { class: `chip-situacao ${vencido ? 'sit-vencido' : 'sit-' + t.situacao}`, title: 'Clique ou tecle Enter para alternar' },
            icone(vencido ? 'alerta' : t.situacao === 'pago' ? 'check' : 'relogio', 'ico ico-mini'), rotulo);
        }
        case 'saldo': {
          if (vista.ordem.campo !== 'data' && vista.ordem.campo !== 'saldo') return el('span', { class: 'apagado', text: '—' });
          const v = saldoCorrido.get(t.id);
          return el('span', { class: 'tab-num' + (v < 0 ? ' negativo' : ''), text: v == null ? '—' : fmt.moeda(v) });
        }
        case 'obs': return el('span', { class: 'obs-texto', text: t.obs || '' });
        default: return '';
      }
    }

    function valorBruto(t, campo, est) {
      switch (campo) {
        case 'data': return fmt.data(t.data);
        case 'valor': return (t.tipo === 'despesa' ? '−' : '') + LC.fmt.numero(t.valor);
        case 'categoria': return t.tipo === 'transferencia' ? '→ ' + (est.pessoas.find((c) => c.id === t.destino)?.nome || '') : est.categorias.find((c) => c.id === t.categoria)?.nome || '';
        case 'pessoa': return est.pessoas.find((c) => c.id === t.pessoa)?.nome || '';
        case 'tipo': return Dd.ROTULO_TIPO[t.tipo];
        case 'situacao': return Dd.ROTULO_SITUACAO[t.tipo][t.situacao];
        case 'saldo': return saldoCorrido.has(t.id) ? fmt.moeda(saldoCorrido.get(t.id)) : '';
        default: return t[campo] || '';
      }
    }

    // ── Render ────────────────────────────────────────────────────────────
    function render() {
      const est = ctx.estado();
      const hoje = ctx.hoje();
      const focoNaGrade = tabela.contains(document.activeElement);
      linhasVisiveis = calcularLinhas();
      saldoCorrido = calcularSaldoCorrido();
      const ids = new Set(est.lancamentos.map((t) => t.id));
      for (const id of [...vista.selecionados]) if (!ids.has(id)) vista.selecionados.delete(id);

      // filtro de categorias acompanha os cadastros
      esvaziar(filtroCategoria);
      filtroCategoria.append(el('option', { value: 'todas' }, 'Todas as categorias'));
      for (const tipo of ['despesa', 'receita']) {
        const g = el('optgroup', { label: tipo === 'despesa' ? 'Despesas' : 'Receitas' });
        for (const c of est.categorias.filter((x) => x.tipo === tipo)) g.append(el('option', { value: c.id }, c.nome));
        filtroCategoria.append(g);
      }
      filtroCategoria.value = est.categorias.some((c) => c.id === vista.categoria) ? vista.categoria : 'todas';

      esvaziar(sugestoes);
      const vistas = new Set();
      for (let i = est.lancamentos.length - 1; i >= 0 && vistas.size < 300; i--) {
        const d = est.lancamentos[i].descricao;
        if (d && !vistas.has(d)) { vistas.add(d); sugestoes.append(el('option', { value: d })); }
      }

      const pagina = linhasVisiveis.slice(0, vista.limite);
      esvaziar(tabela);
      const todosMarcados = pagina.length > 0 && pagina.every((t) => vista.selecionados.has(t.id));
      const marcaTodos = el('input', { type: 'checkbox', class: 'marca', 'aria-label': 'Selecionar todos os lançamentos visíveis', checked: todosMarcados });
      marcaTodos.addEventListener('change', () => {
        for (const t of pagina) if (marcaTodos.checked) vista.selecionados.add(t.id); else vista.selecionados.delete(t.id);
        render();
      });
      const letras = el('tr', { class: 'linha-letras', 'aria-hidden': 'true' }, el('th', { class: 'c-num' }),
        COLUNAS.map((_, i) => el('th', { text: LC.letraColuna(i) })), el('th', { class: 'c-acoes' }));
      const titulos = el('tr', { class: 'linha-titulos' }, el('th', { class: 'c-num', scope: 'col' }, marcaTodos),
        COLUNAS.map((c) => {
          const ativa = vista.ordem.campo === c.campo;
          return el('th', { class: c.classe, scope: 'col', 'aria-sort': ativa ? (vista.ordem.dir === 'asc' ? 'ascending' : 'descending') : null },
            el('button', {
              type: 'button', class: 'ordenar' + (ativa ? ' ativa' : ''), title: 'Ordenar por ' + c.titulo.toLowerCase(),
              onclick: () => {
                vista.ordem = { campo: c.campo, dir: ativa && vista.ordem.dir === 'desc' ? 'asc' : ativa ? 'desc' : c.campo === 'data' || c.campo === 'valor' ? 'desc' : 'asc' };
                ctx.salvarPrefs({ ordemPlanilha: vista.ordem });
                render();
              },
            }, el('span', { text: c.titulo }), icone(ativa && vista.ordem.dir === 'asc' ? 'seta-cima' : 'seta-baixo', 'ico ico-ordem')));
        }),
        el('th', { class: 'c-acoes' }, el('span', { class: 'visualmente-oculto', text: 'Ações' })));
      tabela.append(el('thead', null, letras, titulos));

      const corpo = el('tbody');
      pagina.forEach((t, i) => {
        const marcado = vista.selecionados.has(t.id);
        const marca = el('input', { type: 'checkbox', class: 'marca', checked: marcado, 'aria-label': 'Selecionar ' + (t.descricao || 'lançamento') });
        marca.addEventListener('change', () => { if (marca.checked) vista.selecionados.add(t.id); else vista.selecionados.delete(t.id); atualizarLote(); tr.classList.toggle('selecionada', marca.checked); });
        const tr = el('tr', { class: (marcado ? 'selecionada ' : '') + (t.situacao === 'pendente' ? 'pendente' : ''), dataset: { id: t.id }, 'aria-rowindex': String(i + 3) },
          el('th', { class: 'c-num', scope: 'row' }, el('span', { class: 'num-linha', text: String(i + 1) }), marca));
        for (const c of COLUNAS) {
          tr.append(el('td', { class: c.classe + (c.leitura ? ' leitura' : ''), dataset: { campo: c.campo }, tabindex: '-1', role: 'gridcell', 'aria-readonly': c.leitura ? 'true' : null },
            conteudoCelula(t, c.campo, est, hoje)));
        }
        const acoes = el('button', { type: 'button', class: 'botao-icone botao-linha', 'aria-label': 'Ações do lançamento', title: 'Mais ações', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icone('mais'));
        acoes.addEventListener('click', () => LC.UI.menu(acoes, [
          { rotulo: 'Abrir no formulário', icone: 'editar', acao: () => ctx.editarLancamento(t.id) },
          { rotulo: 'Duplicar', icone: 'copiar', acao: () => duplicar(t.id) },
          { rotulo: t.situacao === 'pago' ? 'Marcar como pendente' : 'Marcar como pago', icone: t.situacao === 'pago' ? 'relogio' : 'check', acao: () => alternarSituacao(t.id) },
          { separador: true },
          { rotulo: 'Excluir', icone: 'lixeira', perigo: true, acao: () => ctx.excluir([t.id]) },
        ]));
        tr.append(el('td', { class: 'c-acoes' }, acoes));
        corpo.append(tr);
      });
      tabela.append(corpo);
      tabela.setAttribute('aria-rowcount', String(linhasVisiveis.length + 2));

      // Linha de totais da vista (como o rodapé de uma planilha)
      const t = Dd.totais(linhasVisiveis);
      tabela.append(el('tfoot', null, el('tr', null, el('th', { class: 'c-num' }), el('th', { colspan: '4', class: 'tfoot-rotulo', text: `${linhasVisiveis.length} ${linhasVisiveis.length === 1 ? 'lançamento' : 'lançamentos'}` }),
        el('td', { class: 'num' }, el('span', { class: 'tfoot-par' }, el('span', { class: 'valor-receita', text: '+' + fmt.moeda(t.receitas) }), el('span', { text: '−' + fmt.moeda(t.despesas) }))),
        el('td', { colspan: '2', class: 'tfoot-rotulo', text: 'Resultado' }),
        el('td', { class: 'num' }, el('strong', { class: t.resultado < 0 ? 'negativo' : '', text: fmt.moeda(t.resultado) })),
        el('td', { colspan: '2' }))));

      vazio.hidden = linhasVisiveis.length > 0;
      rolagem.hidden = linhasVisiveis.length === 0;
      if (!linhasVisiveis.length) {
        esvaziar(vazio);
        const temFiltro = vista.busca || vista.tipo !== 'todos' || vista.categoria !== 'todas';
        vazio.append(icone('lancamentos', 'ico ico-grande'),
          el('strong', { text: est.lancamentos.length ? 'Nenhum lançamento com esses filtros' : 'Nenhum lançamento ainda' }),
          el('span', { text: est.lancamentos.length ? (temFiltro ? 'Limpe a busca ou os filtros acima, ou mude o período no topo.' : 'Mude o período no topo da página.') : 'Adicione o primeiro lançamento ou importe uma planilha do Excel, CSV ou extrato OFX.' }),
          el('div', { class: 'grupo-botoes' },
            temFiltro ? el('button', { type: 'button', class: 'botao', onclick: limparFiltros }, 'Limpar filtros') : null,
            el('button', { type: 'button', class: 'botao botao-primario', onclick: () => ctx.novoLancamento() }, icone('adicionar'), 'Novo lançamento'),
            !est.lancamentos.length ? el('button', { type: 'button', class: 'botao', onclick: () => ctx.importar() }, icone('importar'), 'Importar planilha') : null));
      }

      esvaziar(rodape);
      if (linhasVisiveis.length > vista.limite) {
        rodape.append(el('button', { type: 'button', class: 'botao botao-fantasma', onclick: () => { vista.limite += POR_PAGINA; render(); } },
          linhasVisiveis.length - vista.limite <= POR_PAGINA ? `Mostrar os ${linhasVisiveis.length - vista.limite} restantes`
            : `Mostrar mais ${POR_PAGINA} (faltam ${linhasVisiveis.length - vista.limite})`));
      }

      atualizarLote();
      atualizarStatus();
      if (vista.ativo && !linhasVisiveis.some((x) => x.id === vista.ativo.id)) vista.ativo = null;
      if (!vista.ativo && pagina.length) vista.ativo = { id: pagina[0].id, campo: 'descricao' };
      marcarAtiva(focoNaGrade);
    }

    function limparFiltros() {
      vista.busca = ''; busca.value = '';
      vista.tipo = 'todos'; filtroTipo.value = 'todos';
      vista.categoria = 'todas';
      render();
    }

    // ── Seleção, barra de fórmula e barra de status ───────────────────────
    function celula(ativo) {
      if (!ativo) return null;
      const tr = tabela.querySelector(`tbody tr[data-id="${CSS.escape(ativo.id)}"]`);
      return tr ? tr.querySelector(`td[data-campo="${ativo.campo}"]`) : null;
    }

    function marcarAtiva(focar) {
      for (const td of tabela.querySelectorAll('td.ativa')) { td.classList.remove('ativa'); td.tabIndex = -1; }
      const td = celula(vista.ativo);
      if (!td) { refCelula.textContent = '—'; valorCelula.textContent = ''; const p = tabela.querySelector('tbody td[data-campo]'); if (p) p.tabIndex = 0; return; }
      td.classList.add('ativa');
      td.tabIndex = 0;
      const linha = linhasVisiveis.findIndex((x) => x.id === vista.ativo.id);
      const col = COLUNAS.findIndex((c) => c.campo === vista.ativo.campo);
      refCelula.textContent = LC.letraColuna(col) + (linha + 1);
      const t = ctx.estado().lancamentos.find((x) => x.id === vista.ativo.id);
      valorCelula.textContent = t ? valorBruto(t, vista.ativo.campo, ctx.estado()) : '';
      if (focar) td.focus({ preventScroll: false });
    }

    function atualizarLote() {
      const n = vista.selecionados.size;
      barraLote.hidden = n === 0;
      if (!n) return;
      esvaziar(barraLote);
      const est = ctx.estado();
      const mover = el('select', { id: 'lote-categoria', class: 'entrada entrada-pequena', 'aria-label': 'Mudar categoria dos selecionados' },
        el('option', { value: '' }, 'Mudar categoria…'),
        ['despesa', 'receita'].map((tipo) => el('optgroup', { label: tipo === 'despesa' ? 'Despesas' : 'Receitas' },
          est.categorias.filter((c) => c.tipo === tipo).map((c) => el('option', { value: c.id }, c.nome)))));
      mover.addEventListener('change', () => {
        const cat = est.categorias.find((c) => c.id === mover.value);
        if (!cat) return;
        const ids = new Set(vista.selecionados);
        let n2 = 0;
        ctx.alterar((e) => {
          for (const t of e.lancamentos) if (ids.has(t.id) && t.tipo !== 'transferencia') { t.tipo = cat.tipo; t.categoria = cat.id; n2++; }
        });
        LC.UI.aviso(`${n2} ${n2 === 1 ? 'lançamento movido' : 'lançamentos movidos'} para ${cat.nome}.`, { tipo: 'ok' });
      });
      barraLote.append(
        el('strong', { text: `${n} ${n === 1 ? 'selecionado' : 'selecionados'}` }),
        el('button', { type: 'button', class: 'botao botao-pequeno', onclick: () => marcarSelecionados('pago') }, icone('check'), 'Marcar como pago'),
        el('button', { type: 'button', class: 'botao botao-pequeno', onclick: () => marcarSelecionados('pendente') }, icone('relogio'), 'Marcar como pendente'),
        mover,
        el('button', { type: 'button', class: 'botao botao-pequeno perigo', onclick: () => ctx.excluir([...vista.selecionados]) }, icone('lixeira'), 'Excluir'),
        el('button', { type: 'button', class: 'botao botao-pequeno botao-fantasma', onclick: () => { vista.selecionados.clear(); render(); } }, 'Limpar seleção'));
    }

    function marcarSelecionados(situacao) {
      const ids = new Set(vista.selecionados);
      ctx.alterar((e) => { for (const t of e.lancamentos) if (ids.has(t.id)) t.situacao = situacao; });
    }

    function atualizarStatus() {
      esvaziar(status);
      const sel = vista.selecionados.size ? ctx.estado().lancamentos.filter((t) => vista.selecionados.has(t.id)) : linhasVisiveis;
      const t = Dd.totais(sel);
      const rotulo = vista.selecionados.size ? 'Seleção' : 'Na vista';
      status.append(
        el('span', null, el('span', { class: 'apagado', text: rotulo + ' ' }), el('strong', { text: String(sel.length) })),
        el('span', null, el('span', { class: 'apagado', text: 'Receitas ' }), el('strong', { text: fmt.moeda(t.receitas) })),
        el('span', null, el('span', { class: 'apagado', text: 'Despesas ' }), el('strong', { text: fmt.moeda(t.despesas) })),
        el('span', null, el('span', { class: 'apagado', text: 'Resultado ' }), el('strong', { class: t.resultado < 0 ? 'negativo' : '', text: fmt.moeda(t.resultado) })));
    }

    // ── Edição ────────────────────────────────────────────────────────────
    function alterarLancamento(id, fn) {
      ctx.alterar((e) => {
        const t = e.lancamentos.find((x) => x.id === id);
        if (t) fn(t, e);
      });
    }

    function alternarSituacao(id) {
      alterarLancamento(id, (t) => { t.situacao = t.situacao === 'pago' ? 'pendente' : 'pago'; });
    }

    function duplicar(id) {
      const est = ctx.estado();
      const t = est.lancamentos.find((x) => x.id === id);
      if (!t) return;
      const copia = Dd.normalizarLancamento({ ...t, id: LC.novoId('l'), exemplo: false });
      ctx.alterar((e) => { e.lancamentos.push(copia); });
      vista.ativo = { id: copia.id, campo: 'data' };
      LC.UI.aviso('Lançamento duplicado.', { tipo: 'ok' });
    }

    function novaLinha() {
      const est = ctx.estado();
      const f = ctx.filtro();
      const hoje = ctx.hoje();
      const ultimo = est.lancamentos[est.lancamentos.length - 1];
      const data = hoje >= f.inicio && hoje <= f.fim ? hoje : f.fim < hoje ? f.fim : f.inicio;
      const t = Dd.normalizarLancamento({
        id: LC.novoId('l'), data, descricao: '', tipo: 'despesa', valor: 0,
        categoria: Dd.categoriaPadrao(est, 'despesa'),
        pessoa: f.pessoa !== 'todas' ? f.pessoa : ultimo && !ultimo.exemplo ? ultimo.pessoa : est.pessoas[0].id,
        situacao: f.situacao !== 'todas' ? f.situacao : data <= hoje ? 'pago' : 'pendente',
      });
      vista.busca = ''; busca.value = '';
      vista.tipo = 'todos'; filtroTipo.value = 'todos';
      vista.categoria = 'todas';
      vista.novaLinha = t.id;
      vista.ativo = { id: t.id, campo: 'descricao' };
      ctx.alterar((e) => { e.lancamentos.push(t); });
      editar('');
    }

    // Categoria aprendida: a última usada com a mesma descrição e o mesmo tipo.
    function categoriaAprendida(est, descricao, tipo, ignorar) {
      const alvo = LC.dobrar(descricao);
      if (!alvo) return null;
      for (let i = est.lancamentos.length - 1; i >= 0; i--) {
        const t = est.lancamentos[i];
        if (t.id !== ignorar && t.tipo === tipo && LC.dobrar(t.descricao) === alvo) return { categoria: t.categoria, pessoa: t.pessoa };
      }
      return null;
    }

    function editar(textoInicial) {
      const td = celula(vista.ativo);
      if (!td || vista.editando) return;
      const campo = vista.ativo.campo;
      const est = ctx.estado();
      const t = est.lancamentos.find((x) => x.id === vista.ativo.id);
      if (!t || !EDITAVEIS.includes(campo)) return;
      if (campo === 'situacao') { alternarSituacao(t.id); return; }

      let controle;
      if (campo === 'data') controle = el('input', { type: 'date', class: 'celula-entrada', value: t.data, 'aria-label': 'Data' });
      else if (campo === 'valor') controle = el('input', { type: 'text', class: 'celula-entrada num', inputmode: 'decimal', autocomplete: 'off', value: textoInicial ?? LC.fmt.numero(t.valor), 'aria-label': 'Valor' });
      else if (campo === 'descricao' || campo === 'obs') {
        controle = el('input', { type: 'text', class: 'celula-entrada', autocomplete: 'off', maxlength: campo === 'obs' ? '500' : '300', value: textoInicial ?? (t[campo] || ''), 'aria-label': campo === 'obs' ? 'Observação' : 'Descrição', list: campo === 'descricao' ? 'sugestoes-descricao' : null });
      } else if (campo === 'tipo') {
        controle = LC.UI.selecao('cel-tipo', Object.entries(Dd.ROTULO_TIPO), t.tipo, () => {}, { class: 'celula-entrada', 'aria-label': 'Tipo' });
      } else if (campo === 'pessoa') {
        controle = LC.UI.selecao('cel-pessoa', est.pessoas.map((c) => [c.id, c.nome]), t.pessoa, () => {}, { class: 'celula-entrada', 'aria-label': 'Pessoa' });
      } else if (campo === 'categoria') {
        controle = t.tipo === 'transferencia'
          ? LC.UI.selecao('cel-destino', est.pessoas.filter((c) => c.id !== t.pessoa).map((c) => [c.id, 'Para ' + c.nome]), t.destino, () => {}, { class: 'celula-entrada', 'aria-label': 'Pessoa que recebe' })
          : LC.UI.selecao('cel-categoria', est.categorias.filter((c) => c.tipo === t.tipo).map((c) => [c.id, c.nome]), t.categoria, () => {}, { class: 'celula-entrada', 'aria-label': 'Categoria' });
      }
      vista.editando = { id: t.id, campo };
      td.classList.add('editando');
      esvaziar(td).append(controle);
      controle.focus();
      if (controle.select && textoInicial == null && controle.type === 'text') controle.select();
      if (textoInicial != null && controle.setSelectionRange) controle.setSelectionRange(controle.value.length, controle.value.length);

      let encerrado = false;
      const concluir = (salvar, mover) => {
        if (encerrado) return;
        encerrado = true;
        vista.editando = null;
        const nova = vista.novaLinha === t.id;
        if (salvar) {
          const v = controle.value;
          if (campo === 'valor') {
            const n = LC.paraNumero(v);
            if (!Number.isFinite(n)) {
              LC.UI.aviso('Valor não reconhecido. Use números como 1.234,56.', { tipo: 'erro' });
              encerrado = false; vista.editando = { id: t.id, campo };
              controle.classList.add('invalida');
              controle.focus();
              return;
            }
            alterarLancamento(t.id, (x) => {
              x.valor = Math.abs(LC.arred(n));
              if (n < 0 && x.tipo === 'receita') { x.tipo = 'despesa'; x.categoria = Dd.categoriaPadrao(ctx.estado(), 'despesa'); }
            });
          } else if (campo === 'data') {
            if (LC.data.valida(v)) alterarLancamento(t.id, (x) => { x.data = v; if (x.situacao === 'pago' && v > ctx.hoje() && nova) x.situacao = 'pendente'; });
          } else if (campo === 'descricao') {
            alterarLancamento(t.id, (x, e) => {
              x.descricao = v.trim();
              const padrao = x.categoria === Dd.categoriaPadrao(e, x.tipo);
              const aprendida = x.tipo !== 'transferencia' && padrao ? categoriaAprendida(e, x.descricao, x.tipo, x.id) : null;
              if (aprendida) { x.categoria = aprendida.categoria; if (nova) x.pessoa = aprendida.pessoa; }
            });
          } else if (campo === 'obs') {
            alterarLancamento(t.id, (x) => { x.obs = v.trim(); if (!x.obs) delete x.obs; });
          } else if (campo === 'tipo') {
            alterarLancamento(t.id, (x, e) => {
              if (x.tipo === v) return;
              x.tipo = v;
              if (v === 'transferencia') { x.categoria = ''; x.destino = (e.pessoas.find((c) => c.id !== x.pessoa) || e.pessoas[0]).id; }
              else { delete x.destino; x.categoria = Dd.categoriaPadrao(e, v); }
            });
          } else if (campo === 'pessoa') {
            alterarLancamento(t.id, (x, e) => {
              x.pessoa = v;
              if (x.tipo === 'transferencia' && x.destino === v) x.destino = (e.pessoas.find((c) => c.id !== v) || e.pessoas[0]).id;
            });
          } else if (campo === 'categoria') {
            alterarLancamento(t.id, (x) => { if (x.tipo === 'transferencia') x.destino = v; else x.categoria = v; });
          }
        } else if (nova && !t.descricao && !t.valor) {
          vista.novaLinha = null;
          ctx.alterar((e) => { e.lancamentos = e.lancamentos.filter((x) => x.id !== t.id); }, { silencioso: true });
          return;
        } else {
          render();
        }
        if (mover) mover();
        marcarAtiva(true);
      };

      controle.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== 'Tab' && e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation(); // a tabela não pode receber a mesma tecla (abriria a próxima célula)
        if (e.key === 'Enter') concluir(true, () => moverAtiva(1, 0));
        else if (e.key === 'Tab') concluir(true, () => moverAtiva(0, e.shiftKey ? -1 : 1));
        else concluir(false);
      });
      controle.addEventListener('blur', () => setTimeout(() => { if (!encerrado && document.activeElement !== controle) concluir(true); }, 0));
      if (controle.tagName === 'SELECT') controle.addEventListener('change', () => concluir(true));
    }

    function moverAtiva(dLinha, dCol) {
      if (!vista.ativo) return;
      const pagina = linhasVisiveis.slice(0, vista.limite);
      let linha = pagina.findIndex((t) => t.id === vista.ativo.id);
      let col = COLUNAS.findIndex((c) => c.campo === vista.ativo.campo);
      if (linha < 0) return;
      if (vista.novaLinha && dLinha) vista.novaLinha = null;
      col += dCol;
      if (col >= COLUNAS.length) { col = 0; linha++; }
      if (col < 0) { col = COLUNAS.length - 1; linha--; }
      linha = Math.max(0, Math.min(pagina.length - 1, linha + dLinha));
      vista.ativo = { id: pagina[linha].id, campo: COLUNAS[col].campo };
      marcarAtiva(true);
    }

    // A célula clicada vira a ativa já no pointerdown: se outra estava em edição, ela confirma
    // no blur e o foco volta para a célula clicada.
    let cliqueEmAtiva = null;
    tabela.addEventListener('pointerdown', (e) => {
      const td = e.target.closest('td[data-campo]');
      if (!td || td.classList.contains('editando')) { cliqueEmAtiva = null; return; }
      const id = td.parentElement.dataset.id;
      const campo = td.dataset.campo;
      cliqueEmAtiva = !vista.editando && !!vista.ativo && vista.ativo.id === id && vista.ativo.campo === campo;
      vista.ativo = { id, campo };
    });
    tabela.addEventListener('click', (e) => {
      const td = e.target.closest('td[data-campo]');
      if (!td || vista.editando || cliqueEmAtiva === null) return;
      vista.ativo = { id: td.parentElement.dataset.id, campo: td.dataset.campo };
      marcarAtiva(true);
      if (td.dataset.campo === 'situacao' || (cliqueEmAtiva && EDITAVEIS.includes(td.dataset.campo))) editar();
      cliqueEmAtiva = null;
    });
    tabela.addEventListener('dblclick', (e) => {
      const td = e.target.closest('td[data-campo]');
      if (td && !vista.editando) editar();
    });
    tabela.addEventListener('keydown', (e) => {
      if (vista.editando || !e.target.matches('td[data-campo]')) return;
      const mapa = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] };
      if (mapa[e.key]) { e.preventDefault(); moverAtiva(...mapa[e.key]); return; }
      if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); moverAtiva(e.key === 'PageDown' ? 10 : -10, 0); return; }
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); vista.ativo.campo = COLUNAS[e.key === 'Home' ? 0 : COLUNAS.length - 1].campo; marcarAtiva(true); return; }
      if (e.key === 'Enter' || e.key === 'F2' || e.key === ' ') { e.preventDefault(); editar(); return; }
      if (e.key === 'Delete' && vista.ativo) {
        e.preventDefault();
        if (vista.ativo.campo === 'obs') alterarLancamento(vista.ativo.id, (x) => { delete x.obs; });
        else ctx.excluir([vista.ativo.id]);
        return;
      }
      const campo = vista.ativo && vista.ativo.campo;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && ['descricao', 'obs', 'valor'].includes(campo)) {
        e.preventDefault();
        editar(e.key);
      }
    });

    return {
      render,
      focarBusca() { busca.focus(); },
      novaLinha,
      definirSituacao() { render(); },
    };
  }

  LC.Planilha = { criar, COLUNAS };
})(globalThis.LC = globalThis.LC || {});
