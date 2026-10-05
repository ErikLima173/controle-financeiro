/*
 * armazenamento.js — Onde o livro-caixa fica guardado e como os arquivos são entregues.
 *
 *   index.html aberto no PC ─► localStorage do navegador (backup .json pela tela Cadastros)
 *   publicado como artefato no Claude ─► banco do artefato, privado (só dono e editores):
 *       livro/config                  pessoas, categorias e gráficos
 *       livro/config/meses/AAAA-MM    { itens: [...] }   um documento por mês
 *
 * Só grava quando a pessoa muda algo, e só o que mudou (compara com o último estado salvo).
 */
(function (LC) {
  'use strict';

  const CHAVE = 'livro-caixa/v1';
  const CHAVE_PREFS = 'livro-caixa/prefs';
  const { jsonEstavel } = LC;

  function lerPrefs() {
    try { return JSON.parse(localStorage.getItem(CHAVE_PREFS)) || {}; } catch (_) { return {}; }
  }
  function gravarPrefs(p) {
    try { localStorage.setItem(CHAVE_PREFS, JSON.stringify(p)); } catch (_) { /* preferência é conveniência */ }
  }

  function separar(est) {
    const meses = new Map();
    for (const t of est.lancamentos) {
      const k = t.data.slice(0, 7);
      if (!meses.has(k)) meses.set(k, []);
      meses.get(k).push(t);
    }
    return { config: { versao: 2, pessoas: est.pessoas, categorias: est.categorias, graficos: est.graficos }, meses };
  }

  // ── Navegador ────────────────────────────────────────────────────────────

  function adaptadorLocal(motivo) {
    let ultimo = null;
    return {
      modo: 'local',
      descricao: 'Salvo neste navegador',
      motivo,
      async carregar() {
        try {
          const s = localStorage.getItem(CHAVE);
          if (!s) return null;
          ultimo = s;
          return JSON.parse(s);
        } catch (_) { return null; }
      },
      async salvar(est) {
        const s = JSON.stringify(est);
        if (s === ultimo) return;
        try {
          localStorage.setItem(CHAVE, s);
        } catch (e) {
          throw new Error(e && e.name === 'QuotaExceededError'
            ? 'O navegador ficou sem espaço para o livro-caixa. Exporte um backup e apague lançamentos antigos.'
            : 'Este navegador bloqueou o salvamento (janela anônima ou dados do site bloqueados). Exporte um backup para não perder nada.');
        }
        ultimo = s;
      },
      // Outra aba do mesmo navegador salvou: recarrega o estado inteiro.
      escutar(aoMudar) {
        window.addEventListener('storage', (e) => {
          if (e.key !== CHAVE || !e.newValue || e.newValue === ultimo) return;
          ultimo = e.newValue;
          try { aoMudar({ estado: JSON.parse(e.newValue) }); } catch (_) { /* ignora estado corrompido */ }
        });
      },
    };
  }

  // ── Banco do artefato (Claude) ───────────────────────────────────────────

  const MENSAGENS_DB = {
    quota_exceeded: 'O espaço do livro-caixa na nuvem acabou. Exporte um backup e apague lançamentos antigos.',
    invalid_argument: 'Você não tem permissão para alterar este livro-caixa (só o dono e editores podem).',
    resource_exhausted: 'Muitas alterações seguidas. Espere alguns segundos; o salvamento continua sozinho.',
    revoked: 'O acesso a este livro-caixa foi retirado. Exporte um backup do que está na tela.',
  };

  function erroDb(e) {
    const codigo = e && e.code;
    return Object.assign(new Error(MENSAGENS_DB[codigo] || 'Não foi possível salvar na nuvem agora. Suas alterações continuam na tela; tente de novo em instantes.'), { codigo });
  }

  function adaptadorNuvem(db, { obterEstado }) {
    const docConfig = db.doc('livro/config');
    const colMeses = docConfig.collection('meses');
    let salvoConfig = null;
    const salvoMes = new Map();
    let fila = Promise.resolve();
    let aoMudar = () => {};
    let pronto = false;

    async function tentar(fn) {
      try { return await fn(); } catch (e) {
        if (e && e.code === 'unavailable') {
          await new Promise((r) => setTimeout(r, 400 + Math.random() * 900));
          return fn();
        }
        throw e;
      }
    }

    async function gravar(est) {
      const { config, meses } = separar(est);
      const jc = jsonEstavel(config);
      if (jc !== salvoConfig) {
        const antes = salvoConfig;
        salvoConfig = jc;
        try { await tentar(() => docConfig.set(config)); } catch (e) { salvoConfig = antes; throw erroDb(e); }
      }
      for (const [k, itens] of meses) {
        const j = jsonEstavel(itens);
        if (j === salvoMes.get(k)) continue;
        if (j.length > 250000) throw new Error(`O mês ${LC.fmt.mesLongo(k)} tem lançamentos demais para um só documento. Mova parte deles para outro mês ou exporte um backup.`);
        const antes = salvoMes.get(k);
        salvoMes.set(k, j);
        try { await tentar(() => colMeses.doc(k).set({ itens })); } catch (e) {
          if (antes === undefined) salvoMes.delete(k); else salvoMes.set(k, antes);
          throw erroDb(e);
        }
      }
      for (const k of [...salvoMes.keys()]) {
        if (meses.has(k)) continue;
        const antes = salvoMes.get(k);
        salvoMes.delete(k);
        try { await tentar(() => colMeses.doc(k).delete()); } catch (e) { salvoMes.set(k, antes); throw erroDb(e); }
      }
    }

    // Mudança vinda de outro aparelho: aplica só o que não tem alteração local esperando para salvar.
    function recebeuConfig(dados) {
      if (!dados) return;
      const j = jsonEstavel(dados);
      if (j === salvoConfig) return;
      const local = jsonEstavel(separar(obterEstado()).config);
      if (local !== salvoConfig) return;
      salvoConfig = j;
      aoMudar({ config: dados });
    }

    function recebeuMeses(docs) {
      const local = separar(obterEstado()).meses;
      const mudancas = new Map();
      const vistos = new Set();
      for (const [k, dados] of docs) {
        vistos.add(k);
        const itens = Array.isArray(dados && dados.itens) ? dados.itens : [];
        const j = jsonEstavel(itens);
        if (j === salvoMes.get(k)) continue;
        if (jsonEstavel(local.get(k) || []) !== (salvoMes.get(k) ?? '[]')) continue;
        salvoMes.set(k, j);
        mudancas.set(k, itens);
      }
      for (const k of [...salvoMes.keys()]) {
        if (vistos.has(k)) continue;
        if (jsonEstavel(local.get(k) || []) !== salvoMes.get(k)) continue;
        salvoMes.delete(k);
        mudancas.set(k, null);
      }
      if (mudancas.size) aoMudar({ meses: mudancas });
    }

    return {
      modo: 'nuvem',
      descricao: 'Salvo na nuvem do Claude',
      carregar() {
        return new Promise((resolve) => {
          let config, docs, defConfig = false, defMeses = false;
          const concluir = (forcado) => {
            if (pronto) return;
            const temTudo = config !== undefined && docs !== undefined;
            if (!(defConfig && defMeses) && !(forcado && temTudo)) {
              if (forcado === 'limite') { pronto = true; resolve({ falhou: true }); }
              return;
            }
            pronto = true;
            salvoConfig = config ? jsonEstavel(config) : null;
            for (const [k, d] of docs) salvoMes.set(k, jsonEstavel(Array.isArray(d && d.itens) ? d.itens : []));
            if (!config && !docs.length) { resolve(null); return; }
            resolve({
              ...(config || {}),
              lancamentos: docs.flatMap(([, d]) => (Array.isArray(d && d.itens) ? d.itens : [])),
            });
          };
          docConfig.onSnapshot((snap) => {
            config = snap.exists ? snap.data() : null;
            defConfig = defConfig || !snap.metadata.fromCache;
            if (pronto) recebeuConfig(config); else concluir();
          }, () => concluir('limite'));
          colMeses.onSnapshot((qs) => {
            docs = qs.docs.filter((d) => d.exists).map((d) => [d.id, d.data()]);
            defMeses = defMeses || !qs.metadata.fromCache;
            if (pronto) recebeuMeses(docs); else concluir();
          }, () => concluir('limite'));
          setTimeout(() => concluir('tempo'), 5000);
          setTimeout(() => concluir('limite'), 15000);
        });
      },
      salvar(est) {
        const copia = JSON.parse(JSON.stringify(est));
        fila = fila.catch(() => {}).then(() => gravar(copia));
        return fila;
      },
      escutar(fn) { aoMudar = fn; },
    };
  }

  // Escolhe onde salvar. Fora do Claude (arquivo local) não existe window.claude.
  async function iniciar(opcoes) {
    const claude = typeof window !== 'undefined' ? window.claude : null;
    if (claude && typeof claude.use === 'function') {
      let db = null;
      try { db = await claude.use('db'); } catch (_) { db = null; }
      if (db) {
        let editor = null;
        try {
          const usuario = await claude.use('user');
          if (usuario) editor = await usuario.canEdit();
        } catch (_) { editor = null; }
        if (editor !== false) return adaptadorNuvem(db, opcoes);
        return adaptadorLocal('leitor');
      }
    }
    return adaptadorLocal();
  }

  // Entrega um arquivo gerado: no Claude pede confirmação ao visitante; no PC, download comum.
  async function baixar(nome, dados, tipo) {
    const blob = dados instanceof Blob ? dados : new Blob([dados], { type: tipo || 'application/octet-stream' });
    const claude = typeof window !== 'undefined' ? window.claude : null;
    if (claude && typeof claude.use === 'function') {
      let downloads = null;
      try { downloads = await claude.use('downloads'); } catch (_) { downloads = null; }
      if (downloads) {
        try {
          await downloads.save({ filename: nome, data: blob });
          return true;
        } catch (e) {
          if (e && e.code === 'declined') return false;
          if (e && e.code === 'rate_limited') throw new Error('Já existe um download esperando sua confirmação.');
          throw new Error('Não foi possível baixar o arquivo aqui. Tente abrir o Livro-Caixa no navegador.');
        }
      }
    }
    const url = URL.createObjectURL(blob);
    const a = LC.el('a', { href: url, download: nome, style: { display: 'none' } });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  }

  LC.Armazenamento = { iniciar, local: adaptadorLocal, baixar, lerPrefs, gravarPrefs, separar };
})(globalThis.LC = globalThis.LC || {});
