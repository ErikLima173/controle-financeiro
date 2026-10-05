/*
 * util.js — Formatação pt-BR, datas, números, cores e DOM. Sem dependências.
 *
 *   "1.234,56" ─► paraNumero ─► 1234.56 ─► fmt.moeda ─► "R$ 1.234,56"
 *   "05/10/2026" ─► paraData ─► "2026-10-05"  (datas sempre em ISO, hora local)
 */
(function (LC) {
  'use strict';

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const BRL_INTEIRO = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const BRL_CURTO = new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1,
  });
  const NUM = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
  const PCT = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
    'setembro', 'outubro', 'novembro', 'dezembro'];
  const DIAS_SEMANA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

  const p2 = (n) => String(n).padStart(2, '0');
  const arred = (v) => Math.round((Number(v) || 0) * 100) / 100;

  const fmt = {
    moeda: (v) => BRL.format(arred(v) || 0),
    moedaInteira: (v) => BRL_INTEIRO.format(Math.round(v) || 0),
    // Eixos e rótulos curtos: "R$ 850", "R$ 2,5 mil", "R$ 1,2 mi".
    moedaCurta: (v) => (Math.abs(v) < 1000 ? BRL_INTEIRO.format(Math.round(v) || 0) : BRL_CURTO.format(v)),
    moedaSinal: (v) => (v > 0 ? '+' : '') + BRL.format(arred(v) || 0),
    numero: (v) => NUM.format(v || 0),
    pct: (v) => PCT.format(Number.isFinite(v) ? v : 0),
    data: (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''),
    dataCurta: (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : ''),
    mes: (chave) => `${MESES[+chave.slice(5, 7) - 1]}/${chave.slice(2, 4)}`,
    mesLongo: (chave) => `${MESES_LONGOS[+chave.slice(5, 7) - 1]} de ${chave.slice(0, 4)}`,
    diaSemana: (i) => DIAS_SEMANA[i],
  };

  const data = {
    iso: (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
    hoje: () => data.iso(new Date()),
    // Meio-dia evita pular de dia em mudança de horário de verão.
    objeto: (iso) => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), 12),
    mes: (iso) => iso.slice(0, 7),
    somaMeses(chave, n) {
      const t = +chave.slice(0, 4) * 12 + (+chave.slice(5, 7) - 1) + n;
      return `${Math.floor(t / 12)}-${p2((t % 12) + 1)}`;
    },
    somaDias(iso, n) {
      const d = data.objeto(iso);
      d.setDate(d.getDate() + n);
      return data.iso(d);
    },
    diasNoMes: (ano, mes) => new Date(ano, mes, 0).getDate(),
    inicioDoMes: (chave) => `${chave}-01`,
    fimDoMes: (chave) => `${chave}-${p2(data.diasNoMes(+chave.slice(0, 4), +chave.slice(5, 7)))}`,
    // Dia do mês limitado ao tamanho do mês (dia 31 em fevereiro vira 28/29).
    noMes: (chave, dia) => `${chave}-${p2(Math.min(dia, data.diasNoMes(+chave.slice(0, 4), +chave.slice(5, 7))))}`,
    diaSemana: (iso) => (data.objeto(iso).getDay() + 6) % 7, // segunda = 0
    inicioSemana: (iso) => data.somaDias(iso, -data.diaSemana(iso)),
    diferencaDias: (a, b) => Math.round((data.objeto(b) - data.objeto(a)) / 86400000),
    meses(deChave, ateChave) {
      const lista = [];
      for (let m = deChave; m <= ateChave && lista.length < 1200; m = data.somaMeses(m, 1)) lista.push(m);
      return lista;
    },
    valida(iso) {
      if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
      const d = data.objeto(iso);
      return data.iso(d) === iso;
    },
  };

  // Número digitado em pt-BR ou vindo de extrato: "1.234,56", "-R$ 50", "(50,00)", "123,45 D".
  function paraNumero(entrada) {
    if (typeof entrada === 'number') return Number.isFinite(entrada) ? entrada : NaN;
    if (entrada == null || typeof entrada === 'boolean') return NaN;
    let s = String(entrada).replace(/[\s ]+/g, ' ').trim();
    if (!s) return NaN;
    let negativo = false;
    if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1).trim(); }
    if (/\d\s*D$/i.test(s)) { negativo = !negativo; s = s.replace(/\s*D$/i, ''); }
    else if (/\d\s*C$/i.test(s)) s = s.replace(/\s*C$/i, '');
    s = s.replace(/R\$|\s/gi, '');
    if (s.startsWith('-')) { negativo = !negativo; s = s.slice(1); }
    else if (s.endsWith('-')) { negativo = !negativo; s = s.slice(0, -1); }
    else if (s.startsWith('+')) s = s.slice(1);
    s = s.replace(/^R\$/i, '');
    const virgula = s.includes(','), ponto = s.includes('.');
    if (virgula && ponto) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (virgula) {
      s = /^\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (ponto && /^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
    }
    if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    const n = parseFloat(s);
    return negativo ? -n : n;
  }

  // Data de planilha, extrato ou digitada. Devolve "AAAA-MM-DD" ou null.
  function paraData(entrada, anoPadrao) {
    if (entrada == null || entrada === '') return null;
    if (entrada instanceof Date) return Number.isNaN(+entrada) ? null : data.iso(entrada);
    if (typeof entrada === 'number') return serialParaISO(entrada);
    const s = String(entrada).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return montar(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\d{6})?(?:\.\d+)?(?:\[.*\])?$/);
    if (m) return montar(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (m) {
      let ano = +m[3];
      if (m[3].length === 2) ano += ano < 70 ? 2000 : 1900;
      return montar(ano, +m[2], +m[1]);
    }
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})$/);
    if (m) return montar(anoPadrao || new Date().getFullYear(), +m[2], +m[1]);
    if (/^\d+(\.\d+)?$/.test(s)) return serialParaISO(+s);
    return null;
  }

  function montar(ano, mes, dia) {
    const iso = `${ano}-${p2(mes)}-${p2(dia)}`;
    return data.valida(iso) ? iso : null;
  }

  // Número de série do Excel (dias desde 30/12/1899) → ISO.
  function serialParaISO(n) {
    if (!(n > 0 && n < 2958466)) return null;
    const d = new Date(Math.round((n - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  }

  function isoParaSerial(iso) {
    return Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000) + 25569;
  }

  // Comparação de nomes sem acento, caixa ou espaços extras.
  function dobrar(texto) {
    return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  let contadorId = 0;
  function novoId(prefixo = '') {
    contadorId = (contadorId + 1) % 1296;
    return prefixo + Date.now().toString(36) + contadorId.toString(36).padStart(2, '0')
      + Math.random().toString(36).slice(2, 6);
  }

  // JSON com chaves ordenadas: comparar estados sem depender da ordem dos campos.
  function jsonEstavel(v) {
    if (Array.isArray(v)) return '[' + v.map(jsonEstavel).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
        .map((k) => JSON.stringify(k) + ':' + jsonEstavel(v[k])).join(',') + '}';
    }
    return JSON.stringify(v === undefined ? null : v);
  }

  function prng(semente) { // mulberry32: dados de exemplo iguais em toda abertura
    let a = semente >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── Cores ────────────────────────────────────────────────────────────────
  // Paleta categórica validada (ordem fixa; nunca gerar uma 9ª cor). "p1".."p8" seguem o tema.
  const PALETA = {
    claro: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
    escuro: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  };
  const NOMES_CORES = ['Azul', 'Laranja', 'Água', 'Amarelo', 'Magenta', 'Verde', 'Violeta', 'Vermelho'];

  function temaEscuro() {
    if (typeof document === 'undefined') return false;
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function token(nome) {
    return getComputedStyle(document.documentElement).getPropertyValue('--' + nome).trim();
  }

  function cor(ref) {
    if (typeof ref === 'string' && /^p[1-8]$/.test(ref)) return PALETA[temaEscuro() ? 'escuro' : 'claro'][+ref[1] - 1];
    if (typeof ref === 'string' && /^#[0-9a-f]{6}$/i.test(ref)) return ref;
    return token('serie-neutra') || '#9a9d97';
  }

  function comAlfa(hex, alfa) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alfa})`;
  }

  // ── DOM ──────────────────────────────────────────────────────────────────
  // Textos vindos dos dados entram sempre como textContent (nunca innerHTML).
  function el(tag, props, ...filhos) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
        else if (k === 'dataset') Object.assign(n.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (k === 'value') n.value = v;
        else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden') n[k] = !!v;
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const f of filhos.flat(Infinity)) {
      if (f == null || f === false) continue;
      n.append(f instanceof Node ? f : String(f));
    }
    return n;
  }

  function icone(nome, classe = 'ico') {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', classe);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#i-' + nome);
    svg.append(use);
    return svg;
  }

  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

  function esvaziar(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }

  function adiar(fn, ms) {
    let t = null;
    const f = (...args) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
    f.agora = (...args) => { clearTimeout(t); t = null; fn(...args); };
    f.pendente = () => t !== null;
    return f;
  }

  function letraColuna(i) { // 0 → A, 25 → Z, 26 → AA
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }

  Object.assign(LC, {
    fmt, data, arred, paraNumero, paraData, serialParaISO, isoParaSerial, dobrar, novoId, jsonEstavel, prng,
    PALETA, NOMES_CORES, temaEscuro, token, cor, comAlfa, el, icone, $, $$, esvaziar, adiar, letraColuna,
  });
})(globalThis.LC = globalThis.LC || {});
