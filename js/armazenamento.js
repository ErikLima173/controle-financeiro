/*
 * armazenamento.js — Onde o livro-caixa fica guardado e como os arquivos são entregues.
 *
 *   index.html aberto no PC ─► localStorage do navegador (backup .json pela tela Cadastros)
 *   com o Firebase ligado (js/config-nuvem.js) ─► login e livro compartilhado no Firestore (js/nuvem.js)
 *   publicado como artefato no Claude ─► banco do artefato, privado (só dono e editores)
 *   Nos dois bancos, os mesmos documentos:
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
    return { config: { versao: 2, pessoas: est.pessoas, categorias: est.categorias, graficos: est.graficos, novidades: est.novidades || [] }, meses };
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

  // ── Banco na nuvem (artefato do Claude ou Firebase) ──────────────────────

  const MENSAGENS_DB = {
    quota_exceeded: 'O espaço do livro-caixa na nuvem acabou. Exporte um backup e apague lançamentos antigos.',
    invalid_argument: 'Você não tem permissão para alterar este livro-caixa (só o dono e editores podem).',
    resource_exhausted: 'Muitas alterações seguidas. Espere alguns segundos; o salvamento continua sozinho.',
    revoked: 'O acesso a este livro-caixa foi retirado. Exporte um backup do que está na tela.',
    // Firebase (Cloud Firestore)
    'permission-denied': 'O livro-caixa não aceitou a alteração: o seu e-mail saiu da lista de quem usa, ou as regras do Firebase não deixam. Baixe um backup do que está na tela e peça para alguém da lista conferir em Cadastros.',
    'resource-exhausted': 'O limite gratuito do banco de dados acabou por hoje. As alterações continuam na tela; baixe um backup para não perder nada.',
    unauthenticated: 'A sessão expirou. Saia e entre de novo.',
  };

  function erroDb(e) {
    const codigo = e && e.code;
    return Object.assign(new Error(MENSAGENS_DB[codigo] || 'Não foi possível salvar na nuvem agora. Suas alterações continuam na tela; tente de novo em instantes.'), { codigo });
  }

  /*
   * db: doc(caminho) → documento com set, delete, collection e onSnapshot (o banco do Claude e o Firestore falam igual).
   * Se db.confirmar existir (Firebase), cada gravação entra na fila do banco na hora, sem esperar o servidor:
   * sem internet, o banco guarda no aparelho e envia quando ela volta. Erros que chegam depois vão para escutarErros.
   * obterEstado() devolve null enquanto a tela mostra só valores de exemplo: aí tudo o que vem de fora vale.
   */
  function adaptadorNuvem(db, { obterEstado, provedor = 'claude' }) {
    const docConfig = db.doc('livro/config');
    const colMeses = docConfig.collection('meses');
    const confirmar = typeof db.confirmar === 'function' ? db.confirmar : null;
    let salvoConfig = null;
    const salvoMes = new Map();
    let fila = Promise.resolve();
    let aoMudar = () => {};
    let aoErro = () => {};
    let pronto = false;

    // Espera a resposta do banco (Claude) ou só põe na fila e segue (Firebase).
    function enviar(fn, desfazer) {
      const p = tentar(fn);
      if (!confirmar) return p.catch((e) => { desfazer(); throw erroDb(e); });
      p.catch((e) => { desfazer(); aoErro(erroDb(e)); });
      return null;
    }

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
        await enviar(() => docConfig.set(config), () => { salvoConfig = antes; });
      }
      for (const [k, itens] of meses) {
        const j = jsonEstavel(itens);
        if (j === salvoMes.get(k)) continue;
        if (j.length > 250000) throw new Error(`O mês ${LC.fmt.mesLongo(k)} tem lançamentos demais para um só documento. Mova parte deles para outro mês ou exporte um backup.`);
        const antes = salvoMes.get(k);
        salvoMes.set(k, j);
        await enviar(() => colMeses.doc(k).set({ itens }), () => { if (antes === undefined) salvoMes.delete(k); else salvoMes.set(k, antes); });
      }
      for (const k of [...salvoMes.keys()]) {
        if (meses.has(k)) continue;
        const antes = salvoMes.get(k);
        salvoMes.delete(k);
        await enviar(() => colMeses.doc(k).delete(), () => salvoMes.set(k, antes));
      }
    }

    // Mudança vinda de outro aparelho: aplica só o que não tem alteração local esperando para salvar.
    function recebeuConfig(dados) {
      if (!dados) return;
      const j = jsonEstavel(dados);
      if (j === salvoConfig) return;
      const est = obterEstado();
      if (est && jsonEstavel(separar(est).config) !== salvoConfig) return;
      salvoConfig = j;
      aoMudar({ config: dados });
    }

    function recebeuMeses(docs) {
      const est = obterEstado();
      const local = est ? separar(est).meses : null;
      const mudancas = new Map();
      const vistos = new Set();
      for (const [k, dados] of docs) {
        vistos.add(k);
        const itens = Array.isArray(dados && dados.itens) ? dados.itens : [];
        const j = jsonEstavel(itens);
        if (j === salvoMes.get(k)) continue;
        if (local && jsonEstavel(local.get(k) || []) !== (salvoMes.get(k) ?? '[]')) continue;
        salvoMes.set(k, j);
        mudancas.set(k, itens);
      }
      for (const k of [...salvoMes.keys()]) {
        if (vistos.has(k)) continue;
        if (local && jsonEstavel(local.get(k) || []) !== salvoMes.get(k)) continue;
        salvoMes.delete(k);
        mudancas.set(k, null);
      }
      if (mudancas.size) aoMudar({ meses: mudancas });
    }

    // Escuta que falha depois de aberto: no Firebase é perda de acesso (sem internet ele não dá erro, espera).
    const erroDepois = (e) => { if (provedor === 'firebase') aoErro(erroDb(e)); };

    return {
      modo: 'nuvem',
      provedor,
      descricao: provedor === 'firebase' ? 'Salvo na nuvem' : 'Salvo na nuvem do Claude',
      carregar() {
        return new Promise((resolve) => {
          let config, docs, defConfig = false, defMeses = false;
          const concluir = (forcado, erro) => {
            if (pronto) return;
            const temTudo = config !== undefined && docs !== undefined;
            // Vazio que veio só da cópia do aparelho pode ser falta de internet: aí espera o servidor.
            const daCopia = forcado && temTudo && (config || docs.length);
            if (!(defConfig && defMeses) && !daCopia) {
              if (forcado === 'limite') { pronto = true; resolve({ falhou: true, erro }); }
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
          // Firestore só avisa a troca "cópia do aparelho → servidor" quando a escuta pede (db.opcoesEscuta).
          const escutar = (ref, prox, erro) => (db.opcoesEscuta ? ref.onSnapshot(db.opcoesEscuta, prox, erro) : ref.onSnapshot(prox, erro));
          escutar(docConfig, (snap) => {
            config = snap.exists ? snap.data() : null;
            defConfig = defConfig || !snap.metadata.fromCache;
            if (pronto) recebeuConfig(config); else concluir();
          }, (e) => (pronto ? erroDepois(e) : concluir('limite', e)));
          escutar(colMeses, (qs) => {
            docs = qs.docs.filter((d) => d.exists).map((d) => [d.id, d.data()]);
            defMeses = defMeses || !qs.metadata.fromCache;
            if (pronto) recebeuMeses(docs); else concluir();
          }, (e) => (pronto ? erroDepois(e) : concluir('limite', e)));
          setTimeout(() => concluir('tempo'), 5000);
          setTimeout(() => concluir('limite'), 15000);
        });
      },
      // Resolve quando o banco recebeu tudo (no Firebase, quando o servidor confirmou).
      salvar(est) {
        const copia = JSON.parse(JSON.stringify(est));
        fila = fila.catch(() => {}).then(() => gravar(copia));
        return confirmar ? fila.then(() => confirmar()) : fila;
      },
      escutar(fn) { aoMudar = fn; },
      escutarErros(fn) { aoErro = fn; },
    };
  }

  // Escolhe onde salvar: banco do artefato no Claude, Firebase se configurado, ou o navegador.
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
    if (LC.Nuvem && LC.Nuvem.configurada()) {
      const sessao = await LC.Nuvem.abrir(); // telas de login e cadastro até haver um livro-caixa aberto
      return Object.assign(adaptadorNuvem(sessao.db, { ...opcoes, provedor: 'firebase' }), { sessao });
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
