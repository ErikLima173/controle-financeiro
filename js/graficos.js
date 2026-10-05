/*
 * graficos.js — Gráficos editáveis do painel (Chart.js) e o editor lateral.
 *
 *   cfg (o que o usuário escolheu) ─► Dados.dadosGrafico ─► montarConfig ─► Chart.js
 *   Cada cartão: legenda que liga/desliga séries, dica com valores, visão em tabela, PNG.
 *
 * Regras de desenho: barras de até 24 px com ponta arredondada e base reta, linhas de 2 px,
 * grade fina e discreta, um só eixo de valores, rótulos de valor só onde ajudam.
 */
(function (LC) {
  'use strict';

  const { el, icone, esvaziar } = LC;
  const Dd = LC.Dados;

  const TIPOS = {
    colunas: { nome: 'Colunas', icone: 'g-colunas' },
    barras: { nome: 'Barras', icone: 'g-barras' },
    linha: { nome: 'Linha', icone: 'g-linha' },
    area: { nome: 'Área', icone: 'g-area' },
    rosca: { nome: 'Rosca', icone: 'g-rosca' },
    pizza: { nome: 'Pizza', icone: 'g-pizza' },
  };
  const ALTURAS = { p: 210, m: 280, g: 370 };

  const MODELOS = [
    { titulo: 'Recebido x gasto', tipo: 'colunas', medida: 'fluxo', agrupar: 'mes', descricao: 'Como a aba Total finanças: recebido, gasto e restante' },
    { titulo: 'Gastos por categoria', tipo: 'rosca', medida: 'despesas', agrupar: 'categoria', maxItens: 6, descricao: 'Para onde vai o dinheiro' },
    { titulo: 'Gastos por pessoa', tipo: 'colunas', medida: 'despesas', agrupar: 'mes', dividir: 'pessoa', empilhar: true, descricao: 'Quanto cada um gastou, mês a mês' },
    { titulo: 'Gastos de uma pessoa', tipo: 'barras', medida: 'despesas', agrupar: 'categoria', corPorItem: true, maxItens: 8, altura: 'g', descricao: 'Escolha a pessoa em "Só estas pessoas"' },
    { titulo: 'Quanto sobrou por mês', tipo: 'colunas', medida: 'resultado', agrupar: 'mes', dividir: 'pessoa', descricao: 'Total restante de cada pessoa' },
    { titulo: '% guardado por mês', tipo: 'linha', medida: 'poupanca', agrupar: 'mes', meta: 0.2, descricao: 'Quanto do que entrou sobrou no mês' },
    { titulo: 'Orçado x gasto', tipo: 'barras', medida: 'orcamento', agrupar: 'categoria', altura: 'g', descricao: 'Quanto de cada orçamento foi usado' },
    { titulo: 'Saldo acumulado', tipo: 'area', medida: 'acumulado', agrupar: 'mes', zero: false, descricao: 'O restante de todos os meses somado' },
  ];

  // ── Tema e formatação ────────────────────────────────────────────────────

  function tema() {
    return {
      superficie: LC.token('superficie'),
      tinta: LC.token('tinta'),
      tinta2: LC.token('tinta-2'),
      apagada: LC.token('apagada'),
      grade: LC.token('grade'),
      base: LC.token('linha-base'),
      fonte: getComputedStyle(document.body).fontFamily,
    };
  }

  function formatador(unidade, curto) {
    if (unidade === 'pct') return (v) => (v == null ? '—' : LC.fmt.pct(v));
    if (unidade === 'n') return (v) => LC.fmt.numero(v);
    return curto ? LC.fmt.moedaCurta : LC.fmt.moeda;
  }

  const ehCircular = (cfg) => cfg.tipo === 'rosca' || cfg.tipo === 'pizza';
  const ultimoIndice = (v) => { for (let i = v.length - 1; i >= 0; i--) if (v[i] != null) return i; return -1; };
  const indiceMaximo = (v) => v.reduce((m, x, i) => (x != null && (m < 0 || Math.abs(x) > Math.abs(v[m])) ? i : m), -1);

  function corDaSerie(cfg, s) { return LC.cor(cfg.cores[s.chave] || s.cor); }
  function coresDosItens(dados) {
    const s = dados.series[0];
    return dados.chaves.map((k, i) => LC.cor(dados.cfg.cores[k] || (dados.coresItens ? dados.coresItens[i] : s.cor)));
  }

  // ── Plugins de desenho ───────────────────────────────────────────────────

  const pluginCruz = { // linha vertical que acompanha o ponteiro em linhas e áreas
    id: 'cruzLC',
    beforeDatasetsDraw(chart, _a, o) {
      if (!o || !o.ativo) return;
      const ativos = chart.getActiveElements();
      if (!ativos.length) return;
      const { ctx, chartArea: a } = chart;
      const x = Math.round(ativos[0].element.x) + 0.5;
      ctx.save();
      ctx.strokeStyle = o.cor;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
      ctx.restore();
    },
  };

  const pluginMeta = { // linha de referência tracejada: aqui o tracejado significa "meta"
    id: 'metaLC',
    afterDatasetsDraw(chart, _a, o) {
      if (!o || o.valor == null) return;
      const escala = chart.scales[o.horizontal ? 'x' : 'y'];
      if (!escala) return;
      const p = Math.round(escala.getPixelForValue(o.valor)) + 0.5;
      const { ctx, chartArea: a } = chart;
      if (o.horizontal ? p < a.left || p > a.right : p < a.top || p > a.bottom) return;
      ctx.save();
      ctx.strokeStyle = o.cor; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      if (o.horizontal) { ctx.moveTo(p, a.top); ctx.lineTo(p, a.bottom); } else { ctx.moveTo(a.left, p); ctx.lineTo(a.right, p); }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `600 11px ${o.fonte}`;
      ctx.fillStyle = o.corTexto;
      const texto = 'Meta ' + o.formatar(o.valor);
      if (o.horizontal) { ctx.textAlign = 'left'; ctx.fillText(texto, Math.min(p + 6, a.right - ctx.measureText(texto).width), a.top + 10); }
      else { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(texto, a.right, p - 4); }
      ctx.restore();
    },
  };

  const pluginCentro = { // total no miolo da rosca
    id: 'centroLC',
    afterDatasetsDraw(chart, _a, o) {
      if (!o || !o.ativo) return;
      const arco = chart.getDatasetMeta(0).data[0];
      if (!arco || arco.innerRadius < 42) return;
      const valores = chart.data.datasets[0].data;
      const total = valores.reduce((s, v, i) => s + (chart.getDataVisibility(i) ? v || 0 : 0), 0);
      const { ctx } = chart;
      const texto = o.formatar(total);
      let tam = Math.min(20, Math.floor(arco.innerRadius / 3.6));
      ctx.save();
      ctx.font = `600 ${tam}px ${o.fonte}`;
      while (ctx.measureText(texto).width > arco.innerRadius * 1.7 && tam > 11) { tam--; ctx.font = `600 ${tam}px ${o.fonte}`; }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = o.cor;
      ctx.fillText(texto, arco.x, arco.y - 7);
      ctx.font = `500 11px ${o.fonte}`;
      ctx.fillStyle = o.corApagada;
      ctx.fillText('total', arco.x, arco.y + tam / 2 + 5);
      ctx.restore();
    },
  };

  const pluginRotulos = { // valores escritos no gráfico: nenhum, só os destaques, ou todos
    id: 'rotulosLC',
    afterDatasetsDraw(chart, _a, o) {
      if (!o || o.modo === 'nenhum' || chart.config.type === 'doughnut') return;
      const { ctx, chartArea: a } = chart;
      const visiveis = chart.data.datasets.map((_, i) => i).filter((i) => chart.isDatasetVisible(i));
      const barras = visiveis.filter((i) => chart.getDatasetMeta(i).type === 'bar');
      const linhas = visiveis.filter((i) => chart.getDatasetMeta(i).type === 'line');
      ctx.save();
      ctx.font = `500 11px ${o.fonte}`;
      ctx.fillStyle = o.cor;
      const escrever = (texto, x, y, alinhar, base = 'middle') => {
        ctx.textAlign = alinhar; ctx.textBaseline = base;
        const w = ctx.measureText(texto).width;
        let xx = x;
        if (alinhar === 'center') xx = Math.max(a.left + w / 2, Math.min(a.right - w / 2, x));
        if (alinhar === 'left' && x + w > a.right + o.folgaDireita) return;
        ctx.fillText(texto, xx, Math.max(a.top - 10, y));
      };

      if (o.empilhado && barras.length > 1) { // pilhas: total no topo
        const n = chart.data.labels.length;
        const totais = Array.from({ length: n }, (_, j) => barras.reduce((s, i) => s + (chart.data.datasets[i].data[j] || 0), 0));
        const alvo = o.modo === 'todos' ? totais.map((_, j) => j) : [indiceMaximo(totais)];
        const slot = (o.horizontal ? a.bottom - a.top : a.right - a.left) / Math.max(1, n);
        for (const j of alvo) {
          if (j < 0 || !totais[j]) continue;
          const topo = barras.map((i) => chart.getDatasetMeta(i).data[j]).filter(Boolean);
          const texto = o.formatar(totais[j]);
          if (o.horizontal) escrever(texto, Math.max(...topo.map((e) => e.x)) + 6, topo[0].y, 'left');
          else if (ctx.measureText(texto).width <= slot + 4 || o.modo !== 'todos') escrever(texto, topo[0].x, Math.min(...topo.map((e) => e.y)) - 8, 'center');
        }
      } else {
        for (const i of barras) {
          if (o.modo === 'destaques' && barras.length > 1) break;
          const meta = chart.getDatasetMeta(i);
          const valores = chart.data.datasets[i].data;
          const alvo = o.modo === 'todos' ? valores.map((_, j) => j) : [indiceMaximo(valores)];
          for (const j of alvo) {
            const e = meta.data[j], v = valores[j];
            if (!e || v == null || v === 0) continue;
            const texto = o.formatar(v);
            if (o.horizontal) escrever(texto, v >= 0 ? e.x + 6 : e.x - 6, e.y, v >= 0 ? 'left' : 'right');
            else {
              const larg = e.width + (barras.length > 1 ? 4 : 18);
              if (o.modo === 'todos' && ctx.measureText(texto).width > larg) continue;
              escrever(texto, e.x, v >= 0 ? e.y - 8 : e.y + 10, 'center');
            }
          }
        }
      }
      if (!(o.modo === 'destaques' && (linhas.length > 4 || barras.length))) {
        for (const i of linhas) {
          const meta = chart.getDatasetMeta(i);
          const valores = chart.data.datasets[i].data;
          const alvo = o.modo === 'todos' ? valores.map((_, j) => j) : [ultimoIndice(valores)];
          for (const j of alvo) {
            const e = meta.data[j], v = valores[j];
            if (!e || v == null) continue;
            const acima = e.y - 12 > a.top;
            escrever(o.formatar(v), e.x, acima ? e.y - 12 : e.y + 14, j === valores.length - 1 && o.modo !== 'todos' ? 'right' : 'center');
          }
        }
      }
      ctx.restore();
    },
  };

  let registrado = false;
  function registrar() {
    if (registrado || typeof Chart === 'undefined') return;
    Chart.register(pluginCruz, pluginMeta, pluginCentro, pluginRotulos);
    registrado = true;
  }

  // ── Configuração do Chart.js ─────────────────────────────────────────────

  function montarConfig(dados, { animar = false, dica = null } = {}) {
    const { cfg } = dados;
    const t = tema();
    const longo = formatador(dados.unidade, false), curto = formatador(dados.unidade, true);
    const animacao = animar && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? { duration: 420, easing: 'easeOutCubic' } : false;

    if (ehCircular(cfg)) {
      const s = dados.series[0];
      return {
        type: 'doughnut',
        data: {
          labels: dados.rotulos,
          datasets: [{ data: s.valores.map((v) => Math.max(0, v || 0)), backgroundColor: coresDosItens(dados), borderColor: t.superficie, borderWidth: 2, hoverOffset: 6, _chave: s.chave }],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: animacao,
          cutout: cfg.tipo === 'rosca' ? '64%' : 0,
          layout: { padding: 8 },
          interaction: { mode: 'nearest', intersect: true },
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false, external: dica ? dicaExterna(dica, dados) : undefined },
            centroLC: { ativo: cfg.tipo === 'rosca', formatar: curto, cor: t.tinta, corApagada: t.apagada, fonte: t.fonte },
          },
        },
      };
    }

    const horizontal = cfg.tipo === 'barras';
    const tudoLinha = cfg.tipo === 'linha' || cfg.tipo === 'area';
    const porItem = cfg.corPorItem && dados.series.length === 1 && dados.coresItens && !tudoLinha;
    const nBarras = dados.series.filter((s) => !(tudoLinha || s.marca === 'linha')).length;
    const datasets = dados.series.map((s, i) => {
      const cor = corDaSerie(cfg, s);
      if (tudoLinha || s.marca === 'linha') {
        return {
          type: 'line', label: s.nome, data: s.valores, _chave: s.chave,
          borderColor: cor, backgroundColor: cfg.tipo === 'area' ? LC.comAlfa(cor, 0.12) : cor,
          fill: cfg.tipo === 'area' ? (cfg.empilhar && i > 0 ? '-1' : 'origin') : false,
          borderWidth: 2, borderCapStyle: 'round', borderJoinStyle: 'round', tension: cfg.suave ? 0.35 : 0,
          pointRadius: (ctx) => (ctx.dataIndex === ultimoIndice(ctx.dataset.data) ? 4 : 0),
          pointHoverRadius: 5, pointHitRadius: 14,
          pointBackgroundColor: cor, pointBorderColor: t.superficie, pointBorderWidth: 2, pointHoverBorderWidth: 2,
          spanGaps: true, order: 0, stack: cfg.tipo === 'area' && cfg.empilhar ? 'a' : `l${i}`,
        };
      }
      return {
        type: 'bar', label: s.nome, data: s.valores, _chave: s.chave,
        backgroundColor: porItem ? coresDosItens(dados) : cor,
        borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24,
        borderColor: t.superficie, borderWidth: cfg.empilhar && nBarras > 1 ? (horizontal ? { right: 2 } : { top: 2 }) : 0,
        categoryPercentage: nBarras > 1 && !cfg.empilhar ? 0.74 : 0.7, barPercentage: nBarras > 1 && !cfg.empilhar ? 0.92 : 0.84,
        order: 1, stack: cfg.empilhar ? 'b' : `b${i}`,
      };
    });

    const todosValores = dados.series.flatMap((s) => s.valores).filter((v) => v != null);
    const maior = todosValores.length ? Math.max(...todosValores) : 0;
    const eixoValor = {
      beginAtZero: tudoLinha ? cfg.zero : true,
      stacked: cfg.empilhar,
      suggestedMax: cfg.meta != null && cfg.meta > maior ? cfg.meta * 1.08 : undefined,
      grid: { display: cfg.grade, color: t.grade, lineWidth: 1, drawTicks: false },
      border: { display: false },
      ticks: { color: t.apagada, padding: 8, maxTicksLimit: 6, callback: (v) => curto(v), font: { size: 11 } },
    };
    const eixoCategoria = {
      stacked: cfg.empilhar,
      offset: !tudoLinha,
      grid: { display: false },
      border: { display: true, color: t.base, width: 1 },
      ticks: { color: t.apagada, padding: 6, autoSkip: true, autoSkipPadding: 14, maxRotation: 0, font: { size: 11 } },
    };
    const comRotulos = cfg.rotulos !== 'nenhum';
    return {
      type: 'bar',
      data: { labels: dados.rotulos, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: animacao,
        indexAxis: horizontal ? 'y' : 'x',
        interaction: { mode: 'index', intersect: false, axis: horizontal ? 'y' : 'x' },
        layout: { padding: { top: comRotulos && !horizontal ? 20 : 8, right: horizontal && comRotulos ? 64 : comRotulos && tudoLinha ? 8 : 4, left: 0, bottom: 0 } },
        scales: horizontal ? { x: eixoValor, y: eixoCategoria } : { x: eixoCategoria, y: eixoValor },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false, external: dica ? dicaExterna(dica, dados) : undefined },
          cruzLC: { ativo: !horizontal && datasets.some((d) => d.type === 'line'), cor: t.base },
          metaLC: { valor: cfg.meta, horizontal, cor: t.tinta2, corTexto: t.tinta2, fonte: t.fonte, formatar: curto },
          rotulosLC: { modo: cfg.rotulos, horizontal, empilhado: cfg.empilhar, formatar: curto, cor: t.tinta2, fonte: t.fonte, folgaDireita: 60 },
        },
      },
    };
  }

  // Dica (tooltip) em HTML: o valor primeiro, o nome depois, chave em traço da cor da série.
  function dicaExterna(caixa, dados) {
    const formatar = formatador(dados.unidade, false);
    return ({ chart, tooltip }) => {
      if (!tooltip || tooltip.opacity === 0 || !tooltip.dataPoints || !tooltip.dataPoints.length) { caixa.hidden = true; return; }
      esvaziar(caixa);
      const circular = chart.config.type === 'doughnut';
      const pontos = tooltip.dataPoints;
      caixa.append(el('div', { class: 'dica-titulo', text: circular ? pontos[0].label : tooltip.title?.[0] || '' }));
      const total = circular ? chart.data.datasets[0].data.reduce((s, v, i) => s + (chart.getDataVisibility(i) ? v : 0), 0) : 0;
      for (const p of pontos) {
        const ds = chart.data.datasets[p.datasetIndex];
        const cor = Array.isArray(ds.backgroundColor) ? ds.backgroundColor[p.dataIndex] : ds.type === 'line' ? ds.borderColor : ds.backgroundColor;
        const v = p.raw;
        caixa.append(el('div', { class: 'dica-linha' },
          el('span', { class: 'dica-chave', style: { background: cor } }),
          el('strong', { text: formatar(v) }),
          el('span', { class: 'dica-nome', text: circular ? (total ? LC.fmt.pct(v / total) + ' do total' : '') : ds.label })));
      }
      if (!circular && dados.cfg.empilhar && pontos.length > 1) {
        const soma = pontos.reduce((s, p) => s + (p.raw || 0), 0);
        caixa.append(el('div', { class: 'dica-linha dica-total' }, el('span', { class: 'dica-chave vazia' }), el('strong', { text: formatar(soma) }), el('span', { class: 'dica-nome', text: 'Total' })));
      }
      caixa.hidden = false;
      const pai = caixa.parentElement;
      const larg = caixa.offsetWidth, alt = caixa.offsetHeight;
      const base = chart.canvas.getBoundingClientRect(), ref = pai.getBoundingClientRect();
      const cx = base.left - ref.left + tooltip.caretX, cy = base.top - ref.top + tooltip.caretY;
      let x = cx + 14;
      if (x + larg > pai.clientWidth - 4) x = cx - larg - 14;
      x = Math.max(4, x);
      const y = Math.max(4, Math.min(cy - alt / 2, pai.clientHeight - alt - 4));
      caixa.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };
  }

  // ── Legenda, tabela e imagem ─────────────────────────────────────────────

  function legenda(container, chart, dados) {
    esvaziar(container);
    const { cfg } = dados;
    if (!chart || dados.vazio) { container.hidden = true; return; }
    if (ehCircular(cfg)) {
      const formatar = formatador(dados.unidade, false);
      const valores = chart.data.datasets[0].data;
      const total = valores.reduce((s, v) => s + v, 0);
      const cores = chart.data.datasets[0].backgroundColor;
      dados.rotulos.forEach((rotulo, i) => {
        const ligado = chart.getDataVisibility(i);
        container.append(el('button', {
          type: 'button', class: 'leg-item leg-linha-item', 'aria-pressed': ligado ? 'true' : 'false',
          title: ligado ? 'Ocultar do gráfico' : 'Mostrar no gráfico',
          onclick: () => { chart.toggleDataVisibility(i); chart.update(); legenda(container, chart, dados); },
        }, el('span', { class: 'leg-marca', style: { background: cores[i] } }), el('span', { class: 'leg-nome', text: rotulo }),
        el('span', { class: 'leg-valor', text: formatar(valores[i]) }),
        el('span', { class: 'leg-pct', text: total ? LC.fmt.pct(valores[i] / total) : '' })));
      });
      container.hidden = !cfg.legenda;
      container.classList.add('leg-lista');
      return;
    }
    container.classList.remove('leg-lista');
    if (dados.series.length < 2 || !cfg.legenda) { container.hidden = true; return; }
    chart.data.datasets.forEach((ds, i) => {
      const ligado = chart.isDatasetVisible(i);
      const linha = ds.type === 'line';
      container.append(el('button', {
        type: 'button', class: 'leg-item', 'aria-pressed': ligado ? 'true' : 'false',
        title: ligado ? 'Ocultar série' : 'Mostrar série',
        onclick: () => { chart.setDatasetVisibility(i, !chart.isDatasetVisible(i)); chart.update(); legenda(container, chart, dados); },
      }, el('span', { class: 'leg-marca' + (linha ? ' leg-marca-linha' : ''), style: { background: linha ? ds.borderColor : ds.backgroundColor } }),
      el('span', { class: 'leg-nome', text: ds.label })));
    });
    container.hidden = false;
  }

  function tabela(container, dados) {
    esvaziar(container);
    const formatar = formatador(dados.unidade, false);
    const somavel = dados.unidade !== 'pct' && dados.cfg.medida !== 'acumulado';
    const cab = el('tr', null, el('th', { scope: 'col', text: Dd.AGRUPAMENTOS[dados.cfg.agrupar].nome.split(' (')[0] }),
      dados.series.map((s) => el('th', { scope: 'col', class: 'num', text: s.nome })));
    const corpo = dados.rotulos.map((r, i) => el('tr', null, el('th', { scope: 'row', text: r }),
      dados.series.map((s) => el('td', { class: 'num', text: formatar(s.valores[i]) }))));
    const rodape = somavel && dados.rotulos.length > 1
      ? el('tfoot', null, el('tr', null, el('th', { scope: 'row', text: 'Total' }),
        dados.series.map((s) => el('td', { class: 'num', text: formatar(s.valores.reduce((a, v) => a + (v || 0), 0)) }))))
      : null;
    container.append(el('div', { class: 'rolagem-x' }, el('table', { class: 'tabela-dados' },
      el('caption', { class: 'visualmente-oculto', text: 'Dados do gráfico ' + dados.cfg.titulo }),
      el('thead', null, cab), el('tbody', null, corpo), rodape)));
  }

  function imagemPNG(chart, titulo, subtitulo) {
    const t = tema();
    const larg = chart.width, alt = chart.height, pad = 28, topo = 64;
    const escala = 2;
    const c = document.createElement('canvas');
    c.width = (larg + pad * 2) * escala;
    c.height = (alt + topo + pad) * escala;
    const ctx = c.getContext('2d');
    ctx.scale(escala, escala);
    ctx.fillStyle = t.superficie;
    ctx.fillRect(0, 0, larg + pad * 2, alt + topo + pad);
    ctx.fillStyle = t.tinta;
    ctx.font = `600 17px ${t.fonte}`;
    ctx.fillText(titulo, pad, pad + 8);
    ctx.fillStyle = t.apagada;
    ctx.font = `13px ${t.fonte}`;
    ctx.fillText(subtitulo, pad, pad + 30);
    if (chart.config.type !== 'doughnut' && chart.data.datasets.length > 1) {
      let x = larg + pad;
      ctx.font = `12px ${t.fonte}`;
      ctx.textAlign = 'right';
      for (const ds of [...chart.data.datasets].reverse()) {
        const w = ctx.measureText(ds.label).width;
        ctx.fillStyle = t.tinta2;
        ctx.fillText(ds.label, x, pad + 8);
        ctx.fillStyle = ds.type === 'line' ? ds.borderColor : ds.backgroundColor;
        if (ds.type === 'line') ctx.fillRect(x - w - 18, pad + 3, 12, 3); else ctx.fillRect(x - w - 16, pad - 1, 10, 10);
        x -= w + 30;
      }
    }
    ctx.drawImage(chart.canvas, pad, topo, larg, alt);
    return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  }

  // ── Descrição em texto ───────────────────────────────────────────────────

  function descrever(cfgBruta, estado) {
    const cfg = Dd.configEfetiva(cfgBruta);
    const medida = Dd.MEDIDAS[cfg.medida].nome.split(' (')[0];
    const agrupar = Dd.AGRUPAMENTOS[cfg.agrupar].nome.split(' (')[0].toLowerCase();
    let s = cfg.medida === 'orcamento' ? `Por ${agrupar}` : `${medida} por ${agrupar}`;
    if (cfg.dividir !== 'nenhum') s += `, separado por ${Dd.DIVISOES[cfg.dividir].toLowerCase()}`;
    if (cfg.categorias.length) s += ` · ${cfg.categorias.length} ${cfg.categorias.length === 1 ? 'categoria' : 'categorias'}`;
    const nomes = estado ? cfg.pessoas.map((id) => estado.pessoas.find((p) => p.id === id)?.nome).filter(Boolean) : [];
    if (nomes.length) s += ` · ${nomes.join(' e ')}`;
    return s;
  }

  // ── Cartão do painel ─────────────────────────────────────────────────────

  function criarCartao(cfg, acoes) {
    const canvas = el('canvas', { role: 'img' });
    const dica = el('div', { class: 'dica', hidden: true });
    const vazio = el('div', { class: 'cg-vazio', hidden: true },
      el('strong', { text: 'Nada para mostrar neste período' }),
      el('span', { text: 'Mude o período no topo da página ou lance movimentações.' }));
    const corpo = el('div', { class: 'cg-corpo' }, canvas, dica, vazio);
    const leg = el('div', { class: 'cg-legenda', hidden: true });
    const tab = el('div', { class: 'cg-tabela', hidden: true });
    const titulo = el('h3', { class: 'cg-titulo' });
    const sub = el('p', { class: 'cg-sub' });
    const botaoTabela = el('button', { type: 'button', class: 'botao-icone', title: 'Ver os dados em tabela', 'aria-label': 'Ver os dados em tabela', 'aria-pressed': 'false' }, icone('tabela'));
    const botaoMais = el('button', { type: 'button', class: 'botao-icone', title: 'Mais opções', 'aria-label': 'Mais opções do gráfico', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icone('mais'));
    const alca = el('button', { type: 'button', class: 'cg-alca', title: 'Arraste para mudar a ordem', 'aria-label': 'Arrastar para mudar a ordem' }, icone('alca'));
    const raiz = el('article', { class: 'cartao cg', dataset: { id: cfg.id } },
      el('header', { class: 'cg-cabeca' },
        alca,
        el('div', { class: 'cg-titulos' }, titulo, sub),
        el('div', { class: 'cg-acoes' },
          el('button', { type: 'button', class: 'botao-icone', title: 'Editar gráfico', 'aria-label': 'Editar gráfico', onclick: () => acoes.editar(cfg.id) }, icone('editar')),
          botaoTabela, botaoMais)),
      leg, corpo, tab);

    let chart = null, dadosAtuais = null, emTabela = false, primeiro = true;

    botaoTabela.addEventListener('click', () => {
      emTabela = !emTabela;
      botaoTabela.setAttribute('aria-pressed', emTabela ? 'true' : 'false');
      tab.hidden = !emTabela;
      corpo.hidden = emTabela;
      raiz.classList.toggle('em-tabela', emTabela);
      if (emTabela && dadosAtuais) tabela(tab, dadosAtuais);
    });
    botaoMais.addEventListener('click', () => LC.UI.menu(botaoMais, [
      { rotulo: 'Duplicar', icone: 'copiar', acao: () => acoes.duplicar(cfg.id) },
      { rotulo: 'Baixar imagem (PNG)', icone: 'imagem', acao: () => acoes.png(cfg.id), desativado: !chart },
      { separador: true },
      { rotulo: 'Mover para antes', icone: 'seta-cima', acao: () => acoes.mover(cfg.id, -1) },
      { rotulo: 'Mover para depois', icone: 'seta-baixo', acao: () => acoes.mover(cfg.id, 1) },
      { separador: true },
      { rotulo: 'Excluir gráfico', icone: 'lixeira', perigo: true, acao: () => acoes.excluir(cfg.id) },
    ]));

    // Arrastar e soltar para reordenar (a alça liga o arraste só enquanto está pressionada).
    alca.addEventListener('pointerdown', () => { raiz.draggable = true; });
    raiz.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', cfg.id);
      raiz.classList.add('arrastando');
    });
    raiz.addEventListener('dragend', () => { raiz.draggable = false; raiz.classList.remove('arrastando'); });
    alca.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); acoes.mover(cfg.id, -1); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); acoes.mover(cfg.id, 1); }
    });

    function atualizar(novaCfg, dados, subtitulo) {
      cfg = novaCfg;
      dadosAtuais = dados;
      raiz.dataset.largura = String(cfg.largura);
      raiz.classList.toggle('cg-circular', ehCircular(dados.cfg) && !dados.vazio);
      raiz.style.setProperty('--altura-grafico', ALTURAS[cfg.altura] + 'px');
      titulo.textContent = cfg.titulo || 'Sem título';
      sub.textContent = subtitulo;
      canvas.setAttribute('aria-label', `${cfg.titulo}. ${subtitulo}. Use o botão de tabela para ler os valores.`);
      if (chart) { chart.destroy(); chart = null; }
      dica.hidden = true;
      vazio.hidden = !dados.vazio;
      canvas.hidden = dados.vazio;
      if (!dados.vazio && typeof Chart !== 'undefined') {
        registrar();
        chart = new Chart(canvas, montarConfig(dados, { animar: primeiro, dica }));
        primeiro = false;
      }
      legenda(leg, chart, dados);
      if (emTabela) tabela(tab, dados);
    }

    return {
      el: raiz,
      atualizar,
      grafico: () => chart,
      config: () => cfg,
      destruir() { if (chart) chart.destroy(); chart = null; },
    };
  }

  // ── Editor de gráfico (gaveta lateral) ──────────────────────────────────

  function abrirEditor({ cfg, novo, estado, obterDados, aoSalvar, aoExcluir }) {
    let rascunho = Dd.normalizarGrafico(Dd.clonar(cfg));
    let chartPrevia = null;
    const dlg = el('dialog', { class: 'gaveta', 'aria-labelledby': 'editor-titulo' });
    const canvas = el('canvas', { role: 'img', 'aria-label': 'Prévia do gráfico' });
    const dica = el('div', { class: 'dica', hidden: true });
    const avisoPrevia = el('p', { class: 'editor-aviso', hidden: true });
    const legPrevia = el('div', { class: 'cg-legenda', hidden: true });
    const previa = el('div', { class: 'editor-previa' },
      el('div', { class: 'editor-previa-titulo' }, el('strong', { class: 'editor-previa-nome' }), el('span', { class: 'editor-previa-sub' })),
      legPrevia,
      el('div', { class: 'cg-corpo', style: { '--altura-grafico': '230px' } }, canvas, dica), avisoPrevia);
    const formulario = el('div', { class: 'editor-form' });

    const fechar = () => dlg.close();
    const salvar = () => { aoSalvar(Dd.normalizarGrafico(rascunho)); dlg.close(); };
    dlg.append(
      el('header', { class: 'gaveta-cabeca' },
        el('div', null, el('p', { class: 'sobretitulo', text: novo ? 'Novo gráfico' : 'Editar gráfico' }),
          el('h2', { id: 'editor-titulo', class: 'gaveta-titulo', text: novo ? 'Monte seu gráfico' : cfg.titulo || 'Gráfico' })),
        el('button', { type: 'button', class: 'botao-icone', 'aria-label': 'Fechar sem salvar', title: 'Fechar sem salvar', onclick: fechar }, icone('fechar'))),
      el('div', { class: 'gaveta-corpo' }, previa, formulario),
      el('footer', { class: 'gaveta-rodape' },
        !novo ? el('button', { type: 'button', class: 'botao botao-fantasma perigo', onclick: async () => { if (await aoExcluir(cfg.id)) dlg.close(); } }, icone('lixeira'), 'Excluir') : el('span'),
        el('div', { class: 'gaveta-rodape-acoes' },
          el('button', { type: 'button', class: 'botao', onclick: fechar }, 'Cancelar'),
          el('button', { type: 'button', class: 'botao botao-primario', onclick: salvar }, novo ? 'Adicionar ao painel' : 'Salvar gráfico'))));

    function atualizarPrevia() {
      const dados = obterDados(rascunho);
      const efetiva = dados.cfg;
      previa.querySelector('.editor-previa-nome').textContent = rascunho.titulo || 'Sem título';
      previa.querySelector('.editor-previa-sub').textContent = descrever(rascunho, estado);
      if (chartPrevia) { chartPrevia.destroy(); chartPrevia = null; }
      dica.hidden = true;
      const ajustes = [];
      if (efetiva.tipo !== rascunho.tipo) ajustes.push(`${TIPOS[rascunho.tipo].nome} mostra uma série só; a prévia usa colunas.`);
      if (efetiva.agrupar !== rascunho.agrupar) ajustes.push(`${Dd.MEDIDAS[rascunho.medida].nome.split(' (')[0]} usa agrupamento por ${Dd.AGRUPAMENTOS[efetiva.agrupar].nome.toLowerCase()}.`);
      if (rascunho.dividir !== 'nenhum' && efetiva.dividir === 'nenhum') ajustes.push('Esta medida já tem séries próprias; a divisão foi ignorada.');
      if (dados.vazio) ajustes.push('Sem lançamentos no período escolhido no painel.');
      avisoPrevia.textContent = ajustes.join(' ');
      avisoPrevia.hidden = !ajustes.length;
      canvas.hidden = dados.vazio;
      if (!dados.vazio && typeof Chart !== 'undefined') {
        registrar();
        chartPrevia = new Chart(canvas, montarConfig(dados, { dica }));
      }
      legenda(legPrevia, chartPrevia, dados);
      return dados;
    }

    function mudar(campo, valor, { reconstruir = false } = {}) {
      rascunho[campo] = valor;
      const dados = atualizarPrevia();
      if (reconstruir) montarFormulario(dados);
      else atualizarVisibilidade(dados);
    }

    const secoes = {};
    function atualizarVisibilidade(dados) {
      const efetiva = dados.cfg;
      const m = Dd.MEDIDAS[efetiva.medida];
      const tempo = Dd.AGRUPAMENTOS[efetiva.agrupar].tempo;
      const multi = dados.series.length > 1;
      const linhaOuArea = efetiva.tipo === 'linha' || efetiva.tipo === 'area';
      const mostrar = (k, sim) => { if (secoes[k]) secoes[k].hidden = !sim; };
      mostrar('dividir', !m.multi && efetiva.medida !== 'acumulado' && efetiva.medida !== 'poupanca' && !ehCircular(rascunho));
      mostrar('maxItens', (!tempo && efetiva.agrupar !== 'diaSemana' && efetiva.medida !== 'orcamento') || efetiva.dividir !== 'nenhum');
      mostrar('ordem', !tempo && efetiva.agrupar !== 'diaSemana');
      mostrar('empilhar', multi && !ehCircular(efetiva) && efetiva.medida !== 'fluxo');
      mostrar('corPorItem', !multi && !tempo && !linhaOuArea && !ehCircular(efetiva));
      mostrar('suave', linhaOuArea || efetiva.medida === 'fluxo');
      mostrar('zero', linhaOuArea);
      mostrar('rotulos', !ehCircular(efetiva));
      mostrar('grade', !ehCircular(efetiva));
      mostrar('meta', !ehCircular(efetiva));
      mostrar('categorias', !['acumulado'].includes(efetiva.medida));
      montarCores(dados);
    }

    const blocoCores = el('div', { class: 'editor-cores' });
    function montarCores(dados) {
      esvaziar(blocoCores);
      const efetiva = dados.cfg;
      const porItem = ehCircular(efetiva) || (efetiva.corPorItem && dados.series.length === 1 && dados.coresItens && efetiva.tipo !== 'linha' && efetiva.tipo !== 'area');
      const itens = porItem
        ? dados.chaves.map((k, i) => ({ chave: k, nome: dados.rotulos[i], padrao: dados.coresItens ? dados.coresItens[i] : dados.series[0].cor }))
        : dados.series.map((s) => ({ chave: s.chave, nome: s.nome, padrao: s.cor }));
      for (const it of itens.slice(0, 16)) {
        const atual = rascunho.cores[it.chave] || it.padrao;
        const amostra = el('button', { type: 'button', class: 'amostra-botao', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Mudar a cor de ' + it.nome, 'aria-label': 'Mudar a cor de ' + it.nome },
          el('span', { class: 'amostra', style: { background: LC.cor(atual) } }));
        amostra.addEventListener('click', () => LC.UI.escolherCor(amostra, atual, (ref) => {
          if (ref == null) delete rascunho.cores[it.chave]; else rascunho.cores[it.chave] = ref;
          atualizarVisibilidade(atualizarPrevia());
        }, { permitirPadrao: true }));
        blocoCores.append(el('div', { class: 'editor-cor-linha' }, amostra, el('span', { class: 'editor-cor-nome', text: it.nome }),
          rascunho.cores[it.chave] ? el('span', { class: 'etiqueta', text: 'personalizada' }) : null));
      }
      if (itens.length > 16) blocoCores.append(el('p', { class: 'ajuda', text: `Mais ${itens.length - 16} itens usam as cores dos cadastros.` }));
      if (Object.keys(rascunho.cores).length) {
        blocoCores.append(el('button', { type: 'button', class: 'botao botao-pequeno botao-fantasma', onclick: () => { rascunho.cores = {}; atualizarVisibilidade(atualizarPrevia()); } }, 'Voltar às cores padrão'));
      }
    }

    function montarFormulario(dados) {
      esvaziar(formulario);
      const r = rascunho;
      if (novo) {
        const grade = el('div', { class: 'modelos' });
        for (const m of MODELOS) {
          grade.append(el('button', {
            type: 'button', class: 'modelo', onclick: () => {
              rascunho = Dd.normalizarGrafico({ ...m, id: rascunho.id });
              montarFormulario(atualizarPrevia());
            },
          }, icone(TIPOS[m.tipo].icone, 'ico ico-modelo'), el('span', { class: 'modelo-nome', text: m.titulo }), el('span', { class: 'modelo-desc', text: m.descricao })));
        }
        formulario.append(el('section', { class: 'editor-secao' }, el('h3', { class: 'editor-secao-titulo', text: 'Comece por um modelo' }), grade));
      }

      const titulo = el('input', { id: 'ed-titulo', class: 'entrada', type: 'text', value: r.titulo, maxlength: '80', autocomplete: 'off' });
      titulo.addEventListener('input', () => { rascunho.titulo = titulo.value; previa.querySelector('.editor-previa-nome').textContent = titulo.value || 'Sem título'; });

      const tipos = LC.UI.segmentado(Object.entries(TIPOS).map(([valor, t]) => ({ valor, rotulo: t.nome, icone: t.icone, mostrarRotulo: true })),
        r.tipo, (v) => mudar('tipo', v, { reconstruir: true }), { rotulo: 'Tipo de gráfico' });
      tipos.classList.add('tipos-grafico');

      const medidas = LC.UI.selecao('ed-medida', Object.entries(Dd.MEDIDAS).map(([v, m]) => [v, m.nome]), r.medida, (v) => mudar('medida', v, { reconstruir: true }));
      const agrup = LC.UI.selecao('ed-agrupar', [
        { grupo: 'Tempo', itens: [['mes', 'Mês'], ['semana', 'Semana'], ['dia', 'Dia'], ['diaSemana', 'Dia da semana']] },
        { grupo: 'Cadastros', itens: [['categoria', 'Categoria'], ['pessoa', 'Pessoa'], ['tipo', 'Tipo (recebimento ou gasto)'], ['situacao', 'Situação (pago ou pendente)']] },
      ], r.agrupar, (v) => mudar('agrupar', v, { reconstruir: true }));
      const dividir = LC.UI.selecao('ed-dividir', Object.entries(Dd.DIVISOES).map(([v, n]) => [v, n]), r.dividir, (v) => mudar('dividir', v, { reconstruir: true }));
      const maxItens = LC.UI.selecao('ed-max', [[0, 'Todos'], ...[3, 4, 5, 6, 7, 8].map((n) => [n, `Os ${n} maiores`])], r.maxItens, (v) => mudar('maxItens', +v));
      const ordem = LC.UI.selecao('ed-ordem', [['valor-desc', 'Maior valor primeiro'], ['valor-asc', 'Menor valor primeiro'], ['alfa', 'Ordem alfabética']], r.ordem, (v) => mudar('ordem', v));

      const chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Categorias incluídas' });
      const tipoCat = r.medida === 'receitas' ? ['receita'] : r.medida === 'despesas' || r.medida === 'orcamento' ? ['despesa'] : ['despesa', 'receita'];
      for (const c of estado.categorias.filter((x) => tipoCat.includes(x.tipo))) {
        const marcado = r.categorias.includes(c.id);
        chips.append(el('button', {
          type: 'button', class: 'chip', 'aria-pressed': marcado ? 'true' : 'false',
          onclick: (e) => {
            const lista = new Set(rascunho.categorias);
            if (lista.has(c.id)) lista.delete(c.id); else lista.add(c.id);
            e.currentTarget.setAttribute('aria-pressed', lista.has(c.id) ? 'true' : 'false');
            mudar('categorias', [...lista]);
          },
        }, el('span', { class: 'chip-cor', style: { background: LC.cor(c.cor) } }), c.nome));
      }

      secoes.dividir = LC.UI.campo('Separar em séries por', dividir, { ajuda: 'Cria uma série para cada item (por exemplo, uma cor por categoria).' });
      secoes.maxItens = LC.UI.campo('Itens no gráfico', maxItens, { ajuda: 'O restante entra como "Outros".' });
      secoes.ordem = LC.UI.campo('Ordenar', ordem);
      secoes.categorias = el('div', { class: 'campo' }, el('span', { class: 'campo-rotulo', text: 'Só estas categorias' }), chips,
        el('p', { class: 'ajuda', text: 'Nenhuma marcada = todas entram.' }));

      const chipsPessoas = el('div', { class: 'chips', role: 'group', 'aria-label': 'Pessoas incluídas' });
      for (const p of estado.pessoas) {
        const marcado = r.pessoas.includes(p.id);
        chipsPessoas.append(el('button', {
          type: 'button', class: 'chip', 'aria-pressed': marcado ? 'true' : 'false',
          onclick: (e) => {
            const lista = new Set(rascunho.pessoas);
            if (lista.has(p.id)) lista.delete(p.id); else lista.add(p.id);
            e.currentTarget.setAttribute('aria-pressed', lista.has(p.id) ? 'true' : 'false');
            mudar('pessoas', [...lista]);
          },
        }, el('span', { class: 'chip-cor', style: { background: LC.cor(p.cor) } }), p.nome));
      }
      secoes.pessoas = el('div', { class: 'campo' }, el('span', { class: 'campo-rotulo', text: 'Só estas pessoas' }), chipsPessoas,
        el('p', { class: 'ajuda', text: 'Nenhuma marcada = todos entram.' }));

      formulario.append(el('section', { class: 'editor-secao' },
        el('h3', { class: 'editor-secao-titulo', text: 'Dados' }),
        LC.UI.campo('Título', titulo),
        LC.UI.campo('O que mostrar', medidas),
        LC.UI.campo('Agrupar por', agrup),
        secoes.dividir, secoes.maxItens, secoes.ordem, secoes.pessoas, secoes.categorias));

      const meta = el('input', {
        id: 'ed-meta', class: 'entrada', type: 'text', inputmode: 'decimal', autocomplete: 'off',
        placeholder: Dd.MEDIDAS[r.medida].unidade === 'pct' ? 'ex.: 20%' : 'ex.: 1.500,00',
        value: r.meta == null ? '' : Dd.MEDIDAS[r.medida].unidade === 'pct' ? LC.fmt.numero(r.meta * 100) + '%' : LC.fmt.numero(r.meta),
      });
      meta.addEventListener('change', () => {
        const n = LC.paraNumero(meta.value.replace('%', ''));
        mudar('meta', Number.isFinite(n) ? (Dd.MEDIDAS[rascunho.medida].unidade === 'pct' ? n / 100 : n) : null);
      });

      secoes.empilhar = LC.UI.interruptor('ed-empilhar', 'Empilhar séries', r.empilhar, (v) => mudar('empilhar', v));
      secoes.corPorItem = LC.UI.interruptor('ed-poritem', 'Uma cor para cada item', r.corPorItem, (v) => mudar('corPorItem', v));
      secoes.suave = LC.UI.interruptor('ed-suave', 'Linhas suavizadas', r.suave, (v) => mudar('suave', v));
      secoes.zero = LC.UI.interruptor('ed-zero', 'Eixo começando no zero', r.zero, (v) => mudar('zero', v));
      secoes.grade = LC.UI.interruptor('ed-grade', 'Linhas de grade', r.grade, (v) => mudar('grade', v));
      const legendaSw = LC.UI.interruptor('ed-legenda', 'Legenda', r.legenda, (v) => mudar('legenda', v));
      secoes.rotulos = LC.UI.campo('Valores escritos no gráfico', LC.UI.segmentado([
        { valor: 'nenhum', rotulo: 'Nenhum' }, { valor: 'destaques', rotulo: 'Destaques' }, { valor: 'todos', rotulo: 'Todos' },
      ], r.rotulos, (v) => mudar('rotulos', v), { rotulo: 'Valores escritos no gráfico', compacto: true }), { ajuda: 'Destaques: o maior valor e o último ponto das linhas.' });
      secoes.meta = LC.UI.campo('Linha de meta', meta, { ajuda: 'Uma linha tracejada no valor que você quer acompanhar. Deixe vazio para não mostrar.' });

      formulario.append(el('section', { class: 'editor-secao' },
        el('h3', { class: 'editor-secao-titulo', text: 'Aparência' }),
        LC.UI.campo('Tipo de gráfico', tipos, { para: null }),
        secoes.rotulos,
        el('div', { class: 'grupo-interruptores' }, secoes.empilhar, secoes.corPorItem, secoes.suave, secoes.zero, secoes.grade, legendaSw),
        secoes.meta));

      formulario.append(el('section', { class: 'editor-secao' },
        el('h3', { class: 'editor-secao-titulo', text: 'Cores' }), blocoCores));

      formulario.append(el('section', { class: 'editor-secao' },
        el('h3', { class: 'editor-secao-titulo', text: 'Tamanho no painel' }),
        LC.UI.campo('Largura', LC.UI.segmentado([{ valor: 1, rotulo: 'Meia largura' }, { valor: 2, rotulo: 'Largura total' }], r.largura, (v) => mudar('largura', v), { rotulo: 'Largura', compacto: true })),
        LC.UI.campo('Altura', LC.UI.segmentado([{ valor: 'p', rotulo: 'Baixa' }, { valor: 'm', rotulo: 'Média' }, { valor: 'g', rotulo: 'Alta' }], r.altura, (v) => mudar('altura', v), { rotulo: 'Altura', compacto: true }))));

      atualizarVisibilidade(dados);
    }

    dlg.addEventListener('close', () => { if (chartPrevia) chartPrevia.destroy(); LC.UI.fecharPopover(); dlg.remove(); });
    dlg.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); salvar(); }
    });
    document.body.append(dlg);
    dlg.showModal();
    montarFormulario(atualizarPrevia());
    const foco = dlg.querySelector(novo ? '.modelo' : '#ed-titulo');
    if (foco) foco.focus();
  }

  function aoMudarTema(fn) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', fn);
    new MutationObserver(fn).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  LC.Graficos = { TIPOS, ALTURAS, MODELOS, criarCartao, abrirEditor, imagemPNG, descrever, montarConfig, tabela, aoMudarTema, registrar };
})(globalThis.LC = globalThis.LC || {});
