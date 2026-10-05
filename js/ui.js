/*
 * ui.js — Peças de interface reutilizadas: avisos, confirmação, menus, seletor de cor e controles.
 * Sem alert()/confirm()/prompt(): tudo acontece dentro da página.
 */
(function (LC) {
  'use strict';

  const { el, icone, esvaziar } = LC;

  // ── Avisos (toasts) ──────────────────────────────────────────────────────
  function aviso(texto, { tipo = 'info', acao = null, duracao = 4500 } = {}) {
    const regiao = document.getElementById('avisos');
    if (!regiao) return;
    const nome = { ok: 'check', erro: 'alerta', info: 'info' }[tipo] || 'info';
    const item = el('div', { class: `aviso aviso-${tipo}`, role: tipo === 'erro' ? 'alert' : 'status' },
      icone(nome, 'ico ico-aviso'), el('span', { class: 'aviso-texto', text: texto }));
    let timer;
    const fechar = () => { clearTimeout(timer); item.classList.add('saindo'); setTimeout(() => item.remove(), 180); };
    if (acao) item.append(el('button', { class: 'aviso-acao', type: 'button', onclick: () => { fechar(); acao.fn(); } }, acao.rotulo));
    item.append(el('button', { class: 'aviso-fechar', type: 'button', 'aria-label': 'Fechar aviso', onclick: fechar }, icone('fechar')));
    regiao.append(item);
    while (regiao.children.length > 3) regiao.firstElementChild.remove();
    if (duracao) timer = setTimeout(fechar, acao ? duracao + 3000 : duracao);
    return fechar;
  }

  // ── Confirmação ──────────────────────────────────────────────────────────
  function confirmar({ titulo, texto, botao = 'Confirmar', perigo = false, detalhe = null }) {
    return new Promise((resolve) => {
      const dlg = el('dialog', { class: 'dialogo dialogo-pequeno', 'aria-labelledby': 'confirmar-titulo' });
      const ok = el('button', { class: perigo ? 'botao botao-perigo' : 'botao botao-primario', type: 'button' }, botao);
      const cancelar = el('button', { class: 'botao', type: 'button' }, 'Cancelar');
      dlg.append(
        el('div', { class: 'dialogo-corpo' },
          el('h2', { id: 'confirmar-titulo', class: 'dialogo-titulo', text: titulo }),
          texto ? el('p', { class: 'dialogo-texto', text: texto }) : null,
          detalhe),
        el('div', { class: 'dialogo-rodape' }, cancelar, ok));
      let resposta = false;
      ok.addEventListener('click', () => { resposta = true; dlg.close(); });
      cancelar.addEventListener('click', () => dlg.close());
      dlg.addEventListener('close', () => { dlg.remove(); resolve(resposta); });
      document.body.append(dlg);
      dlg.showModal();
      (perigo ? cancelar : ok).focus();
    });
  }

  // ── Popover genérico (menus e seletor de cor) ───────────────────────────
  let popoverAberto = null;

  function fecharPopover() {
    if (!popoverAberto) return;
    const { caixa, ancora, aoFechar } = popoverAberto;
    popoverAberto = null;
    caixa.remove();
    if (ancora) ancora.setAttribute('aria-expanded', 'false');
    if (aoFechar) aoFechar();
  }

  function abrirPopover(ancora, caixa, { aoFechar, alinhar = 'fim' } = {}) {
    const mesmo = popoverAberto && popoverAberto.ancora === ancora;
    fecharPopover();
    if (mesmo) return null;
    const hospedeiro = ancora.closest('dialog') || document.body;
    hospedeiro.append(caixa);
    ancora.setAttribute('aria-expanded', 'true');
    popoverAberto = { caixa, ancora, aoFechar };
    const posicionar = () => {
      const r = ancora.getBoundingClientRect();
      const larg = caixa.offsetWidth, alt = caixa.offsetHeight;
      let x = alinhar === 'fim' ? r.right - larg : r.left;
      x = Math.max(8, Math.min(x, window.innerWidth - larg - 8));
      let y = r.bottom + 6;
      if (y + alt > window.innerHeight - 8 && r.top - alt - 6 > 8) y = r.top - alt - 6;
      caixa.style.left = `${Math.round(x)}px`;
      caixa.style.top = `${Math.round(y)}px`;
    };
    posicionar();
    return caixa;
  }

  document.addEventListener('pointerdown', (e) => {
    if (popoverAberto && !popoverAberto.caixa.contains(e.target) && !popoverAberto.ancora.contains(e.target)) fecharPopover();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popoverAberto) {
      const ancora = popoverAberto.ancora;
      fecharPopover();
      ancora.focus();
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
  window.addEventListener('resize', fecharPopover);
  window.addEventListener('scroll', (e) => {
    if (popoverAberto && !popoverAberto.caixa.contains(e.target)) fecharPopover();
  }, true);

  // itens: [{ rotulo, icone, acao, perigo, separador }]
  function menu(ancora, itens) {
    const caixa = el('div', { class: 'popover menu', role: 'menu' });
    for (const it of itens) {
      if (it.separador) { caixa.append(el('div', { class: 'menu-separador', role: 'separator' })); continue; }
      caixa.append(el('button', {
        class: 'menu-item' + (it.perigo ? ' perigo' : ''), type: 'button', role: 'menuitem', disabled: it.desativado,
        onclick: () => { fecharPopover(); it.acao(); },
      }, it.icone ? icone(it.icone) : null, el('span', { text: it.rotulo })));
    }
    if (!abrirPopover(ancora, caixa)) return;
    caixa.addEventListener('keydown', (e) => {
      const botoes = [...caixa.querySelectorAll('.menu-item:not([disabled])')];
      const i = botoes.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); botoes[(i + 1) % botoes.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); botoes[(i - 1 + botoes.length) % botoes.length].focus(); }
    });
    const primeiro = caixa.querySelector('.menu-item:not([disabled])');
    if (primeiro) primeiro.focus();
  }

  // Seletor de cor: as 8 cores da paleta (seguem o tema), cinza neutro e uma cor livre.
  function escolherCor(ancora, atual, aoEscolher, { permitirPadrao = false } = {}) {
    const caixa = el('div', { class: 'popover seletor-cor', role: 'dialog', 'aria-label': 'Escolher cor' });
    const grade = el('div', { class: 'seletor-cor-grade' });
    const opcoes = [...LC.NOMES_CORES.map((nome, i) => ['p' + (i + 1), nome]), ['neutro', 'Cinza']];
    for (const [ref, nome] of opcoes) {
      grade.append(el('button', {
        class: 'amostra' + (ref === atual ? ' selecionada' : ''), type: 'button', title: nome, 'aria-label': nome,
        'aria-pressed': ref === atual ? 'true' : 'false',
        style: { background: LC.cor(ref) }, onclick: () => { fecharPopover(); aoEscolher(ref); },
      }));
    }
    const livre = el('input', { type: 'color', id: 'cor-livre', value: /^#/.test(atual || '') ? atual : LC.cor(atual) });
    livre.addEventListener('change', () => { aoEscolher(livre.value); fecharPopover(); });
    caixa.append(grade, el('label', { class: 'seletor-cor-livre', for: 'cor-livre' }, livre, el('span', { text: 'Outra cor…' })));
    if (permitirPadrao) {
      caixa.append(el('button', { class: 'botao botao-pequeno botao-fantasma', type: 'button', onclick: () => { fecharPopover(); aoEscolher(null); } }, 'Usar a cor padrão'));
    }
    if (abrirPopover(ancora, caixa, { alinhar: 'inicio' })) caixa.querySelector('.amostra').focus();
  }

  // ── Controles de formulário ──────────────────────────────────────────────

  function segmentado(opcoes, atual, aoMudar, { rotulo, compacto = false } = {}) {
    const grupo = el('div', { class: 'segmentado' + (compacto ? ' compacto' : ''), role: 'radiogroup', 'aria-label': rotulo });
    const marcar = (valor) => {
      for (const b of grupo.children) {
        const sim = b.dataset.valor === String(valor);
        b.setAttribute('aria-checked', sim ? 'true' : 'false');
        b.tabIndex = sim ? 0 : -1;
      }
    };
    for (const op of opcoes) {
      grupo.append(el('button', {
        type: 'button', role: 'radio', class: 'segmento', dataset: { valor: String(op.valor) }, title: op.titulo || op.rotulo,
        disabled: op.desativado, 'aria-label': op.icone && !op.mostrarRotulo ? op.rotulo : null,
        onclick: () => { marcar(op.valor); aoMudar(op.valor); },
      }, op.icone ? icone(op.icone) : null, !op.icone || op.mostrarRotulo ? el('span', { text: op.rotulo }) : null));
    }
    grupo.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const botoes = [...grupo.children].filter((b) => !b.disabled);
      const i = botoes.indexOf(document.activeElement);
      const prox = botoes[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + botoes.length) % botoes.length];
      e.preventDefault();
      prox.focus();
      prox.click();
    });
    marcar(atual);
    return grupo;
  }

  function interruptor(id, rotulo, ligado, aoMudar, { ajuda } = {}) {
    const entrada = el('input', { type: 'checkbox', role: 'switch', id, class: 'interruptor-entrada', checked: ligado });
    entrada.addEventListener('change', () => aoMudar(entrada.checked));
    return el('label', { class: 'interruptor', for: id },
      el('span', { class: 'interruptor-textos' }, el('span', { class: 'interruptor-rotulo', text: rotulo }), ajuda ? el('span', { class: 'ajuda', text: ajuda }) : null),
      entrada, el('span', { class: 'interruptor-trilho', 'aria-hidden': 'true' }));
  }

  function selecao(id, opcoes, atual, aoMudar, props = {}) {
    const s = el('select', { id, class: 'entrada', ...props });
    for (const op of opcoes) {
      if (op.grupo) {
        const g = el('optgroup', { label: op.grupo });
        for (const [v, r] of op.itens) g.append(el('option', { value: v, selected: String(v) === String(atual) }, r));
        s.append(g);
      } else {
        const [v, r, desativado] = op;
        s.append(el('option', { value: v, selected: String(v) === String(atual), disabled: desativado }, r));
      }
    }
    s.value = String(atual ?? '');
    s.addEventListener('change', () => aoMudar(s.value));
    return s;
  }

  function campo(rotulo, controle, { ajuda, para, classe = '' } = {}) {
    return el('div', { class: 'campo ' + classe },
      el('label', { class: 'campo-rotulo', for: para || controle.id || null, text: rotulo }),
      controle,
      ajuda ? el('p', { class: 'ajuda', text: ajuda }) : null);
  }

  LC.UI = { aviso, confirmar, menu, escolherCor, fecharPopover, segmentado, interruptor, selecao, campo, esvaziar };
})(globalThis.LC = globalThis.LC || {});
