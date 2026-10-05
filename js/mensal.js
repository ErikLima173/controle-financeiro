/*
 * mensal.js — A planilha mensal de cada pessoa, igual às abas "Gastos Nathy" e "Gastos vini",
 * e a aba "Total finanças" que soma todo mundo.
 *
 *   Mês × categorias ─ digitar um valor ─► Dados.definirValorMensal (um lançamento "mensal" por célula)
 *   Total gasto, Total restante e os totais do ano são calculados, como as fórmulas da planilha.
 *   Teclado: setas andam · Enter/F2 ou digitar edita · Enter confirma e desce · Tab anda · Delete apaga
 */
(function (LC) {
  'use strict';

  const { el, icone, esvaziar, fmt } = LC;
  const Dd = LC.Dados;

  function criar(raiz, ctx) {
    const vista = { ativo: null, editando: false, grafico: null };
    const ano = () => ctx.prefs().anoMensal || +ctx.hoje().slice(0, 4);
    const abaAtual = () => {
      const a = ctx.prefs().abaMensal;
      return a === 'total' || ctx.estado().pessoas.some((p) => p.id === a) ? a : ctx.estado().pessoas[0].id;
    };

    function render() {
      const est = ctx.estado();
      const focoNaGrade = raiz.querySelector('.grade-mensal')?.contains(document.activeElement);
      if (vista.grafico) { vista.grafico.destroy(); vista.grafico = null; }
      esvaziar(raiz);
      const aba = abaAtual();
      const anoSel = ano();

      const navAno = el('div', { class: 'ano-nav' },
        el('button', { type: 'button', class: 'botao-icone', 'aria-label': 'Ano anterior', title: 'Ano anterior', onclick: () => { ctx.salvarPrefs({ anoMensal: anoSel - 1 }); render(); } }, icone('chevron-esq')),
        el('strong', { class: 'ano-valor', text: String(anoSel) }),
        el('button', { type: 'button', class: 'botao-icone', 'aria-label': 'Próximo ano', title: 'Próximo ano', onclick: () => { ctx.salvarPrefs({ anoMensal: anoSel + 1 }); render(); } }, icone('chevron-dir')));
      const abas = el('div', { class: 'abas-mensal', role: 'tablist', 'aria-label': 'Planilhas' });
      for (const p of est.pessoas) {
        abas.append(el('button', {
          type: 'button', role: 'tab', class: 'aba-mensal', 'aria-selected': aba === p.id ? 'true' : 'false', tabindex: aba === p.id ? '0' : '-1',
          onclick: () => { ctx.salvarPrefs({ abaMensal: p.id }); vista.ativo = null; render(); },
        }, el('span', { class: 'ponto', style: { background: LC.cor(p.cor) } }), `Gastos ${p.nome}`));
      }
      abas.append(el('button', {
        type: 'button', role: 'tab', class: 'aba-mensal aba-total', 'aria-selected': aba === 'total' ? 'true' : 'false', tabindex: aba === 'total' ? '0' : '-1',
        onclick: () => { ctx.salvarPrefs({ abaMensal: 'total' }); vista.ativo = null; render(); },
      }, icone('painel', 'ico ico-mini'), 'Total finanças'));
      abas.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const lista = [...abas.querySelectorAll('[role="tab"]')];
        const i = lista.indexOf(document.activeElement);
        const prox = lista[(i + (e.key === 'ArrowRight' ? 1 : -1) + lista.length) % lista.length];
        prox.focus();
        prox.click();
        raiz.querySelector('[role="tab"][aria-selected="true"]')?.focus();
      });
      const acoes = el('div', { class: 'mensal-acoes' },
        aba !== 'total' ? el('button', { type: 'button', class: 'botao', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (e) => menuNovaColuna(e.currentTarget, aba) }, icone('adicionar'), 'Coluna') : null,
        el('button', { type: 'button', class: 'botao', onclick: novaPessoa }, icone('adicionar'), 'Pessoa'),
        el('button', { type: 'button', class: 'botao', onclick: () => ctx.exportarAno(anoSel) }, icone('excel'), `Excel de ${anoSel}`));
      raiz.append(el('div', { class: 'mensal-topo' }, el('div', { class: 'mensal-topo-esq' }, navAno, abas), acoes));

      if (aba === 'total') renderTotal(est, anoSel);
      else renderPessoa(est, aba, anoSel, focoNaGrade);
    }

    // ── Aba de uma pessoa ────────────────────────────────────────────────
    function renderPessoa(est, pessoaId, anoSel, focoNaGrade) {
      const mz = Dd.matrizMensal(est, pessoaId, anoSel);
      const cats = Dd.mapaPorId(est.categorias);
      const mesHoje = ctx.hoje().slice(0, 7);
      const colunas = [
        ...mz.despesas.map((id) => ({ tipo: 'cat', id })),
        { tipo: 'gasto' },
        ...mz.receitas.map((id) => ({ tipo: 'cat', id })),
        { tipo: 'restante' },
      ];
      const L = (i) => LC.letraColuna(i + 1); // A é a coluna dos meses
      const idxGasto = colunas.findIndex((c) => c.tipo === 'gasto');
      const idxRec = colunas.map((c, i) => [c, i]).filter(([c]) => c.tipo === 'cat' && cats.get(c.id).tipo === 'receita').map(([, i]) => i);

      const refCelula = el('span', { class: 'fx-ref' }, '—');
      const valorCelula = el('span', { class: 'fx-valor' });
      const tabela = el('table', { class: 'grade grade-mensal', role: 'grid', 'aria-label': `Gastos ${mz.pessoa.nome} em ${anoSel}` });

      const letras = el('tr', { class: 'linha-letras', 'aria-hidden': 'true' }, el('th', { class: 'c-num' }), el('th', { text: 'A' }), colunas.map((_, i) => el('th', { text: L(i) })));
      const titulos = el('tr', { class: 'linha-titulos' }, el('th', { class: 'c-num', scope: 'col' }), el('th', { scope: 'col', class: 'c-mes', text: 'Mês' }),
        colunas.map((c) => {
          if (c.tipo === 'gasto') return el('th', { scope: 'col', class: 'c-calc', text: 'Total gasto' });
          if (c.tipo === 'restante') return el('th', { scope: 'col', class: 'c-calc', text: 'Total restante' });
          const cat = cats.get(c.id);
          const extra = mz.extras.includes(c.id);
          const botao = el('button', { type: 'button', class: 'botao-icone botao-coluna', 'aria-label': `Opções da coluna ${cat.nome}`, title: 'Opções da coluna', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icone('mais'));
          botao.addEventListener('click', () => menuColuna(botao, pessoaId, c.id, extra, anoSel));
          return el('th', { scope: 'col', class: 'c-cat-col' + (extra ? ' extra' : '') + (cat.tipo === 'receita' ? ' c-receita' : ''), title: extra ? 'Tem valores neste ano, mas não está nas colunas desta pessoa' : null },
            el('span', { class: 'cab-coluna' }, el('span', { class: 'ponto', style: { background: LC.cor(cat.cor) } }), el('span', { class: 'cab-nome', text: cat.nome }), botao));
        }));
      const corpo = el('tbody');
      mz.meses.forEach((m, r) => {
        const tr = el('tr', { class: (m.chave === mesHoje ? 'mes-atual ' : '') + (m.chave > mesHoje ? 'mes-futuro' : ''), dataset: { mes: m.chave } },
          el('th', { class: 'c-num', scope: 'row', text: String(r + 2) }),
          el('th', { class: 'c-mes', scope: 'row' }, m.nome, m.chave === mesHoje ? el('span', { class: 'etiqueta', text: 'agora' }) : null));
        colunas.forEach((c, i) => {
          if (c.tipo === 'gasto') { tr.append(el('td', { class: 'num calc', dataset: { col: String(i) }, tabindex: '-1', text: m.gasto ? fmt.moeda(m.gasto) : '' })); return; }
          if (c.tipo === 'restante') {
            tr.append(el('td', { class: 'num calc' + (m.restante < 0 ? ' negativo' : ''), dataset: { col: String(i) }, tabindex: '-1', text: m.gasto || m.recebido ? fmt.moeda(m.restante) : '' }));
            return;
          }
          const cel = m.celula(c.id);
          const v = m.valor(c.id);
          const td = el('td', {
            class: 'num cel-valor' + (cel && cel.pendente ? ' pendente' : '') + (cel && cel.detalhados ? ' detalhada' : ''),
            dataset: { col: String(i), cat: c.id, mes: m.chave }, tabindex: '-1', role: 'gridcell',
            title: cel && cel.detalhados ? `Inclui ${cel.detalhados} ${cel.detalhados === 1 ? 'lançamento feito' : 'lançamentos feitos'} um a um (${fmt.moeda(cel.valorDetalhado)})` : null,
          }, v ? fmt.moeda(v) : '');
          tr.append(td);
        });
        corpo.append(tr);
      });
      const somaCol = (c) => (c.tipo === 'gasto' ? mz.meses.reduce((s, m) => s + m.gasto, 0) : c.tipo === 'restante' ? mz.meses.reduce((s, m) => s + m.restante, 0) : mz.meses.reduce((s, m) => s + m.valor(c.id), 0));
      const mesesComValor = mz.meses.filter((m) => m.gasto || m.recebido).length || 1;
      const rodape = el('tfoot', null,
        el('tr', null, el('th', { class: 'c-num' }), el('th', { class: 'c-mes', scope: 'row', text: 'Total' }),
          colunas.map((c) => { const v = LC.arred(somaCol(c)); return el('td', { class: 'num' + (v < 0 ? ' negativo' : ''), text: v ? fmt.moeda(v) : '' }); })),
        el('tr', { class: 'linha-media' }, el('th', { class: 'c-num' }), el('th', { class: 'c-mes', scope: 'row', text: 'Média' }),
          colunas.map((c) => { const v = LC.arred(somaCol(c) / mesesComValor); return el('td', { class: 'num' + (v < 0 ? ' negativo' : ''), text: v ? fmt.moeda(v) : '' }); })));
      tabela.append(el('thead', null, letras, titulos), corpo, rodape);

      const totalAno = { gasto: LC.arred(somaCol({ tipo: 'gasto' })), restante: LC.arred(somaCol({ tipo: 'restante' })) };
      const status = el('div', { class: 'barra-status' },
        el('span', null, el('span', { class: 'apagado', text: `Gasto em ${anoSel} ` }), el('strong', { text: fmt.moeda(totalAno.gasto) })),
        el('span', null, el('span', { class: 'apagado', text: 'Recebido ' }), el('strong', { text: fmt.moeda(totalAno.gasto + totalAno.restante) })),
        el('span', null, el('span', { class: 'apagado', text: 'Restante ' }), el('strong', { class: totalAno.restante < 0 ? 'negativo' : '', text: fmt.moeda(totalAno.restante) })),
        el('span', null, el('span', { class: 'apagado', text: 'Gasto médio por mês ' }), el('strong', { text: fmt.moeda(totalAno.gasto / mesesComValor) })));

      const vazia = !colunas.some((c) => c.tipo === 'cat');
      raiz.append(el('div', { class: 'cartao planilha' },
        el('div', { class: 'barra-formula', 'aria-hidden': 'true' }, refCelula, el('span', { class: 'fx-rotulo', text: 'fx' }), valorCelula),
        vazia
          ? el('div', { class: 'grade-vazia' }, icone('lancamentos', 'ico ico-grande'), el('strong', { text: 'Esta planilha ainda não tem colunas' }),
            el('span', { text: 'Adicione as categorias que esta pessoa usa (Aluguel, Comida, Salário...). Cada uma vira uma coluna, como no Excel.' }),
            el('button', { type: 'button', class: 'botao botao-primario', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (e) => menuNovaColuna(e.currentTarget, pessoaId) }, icone('adicionar'), 'Adicionar coluna'))
          : el('div', { class: 'grade-rolagem' }, tabela),
        status));
      raiz.append(el('p', { class: 'ajuda mensal-dica', text: 'Clique numa célula e digite o total do mês. Os totais em cinza são calculados. Valores em itálico ainda estão para pagar ou receber.' }));
      renderGrafico({ tipo: 'colunas', medida: 'fluxo', agrupar: 'mes', pessoas: [pessoaId], rotulos: 'nenhum' }, `${mz.pessoa.nome}: recebido x gasto em ${anoSel}`, anoSel);

      // ── teclado e edição ──
      const linhasTb = [...corpo.rows];
      const celulaEm = (r, i) => linhasTb[r]?.querySelector(`td[data-col="${i}"]`);
      const marcar = (focar) => {
        for (const td of tabela.querySelectorAll('td.ativa')) { td.classList.remove('ativa'); td.tabIndex = -1; }
        if (!vista.ativo) vista.ativo = { r: Math.max(0, mz.meses.findIndex((m) => m.chave === mesHoje)), i: colunas.findIndex((c) => c.tipo === 'cat') };
        vista.ativo.r = Math.max(0, Math.min(11, vista.ativo.r));
        vista.ativo.i = Math.max(0, Math.min(colunas.length - 1, vista.ativo.i));
        const td = celulaEm(vista.ativo.r, vista.ativo.i);
        if (!td) return;
        td.classList.add('ativa');
        td.tabIndex = 0;
        const r = vista.ativo.r + 2;
        refCelula.textContent = L(vista.ativo.i) + r;
        const c = colunas[vista.ativo.i];
        if (c.tipo === 'gasto') valorCelula.textContent = idxGasto > 0 ? `=SOMA(B${r}:${L(idxGasto - 1)}${r})` : '=0';
        else if (c.tipo === 'restante') valorCelula.textContent = `=${idxRec.length ? idxRec.map((j) => L(j) + r).join('+') : '0'}-${L(idxGasto)}${r}`;
        else valorCelula.textContent = LC.fmt.numero(mz.meses[vista.ativo.r].valor(c.id));
        if (focar) td.focus();
      };
      const mover = (dr, di) => {
        if (!vista.ativo) return;
        vista.ativo.r += dr;
        vista.ativo.i += di;
        marcar(true);
      };
      const editar = (inicial) => {
        const c = colunas[vista.ativo.i];
        if (!c || c.tipo !== 'cat' || vista.editando) return;
        const td = celulaEm(vista.ativo.r, vista.ativo.i);
        const m = mz.meses[vista.ativo.r];
        const atual = m.valor(c.id);
        const entrada = el('input', { type: 'text', inputmode: 'decimal', class: 'celula-entrada num', autocomplete: 'off', 'aria-label': `${cats.get(c.id).nome} em ${m.nome}`, value: inicial ?? (atual ? fmt.numero(atual) : '') });
        vista.editando = true;
        td.classList.add('editando');
        esvaziar(td).append(entrada);
        entrada.focus();
        if (inicial == null) entrada.select();
        let fim = false;
        const concluir = (salvar, depois, focar = true) => {
          if (fim) return;
          fim = true;
          vista.editando = false;
          if (salvar) {
            const texto = entrada.value.trim();
            const n = texto === '' ? 0 : LC.paraNumero(texto);
            if (!Number.isFinite(n) || n < 0) {
              LC.UI.aviso('Valor não reconhecido. Use números como 1.234,56 (ou deixe vazio para apagar).', { tipo: 'erro' });
              fim = false; vista.editando = true; entrada.classList.add('invalida'); entrada.focus();
              return;
            }
            if (LC.arred(n) !== LC.arred(atual)) {
              try {
                ctx.alterar((e) => Dd.definirValorMensal(e, pessoaId, c.id, m.chave, LC.arred(n), ctx.hoje()));
              } catch (err) {
                LC.UI.aviso(err.message, { tipo: 'erro', duracao: 9000 });
                render();
              }
            } else render();
          } else render();
          if (depois) depois();
          if (focar) marcarDepois();
        };
        entrada.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== 'Tab' && e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Enter') concluir(true, () => { vista.ativo.r += 1; });
          else if (e.key === 'Tab') concluir(true, () => { vista.ativo.i += e.shiftKey ? -1 : 1; });
          else concluir(false);
        });
        entrada.addEventListener('blur', () => setTimeout(() => { if (!fim && document.activeElement !== entrada) concluir(true, null, false); }, 0));
      };
      // depois de redesenhar, a célula ativa recebe o foco de novo
      const marcarDepois = () => { const nova = raiz.querySelector('.grade-mensal'); if (nova) nova.dispatchEvent(new CustomEvent('focar-ativa')); };
      tabela.addEventListener('focar-ativa', () => marcar(true));

      let cliqueEmAtiva = null;
      tabela.addEventListener('pointerdown', (e) => {
        const td = e.target.closest('td[data-col]');
        if (!td || td.classList.contains('editando')) { cliqueEmAtiva = null; return; }
        const r = linhasTb.indexOf(td.parentElement), i = +td.dataset.col;
        cliqueEmAtiva = !vista.editando && !!vista.ativo && vista.ativo.r === r && vista.ativo.i === i;
        vista.ativo = { r, i };
      });
      tabela.addEventListener('click', (e) => {
        const td = e.target.closest('td[data-col]');
        if (!td || vista.editando || cliqueEmAtiva === null) return;
        vista.ativo = { r: linhasTb.indexOf(td.parentElement), i: +td.dataset.col };
        marcar(true);
        if (cliqueEmAtiva) editar();
        cliqueEmAtiva = null;
      });
      tabela.addEventListener('dblclick', (e) => { if (e.target.closest('td.cel-valor') && !vista.editando) editar(); });
      tabela.addEventListener('keydown', (e) => {
        if (vista.editando || !e.target.matches('td[data-col]')) return;
        const mapa = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] };
        if (mapa[e.key]) { e.preventDefault(); mover(...mapa[e.key]); return; }
        if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); vista.ativo.i = e.key === 'Home' ? 0 : colunas.length - 1; marcar(true); return; }
        if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); editar(); return; }
        const c = colunas[vista.ativo.i];
        if ((e.key === 'Delete' || e.key === 'Backspace') && c && c.tipo === 'cat') {
          e.preventDefault();
          const m = mz.meses[vista.ativo.r];
          if (!m.valor(c.id)) return;
          try { ctx.alterar((est2) => Dd.definirValorMensal(est2, pessoaId, c.id, m.chave, 0, ctx.hoje())); marcarDepois(); }
          catch (err) { LC.UI.aviso(err.message, { tipo: 'erro', duracao: 9000 }); }
          return;
        }
        if (e.key.length === 1 && /[\d,.\-]/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && c && c.tipo === 'cat') {
          e.preventDefault();
          editar(e.key);
        }
      });
      marcar(focoNaGrade);
    }

    // ── Aba Total finanças ───────────────────────────────────────────────
    function renderTotal(est, anoSel) {
      const mesHoje = ctx.hoje().slice(0, 7);
      const resumo = Dd.MESES_NOMES.map((nome, k) => ({ nome, chave: `${anoSel}-${String(k + 1).padStart(2, '0')}` })).map((m) => ({ ...m, ...Dd.resumoMes(est, m.chave) }));
      const pessoas = est.pessoas;
      const tabela = el('table', { class: 'grade grade-mensal grade-total', 'aria-label': `Total finanças de ${anoSel}` });
      const cab = ['Total recebido', 'Total gasto', 'Total restante', '% guardado', ...pessoas.map((p) => `Restante ${p.nome}`)];
      tabela.append(el('thead', null,
        el('tr', { class: 'linha-letras', 'aria-hidden': 'true' }, el('th', { class: 'c-num' }), el('th', { text: 'A' }), cab.map((_, i) => el('th', { text: LC.letraColuna(i + 1) }))),
        el('tr', { class: 'linha-titulos' }, el('th', { class: 'c-num' }), el('th', { class: 'c-mes', scope: 'col', text: 'Mês' }),
          cab.map((t, i) => el('th', { scope: 'col', class: 'c-calc' + (i >= 4 ? ' c-pessoa-total' : '') }, i >= 4 ? el('span', { class: 'cab-coluna' }, el('span', { class: 'ponto', style: { background: LC.cor(pessoas[i - 4].cor) } }), el('span', { text: t })) : t)))));
      const corpo = el('tbody');
      resumo.forEach((m, r) => {
        const temValor = m.receitas || m.despesas;
        corpo.append(el('tr', { class: (m.chave === mesHoje ? 'mes-atual ' : '') + (m.chave > mesHoje ? 'mes-futuro' : '') },
          el('th', { class: 'c-num', scope: 'row', text: String(r + 2) }),
          el('th', { class: 'c-mes', scope: 'row' }, m.nome, m.chave === mesHoje ? el('span', { class: 'etiqueta', text: 'agora' }) : null),
          el('td', { class: 'num', text: m.receitas ? fmt.moeda(m.receitas) : '' }),
          el('td', { class: 'num', text: m.despesas ? fmt.moeda(m.despesas) : '' }),
          el('td', { class: 'num' + (m.restante < 0 ? ' negativo' : ''), text: temValor ? fmt.moeda(m.restante) : '' }),
          el('td', { class: 'num', text: m.receitas ? fmt.pct(m.restante / m.receitas) : '' }),
          m.pessoas.map((x) => el('td', { class: 'num' + (x.restante < 0 ? ' negativo' : ''), text: x.receitas || x.despesas ? fmt.moeda(x.restante) : '' }))));
      });
      const soma = (f) => LC.arred(resumo.reduce((s, m) => s + f(m), 0));
      const R = soma((m) => m.receitas), G = soma((m) => m.despesas);
      tabela.append(corpo, el('tfoot', null, el('tr', null, el('th', { class: 'c-num' }), el('th', { class: 'c-mes', scope: 'row', text: 'Total' }),
        el('td', { class: 'num', text: fmt.moeda(R) }), el('td', { class: 'num', text: fmt.moeda(G) }),
        el('td', { class: 'num' + (R - G < 0 ? ' negativo' : ''), text: fmt.moeda(R - G) }),
        el('td', { class: 'num', text: R ? fmt.pct((R - G) / R) : '' }),
        pessoas.map((p, k) => { const v = soma((m) => m.pessoas[k].restante); return el('td', { class: 'num' + (v < 0 ? ' negativo' : ''), text: fmt.moeda(v) }); }))));
      raiz.append(el('div', { class: 'cartao planilha' },
        el('div', { class: 'barra-formula', 'aria-hidden': 'true' }, el('span', { class: 'fx-ref', text: 'B2' }), el('span', { class: 'fx-rotulo', text: 'fx' }),
          el('span', { class: 'fx-valor', text: `=${pessoas.map((p) => `'Gastos ${p.nome}'!Salário`).join(' + ')}` })),
        el('div', { class: 'grade-rolagem' }, tabela),
        el('div', { class: 'barra-status' },
          el('span', null, el('span', { class: 'apagado', text: `Recebido em ${anoSel} ` }), el('strong', { text: fmt.moeda(R) })),
          el('span', null, el('span', { class: 'apagado', text: 'Gasto ' }), el('strong', { text: fmt.moeda(G) })),
          el('span', null, el('span', { class: 'apagado', text: 'Restante ' }), el('strong', { class: R - G < 0 ? 'negativo' : '', text: fmt.moeda(R - G) })))));
      raiz.append(el('p', { class: 'ajuda mensal-dica', text: 'Esta aba só soma as planilhas das pessoas, como a "Total finanças" do Excel. Para mudar valores, use a aba de cada pessoa.' }));
      renderGrafico({ tipo: 'colunas', medida: 'fluxo', agrupar: 'mes', rotulos: 'nenhum' }, `Recebido x gasto em ${anoSel}`, anoSel);
    }

    // Gráfico simples abaixo da planilha (o ano inteiro, sem os filtros do painel).
    function renderGrafico(cfgBase, titulo, anoSel) {
      if (typeof Chart === 'undefined') return;
      const est = ctx.estado();
      const f = { inicio: `${anoSel}-01-01`, fim: `${anoSel}-12-31`, meses: 12, pessoa: 'todas', situacao: 'todas' };
      const dados = Dd.dadosGrafico(Dd.normalizarGrafico(cfgBase), est, f, ctx.hoje());
      const dica = el('div', { class: 'dica', hidden: true });
      const canvas = el('canvas', { role: 'img', 'aria-label': titulo + '. Os valores estão na tabela acima.' });
      const leg = el('div', { class: 'cg-legenda' });
      const cartao = el('section', { class: 'cartao cg mensal-grafico', style: { '--altura-grafico': '240px' } },
        el('header', { class: 'cg-cabeca' }, el('div', { class: 'cg-titulos' }, el('h3', { class: 'cg-titulo', text: titulo }), el('p', { class: 'cg-sub', text: 'Mês a mês, com o restante em linha' }))),
        leg, el('div', { class: 'cg-corpo' }, canvas, dica));
      raiz.append(cartao);
      if (dados.vazio) { cartao.hidden = true; return; }
      LC.Graficos.registrar();
      vista.grafico = new Chart(canvas, LC.Graficos.montarConfig(dados, { dica }));
      for (const ds of vista.grafico.data.datasets) {
        const linha = ds.type === 'line';
        leg.append(el('span', { class: 'leg-item' }, el('span', { class: 'leg-marca' + (linha ? ' leg-marca-linha' : ''), style: { background: linha ? ds.borderColor : ds.backgroundColor } }), el('span', { class: 'leg-nome', text: ds.label })));
      }
    }

    // ── Colunas e pessoas ────────────────────────────────────────────────
    function menuNovaColuna(ancora, pessoaId) {
      const est = ctx.estado();
      const pessoa = est.pessoas.find((p) => p.id === pessoaId);
      const livres = est.categorias.filter((c) => !pessoa.colunas.includes(c.id));
      const itens = livres.slice(0, 18).map((c) => ({
        rotulo: `${c.nome}${c.tipo === 'receita' ? ' (recebimento)' : ''}`, icone: 'adicionar',
        acao: () => { ctx.alterar((e) => { const p = e.pessoas.find((x) => x.id === pessoaId); if (p && !p.colunas.includes(c.id)) p.colunas.push(c.id); }); },
      }));
      if (itens.length) itens.push({ separador: true });
      itens.push({ rotulo: 'Nova categoria…', icone: 'cadastros', acao: () => novaCategoria(pessoaId) });
      LC.UI.menu(ancora, itens);
    }

    async function novaCategoria(pessoaId) {
      const nome = el('input', { id: 'nova-cat-nome', class: 'entrada', type: 'text', maxlength: '60', placeholder: 'Ex.: Mercado, Luz, Pix recebido', autocomplete: 'off' });
      let tipo = 'despesa';
      const corpo = el('div', { class: 'form-lancamento' },
        LC.UI.campo('Nome da coluna', nome),
        LC.UI.campo('Tipo', LC.UI.segmentado([{ valor: 'despesa', rotulo: 'Gasto' }, { valor: 'receita', rotulo: 'Recebimento' }], 'despesa', (v) => { tipo = v; }, { rotulo: 'Tipo', compacto: true }), { para: null }));
      setTimeout(() => nome.focus(), 30);
      const ok = await LC.UI.confirmar({ titulo: 'Nova coluna', texto: null, detalhe: corpo, botao: 'Adicionar coluna' });
      const v = nome.value.trim();
      if (!ok || !v) return;
      ctx.alterar((e) => {
        let cat = e.categorias.find((c) => c.tipo === tipo && Dd.chaveNome(c.nome) === Dd.chaveNome(v));
        if (!cat) {
          cat = { id: LC.novoId('c'), nome: v.slice(0, 60), tipo, cor: Dd.proximaCor(e.categorias.filter((c) => c.tipo === tipo)), orcamento: 0 };
          e.categorias.push(cat);
        }
        const p = e.pessoas.find((x) => x.id === pessoaId);
        if (p && !p.colunas.includes(cat.id)) p.colunas.push(cat.id);
      });
    }

    function menuColuna(ancora, pessoaId, catId, extra, anoSel) {
      const est = ctx.estado();
      const pessoa = est.pessoas.find((p) => p.id === pessoaId);
      const i = pessoa.colunas.indexOf(catId);
      const mover = (d) => ctx.alterar((e) => {
        const p = e.pessoas.find((x) => x.id === pessoaId);
        const j = p.colunas.indexOf(catId);
        if (j < 0 || j + d < 0 || j + d >= p.colunas.length) return;
        p.colunas.splice(j, 1);
        p.colunas.splice(j + d, 0, catId);
      });
      const itens = extra
        ? [{ rotulo: 'Fixar nas colunas desta pessoa', icone: 'adicionar', acao: () => ctx.alterar((e) => { const p = e.pessoas.find((x) => x.id === pessoaId); if (p && !p.colunas.includes(catId)) p.colunas.push(catId); }) }]
        : [
          { rotulo: 'Mover para a esquerda', icone: 'chevron-esq', desativado: i <= 0, acao: () => mover(-1) },
          { rotulo: 'Mover para a direita', icone: 'chevron-dir', desativado: i < 0 || i >= pessoa.colunas.length - 1, acao: () => mover(1) },
          { separador: true },
          {
            rotulo: 'Tirar coluna desta planilha', icone: 'lixeira', perigo: true,
            acao: () => {
              const temValor = est.lancamentos.some((t) => t.pessoa === pessoaId && t.categoria === catId && t.data.startsWith(anoSel + '-'));
              if (temValor) { LC.UI.aviso(`Esta coluna tem valores em ${anoSel}. Apague os valores (tecla Delete nas células) antes de tirar a coluna.`, { tipo: 'erro', duracao: 8000 }); return; }
              ctx.alterar((e) => { const p = e.pessoas.find((x) => x.id === pessoaId); if (p) p.colunas = p.colunas.filter((x) => x !== catId); });
            },
          },
        ];
      LC.UI.menu(ancora, itens);
    }

    async function novaPessoa() {
      const nome = el('input', { id: 'nova-pessoa-nome', class: 'entrada', type: 'text', maxlength: '40', placeholder: 'Ex.: Casa, Nathy, Vini', autocomplete: 'off' });
      setTimeout(() => nome.focus(), 30);
      const ok = await LC.UI.confirmar({ titulo: 'Nova pessoa', texto: 'Cada pessoa tem a própria planilha mensal, como as abas "Gastos" do Excel. Ela começa com a coluna Salário; adicione as outras depois.', detalhe: LC.UI.campo('Nome', nome), botao: 'Criar planilha' });
      const v = nome.value.trim();
      if (!ok || !v) return;
      const id = LC.novoId('p');
      ctx.alterar((e) => {
        e.pessoas.push({ id, nome: v.slice(0, 40), cor: Dd.proximaCor(e.pessoas), saldoInicial: 0, colunas: e.categorias.some((c) => c.id === 'salario') ? ['salario'] : [] });
      });
      ctx.salvarPrefs({ abaMensal: id });
      render();
    }

    return { render, destruir() { if (vista.grafico) { vista.grafico.destroy(); vista.grafico = null; } } };
  }

  LC.Mensal = { criar };
})(globalThis.LC = globalThis.LC || {});
