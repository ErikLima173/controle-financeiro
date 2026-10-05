/*
 * arquivos.js — Entrada e saída de planilhas sem bibliotecas externas.
 *
 *   .xlsx ─► ZIP (DecompressionStream) ─► XML das abas ─► linhas
 *   .csv  ─► detecta ; , ou tab e a codificação (UTF-8 ou Windows-1252) ─► linhas
 *   .ofx  ─► extrato bancário ─► linhas [data, descrição, valor]
 *   estado ─► .xlsx no formato da planilha Gastos, com fórmulas e gráficos nativos editáveis no Excel
 */
(function (LC) {
  'use strict';

  // ── Texto, CSV e OFX ─────────────────────────────────────────────────────

  function decodificarTexto(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
    } catch (_) {
      return new TextDecoder('windows-1252').decode(bytes); // extratos de banco antigos
    }
  }

  function contarFora(linha, sep) {
    let n = 0, aspas = false;
    for (const c of linha) {
      if (c === '"') aspas = !aspas;
      else if (c === sep && !aspas) n++;
    }
    return n;
  }

  function lerCSV(texto) {
    texto = texto.replace(/^﻿/, '');
    const amostra = texto.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
    let sep = ';', melhor = -1;
    for (const s of [';', ',', '\t', '|']) {
      const contagens = amostra.map((l) => contarFora(l, s));
      const consistentes = contagens.filter((c) => c > 0 && c === contagens[0]).length;
      if (contagens[0] > 0 && consistentes > melhor) { melhor = consistentes; sep = s; }
    }
    const linhas = []; let linha = []; let campo = ''; let aspas = false;
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (aspas) {
        if (c === '"') {
          if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
        } else campo += c;
      } else if (c === '"' && campo.trim() === '') { aspas = true; campo = ''; }
      else if (c === sep) { linha.push(campo); campo = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && texto[i + 1] === '\n') i++;
        linha.push(campo); linhas.push(linha); linha = []; campo = '';
      } else campo += c;
    }
    if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
    return linhas.map((l) => l.map((s) => s.trim())).filter((l) => l.some((s) => s !== ''));
  }

  // OFX (padrão dos extratos dos bancos brasileiros): SGML com tags sem fechamento.
  function lerOFX(texto) {
    const campo = (bloco, tag) => {
      const m = bloco.match(new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i'));
      return m ? m[1].trim() : '';
    };
    const linhas = [];
    for (const parte of texto.split(/<STMTTRN>/i).slice(1)) {
      const bloco = parte.split(/<\/STMTTRN>/i)[0];
      const memo = campo(bloco, 'MEMO'), nome = campo(bloco, 'NAME');
      linhas.push([
        LC.paraData(campo(bloco, 'DTPOSTED').slice(0, 8)) || '',
        decodificarEntidades(memo || nome || campo(bloco, 'TRNTYPE')),
        campo(bloco, 'TRNAMT'),
      ]);
    }
    const banco = campo(texto, 'ORG'), contaId = campo(texto, 'ACCTID');
    const conta = banco ? banco : contaId ? 'Conta ' + contaId : '';
    return { conta, linhas };
  }

  // ── ZIP ──────────────────────────────────────────────────────────────────

  let tabelaCRC = null;
  function crc32(bytes) {
    if (!tabelaCRC) {
      tabelaCRC = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        tabelaCRC[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = tabelaCRC[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  async function lerZip(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let fim = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; }
    }
    if (fim < 0) throw new Error('O arquivo não é uma planilha .xlsx válida.');
    const total = dv.getUint16(fim + 10, true);
    let p = dv.getUint32(fim + 16, true);
    const entradas = new Map();
    for (let k = 0; k < total && p + 46 <= u8.length; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const nLen = dv.getUint16(p + 28, true), xLen = dv.getUint16(p + 30, true), cLen = dv.getUint16(p + 32, true);
      const nome = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nLen)).replace(/\\/g, '/');
      entradas.set(nome.toLowerCase(), {
        metodo: dv.getUint16(p + 10, true), tamanho: dv.getUint32(p + 20, true), local: dv.getUint32(p + 42, true),
      });
      p += 46 + nLen + xLen + cLen;
    }
    return {
      async texto(nome) {
        const e = entradas.get(nome.toLowerCase());
        if (!e) return null;
        const ini = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
        const dados = u8.subarray(ini, ini + e.tamanho);
        let bytes;
        if (e.metodo === 0) bytes = dados;
        else if (e.metodo === 8) {
          if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não abre .xlsx. Salve a planilha como .csv e importe de novo.');
          const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          bytes = new Uint8Array(await new Response(fluxo).arrayBuffer());
        } else throw new Error('Compressão do .xlsx não suportada. Salve como .csv e importe de novo.');
        return new TextDecoder('utf-8').decode(bytes);
      },
    };
  }

  function criarZip(arquivos) {
    const enc = new TextEncoder();
    const agora = new Date();
    const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
    const dia = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
    const partes = [], central = [];
    let offset = 0;
    for (const { nome, dados } of arquivos) {
      const nomeB = enc.encode(nome);
      const conteudo = typeof dados === 'string' ? enc.encode(dados) : dados;
      const crc = crc32(conteudo);
      const local = new Uint8Array(30 + nomeB.length);
      const dl = new DataView(local.buffer);
      dl.setUint32(0, 0x04034b50, true); dl.setUint16(4, 20, true); dl.setUint16(6, 0x0800, true);
      dl.setUint16(10, hora, true); dl.setUint16(12, dia, true); dl.setUint32(14, crc, true);
      dl.setUint32(18, conteudo.length, true); dl.setUint32(22, conteudo.length, true);
      dl.setUint16(26, nomeB.length, true); local.set(nomeB, 30);
      const cen = new Uint8Array(46 + nomeB.length);
      const dc = new DataView(cen.buffer);
      dc.setUint32(0, 0x02014b50, true); dc.setUint16(4, 20, true); dc.setUint16(6, 20, true); dc.setUint16(8, 0x0800, true);
      dc.setUint16(12, hora, true); dc.setUint16(14, dia, true); dc.setUint32(16, crc, true);
      dc.setUint32(20, conteudo.length, true); dc.setUint32(24, conteudo.length, true);
      dc.setUint16(28, nomeB.length, true); dc.setUint32(42, offset, true); cen.set(nomeB, 46);
      partes.push(local, conteudo); central.push(cen);
      offset += local.length + conteudo.length;
    }
    const tamCentral = central.reduce((s, c) => s + c.length, 0);
    const fim = new Uint8Array(22);
    const df = new DataView(fim.buffer);
    df.setUint32(0, 0x06054b50, true); df.setUint16(8, arquivos.length, true); df.setUint16(10, arquivos.length, true);
    df.setUint32(12, tamCentral, true); df.setUint32(16, offset, true);
    const saida = new Uint8Array(offset + tamCentral + 22);
    let pos = 0;
    for (const parte of [...partes, ...central, fim]) { saida.set(parte, pos); pos += parte.length; }
    return saida;
  }

  // ── XLSX: leitura ────────────────────────────────────────────────────────

  function decodificarEntidades(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
      const k = e.toLowerCase();
      if (k === 'amp') return '&';
      if (k === 'lt') return '<';
      if (k === 'gt') return '>';
      if (k === 'quot') return '"';
      if (k === 'apos') return "'";
      return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    });
  }

  function atributos(s) {
    const o = {};
    for (const m of String(s).matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) o[m[1]] = decodificarEntidades(m[2] ?? m[3]);
    return o;
  }

  // Texto de <si> ou <is>: junta os trechos <t> (texto rico), ignora a fonética <rPh>.
  function textoRico(xml) {
    const limpo = String(xml || '').replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
    let s = '';
    for (const m of limpo.matchAll(/<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g)) s += decodificarEntidades(m[1] || '');
    return s;
  }

  function colunaDaRef(ref) {
    const letras = String(ref).match(/^[A-Z]+/i);
    if (!letras) return -1;
    let n = 0;
    for (const ch of letras[0].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function formatoEhData(id, codigo) {
    if ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)) return true;
    if (!codigo) return false;
    const limpo = codigo.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');
    return /[dy]/i.test(limpo);
  }

  function estilosDeData(xml) {
    const datas = new Set();
    if (!xml) return datas;
    const custom = {};
    const blocoFmt = (xml.match(/<(?:\w+:)?numFmts\b[\s\S]*?<\/(?:\w+:)?numFmts>/) || [''])[0];
    for (const m of blocoFmt.matchAll(/<(?:\w+:)?numFmt\b([^>]*?)\/?>/g)) {
      const a = atributos(m[1]);
      custom[a.numFmtId] = a.formatCode;
    }
    const xfs = (xml.match(/<(?:\w+:)?cellXfs\b[\s\S]*?<\/(?:\w+:)?cellXfs>/) || [''])[0];
    let i = 0;
    for (const m of xfs.matchAll(/<(?:\w+:)?xf\b([^>]*?)(?:\/>|>)/g)) {
      const id = +(atributos(m[1]).numFmtId || 0);
      if (formatoEhData(id, custom[id])) datas.add(i);
      i++;
    }
    return datas;
  }

  function lerFolha(xml, textos, datas) {
    const linhas = [];
    for (const r of String(xml || '').matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
      if (!r[2]) continue;
      const ra = atributos(r[1]);
      const idx = ra.r ? +ra.r - 1 : linhas.length;
      const celulas = [];
      let col = 0;
      for (const c of r[2].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const a = atributos(c[1]);
        if (a.r) col = colunaDaRef(a.r);
        const corpo = c[2] || '';
        const v = (corpo.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/) || [])[1];
        let valor = '';
        if (a.t === 's') valor = textos[+v] ?? '';
        else if (a.t === 'inlineStr') valor = textoRico((corpo.match(/<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/) || [])[1]);
        else if (a.t === 'str') valor = decodificarEntidades(v ?? '');
        else if (a.t === 'b') valor = v === '1';
        else if (a.t === 'd') valor = v ? String(v).slice(0, 10) : '';
        else if (a.t !== 'e' && v != null && v !== '') {
          const n = +v;
          valor = datas.has(+(a.s || 0)) ? LC.serialParaISO(n) || n : n;
        }
        celulas[col] = valor;
        col++;
      }
      linhas[idx] = celulas;
    }
    return Array.from(linhas, (l) => (l ? Array.from(l, (x) => (x == null ? '' : x)) : []));
  }

  async function lerXLSX(buf) {
    const zip = await lerZip(buf);
    const livro = await zip.texto('xl/workbook.xml');
    if (!livro) throw new Error('O arquivo não parece uma planilha do Excel (.xlsx).');
    const rels = (await zip.texto('xl/_rels/workbook.xml.rels')) || '';
    const alvos = {};
    for (const m of rels.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
      const a = atributos(m[1]);
      alvos[a.Id] = a.Target;
    }
    const sst = await zip.texto('xl/sharedStrings.xml');
    const textos = sst ? [...sst.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => textoRico(m[1])) : [];
    const datas = estilosDeData(await zip.texto('xl/styles.xml'));
    const abas = [];
    for (const m of livro.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?>/g)) {
      const a = atributos(m[1]);
      const rid = a['r:id'] || Object.entries(a).find(([k]) => /:id$/i.test(k))?.[1];
      let alvo = alvos[rid];
      if (!alvo) continue;
      alvo = alvo.startsWith('/') ? alvo.slice(1) : 'xl/' + alvo.replace(/^\.\//, '');
      const xml = await zip.texto(alvo);
      if (xml) abas.push({ nome: a.name || 'Planilha', linhas: lerFolha(xml, textos, datas) });
    }
    if (!abas.length) throw new Error('Nenhuma aba com dados foi encontrada na planilha.');
    return abas;
  }

  // Arquivo escolhido pelo usuário ─► { tipo: 'tabela' | 'backup', ... }
  async function lerArquivo(arquivo) {
    const nome = arquivo.name || '';
    const ext = (nome.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
    const buf = await arquivo.arrayBuffer();
    if (ext === 'xls' || ext === 'ods' || ext === 'numbers') {
      throw new Error(`Arquivos .${ext} não são lidos aqui. Abra no Excel (ou LibreOffice) e salve como .xlsx ou .csv.`);
    }
    const u8 = new Uint8Array(buf);
    if (ext === 'xlsx' || ext === 'xlsm' || (u8[0] === 0x50 && u8[1] === 0x4b)) {
      return { tipo: 'tabela', nome, abas: await lerXLSX(buf) };
    }
    const texto = decodificarTexto(buf);
    if (ext === 'json' || /^\s*\{/.test(texto)) {
      let dados;
      try { dados = JSON.parse(texto); } catch (_) { throw new Error('O arquivo .json está corrompido ou não é um backup do Livro-Caixa.'); }
      return { tipo: 'backup', nome, estado: dados && dados.dados ? dados.dados : dados };
    }
    if (ext === 'ofx' || ext === 'qfx' || /<OFX>/i.test(texto.slice(0, 2000))) {
      const ofx = lerOFX(texto);
      if (!ofx.linhas.length) throw new Error('Nenhuma transação encontrada no extrato .ofx.');
      return { tipo: 'tabela', nome, ofx: true, contaSugerida: ofx.conta, abas: [{ nome: 'Extrato', linhas: [['Data', 'Descrição', 'Valor'], ...ofx.linhas] }] };
    }
    const linhas = lerCSV(texto);
    if (!linhas.length) throw new Error('O arquivo está vazio.');
    return { tipo: 'tabela', nome, abas: [{ nome: nome.replace(/\.[^.]+$/, '') || 'CSV', linhas }] };
  }

  // ── XLSX: escrita ────────────────────────────────────────────────────────

  const esc = (s) => String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const CAB = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const VERDE = '1F5C4A';

  const ESTILOS = {
    padrao: 0, cabecalho: 1, moeda: 2, data: 3, mes: 4, pct: 5, totalTexto: 6, totalMoeda: 7, titulo: 8, nota: 9, totalPct: 10, inteiro: 11,
  };

  const XML_ESTILOS = CAB + `<styleSheet xmlns="${NS_MAIN}">`
    + '<numFmts count="4">'
    + '<numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00;[Red]\\-&quot;R$&quot;\\ #,##0.00"/>'
    + '<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>'
    + '<numFmt numFmtId="166" formatCode="mmm/yy"/>'
    + '<numFmt numFmtId="167" formatCode="0.0%"/>'
    + '</numFmts>'
    + '<fonts count="5">'
    + '<font><sz val="11"/><color rgb="FF1E2421"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FF1E2421"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>'
    + `<font><b/><sz val="14"/><color rgb="FF${VERDE}"/><name val="Calibri"/><family val="2"/></font>`
    + '<font><i/><sz val="9"/><color rgb="FF6B726E"/><name val="Calibri"/><family val="2"/></font>'
    + '</fonts>'
    + '<fills count="4">'
    + '<fill><patternFill patternType="none"/></fill>'
    + '<fill><patternFill patternType="gray125"/></fill>'
    + `<fill><patternFill patternType="solid"><fgColor rgb="FF${VERDE}"/><bgColor indexed="64"/></patternFill></fill>`
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFE8F0EC"/><bgColor indexed="64"/></patternFill></fill>'
    + '</fills>'
    + '<borders count="2">'
    + '<border><left/><right/><top/><bottom/><diagonal/></border>'
    + `<border><left/><right/><top style="thin"><color rgb="FF${VERDE}"/></top><bottom/><diagonal/></border>`
    + '</borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="12">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>'
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>'
    + '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>'
    + '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'
    + '<xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>'
    + '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '<xf numFmtId="167" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>'
    + '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + '</cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>'
    + '</styleSheet>';

  const ref = (col, linha) => LC.letraColuna(col) + (linha + 1);
  const nomeAba = (nome) => `'${String(nome).replace(/'/g, "''")}'`;

  function xmlCelula(c, col, linha, estiloColuna) {
    if (c == null || c === '') return '';
    const r = ref(col, linha);
    const obj = typeof c === 'object' && !(c instanceof Date) ? c : { v: c };
    const s = ESTILOS[obj.s ?? estiloColuna] || 0;
    const sAttr = s ? ` s="${s}"` : '';
    if (obj.f) {
      const v = Number.isFinite(obj.v) ? `<v>${obj.v}</v>` : '';
      return `<c r="${r}"${sAttr}><f>${esc(obj.f)}</f>${v}</c>`;
    }
    const v = obj.v;
    if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${r}"${sAttr}><v>${v}</v></c>` : '';
    if (typeof v === 'boolean') return `<c r="${r}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`;
    const texto = String(v);
    const preserva = /^\s|\s$|\n/.test(texto) ? ' xml:space="preserve"' : '';
    return `<c r="${r}"${sAttr} t="inlineStr"><is><t${preserva}>${esc(texto)}</t></is></c>`;
  }

  function xmlAba(aba, indice, ativa, temDesenho) {
    const nLinhas = Math.max(1, aba.linhas.length);
    const nCols = Math.max(1, aba.colunas.length, ...aba.linhas.map((l) => l.length));
    const cr = aba.congelar || 0, cc = aba.congelarColunas || 0;
    const selecionada = ativa ? ' tabSelected="1"' : '';
    const canto = ref(cc, cr);
    const painel = cr && cc ? 'bottomRight' : cr ? 'bottomLeft' : 'topRight';
    const vista = cr || cc
      ? `<sheetView workbookViewId="0"${selecionada}><pane${cc ? ` xSplit="${cc}"` : ''}${cr ? ` ySplit="${cr}"` : ''} topLeftCell="${canto}" activePane="${painel}" state="frozen"/><selection pane="${painel}" activeCell="${canto}" sqref="${canto}"/></sheetView>`
      : `<sheetView workbookViewId="0"${selecionada}/>`;
    const cols = aba.colunas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura || 12}" customWidth="1"/>`).join('');
    const linhas = aba.linhas.map((l, i) => {
      const cabecalho = aba.cabecalhos && aba.cabecalhos.includes(i);
      const altura = cabecalho ? ' ht="20" customHeight="1"' : '';
      const cels = l.map((c, j) => xmlCelula(cabecalho && (typeof c !== 'object' || c === null) ? { v: c, s: 'cabecalho' } : c, j, i,
        cabecalho ? 'cabecalho' : aba.colunas[j]?.estilo)).join('');
      return `<row r="${i + 1}"${altura}>${cels}</row>`;
    }).join('');
    return CAB + `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}">`
      + `<sheetPr>${aba.corAba ? `<tabColor rgb="FF${aba.corAba}"/>` : ''}<pageSetUpPr fitToPage="1"/></sheetPr>`
      + `<dimension ref="A1:${ref(nCols - 1, nLinhas - 1)}"/>`
      + `<sheetViews>${vista}</sheetViews><sheetFormatPr defaultRowHeight="15"/>`
      + (cols ? `<cols>${cols}</cols>` : '')
      + `<sheetData>${linhas}</sheetData>`
      + (aba.filtro ? `<autoFilter ref="${aba.filtro}"/>` : '')
      + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
      + '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
      + (temDesenho ? '<drawing r:id="rId1"/>' : '')
      + '</worksheet>';
  }

  // ── Gráficos nativos (DrawingML) ─────────────────────────────────────────

  const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
  const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const preenchimento = (cor) => `<a:solidFill><a:srgbClr val="${cor}"/></a:solidFill>`;

  function cacheTexto(valores) {
    return `<c:strCache><c:ptCount val="${valores.length}"/>${valores.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
  }
  function cacheNumero(valores, formato = 'General') {
    const pts = valores.map((v, i) => (Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : '')).join('');
    return `<c:numCache><c:formatCode>${esc(formato)}</c:formatCode><c:ptCount val="${valores.length}"/>${pts}</c:numCache>`;
  }

  function xmlSerie(s, i, cat, tipo) {
    const tx = `<c:tx><c:strRef><c:f>${esc(s.refNome)}</c:f>${cacheTexto([s.nome])}</c:strRef></c:tx>`;
    const catXml = cat.numerico
      ? `<c:cat><c:numRef><c:f>${esc(cat.ref)}</c:f>${cacheNumero(cat.valores, cat.formato)}</c:numRef></c:cat>`
      : `<c:cat><c:strRef><c:f>${esc(cat.ref)}</c:f>${cacheTexto(cat.valores)}</c:strRef></c:cat>`;
    const val = `<c:val><c:numRef><c:f>${esc(s.ref)}</c:f>${cacheNumero(s.valores)}</c:numRef></c:val>`;
    const base = `<c:idx val="${i}"/><c:order val="${i}"/>${tx}`;
    if (tipo === 'linha') {
      return `<c:ser>${base}<c:spPr><a:ln w="28575" cap="rnd">${preenchimento(s.cor)}<a:round/></a:ln></c:spPr>`
        + `<c:marker><c:symbol val="none"/></c:marker>${catXml}${val}<c:smooth val="0"/></c:ser>`;
    }
    if (tipo === 'rosca') {
      const pontos = (s.coresPontos || []).map((cor, k) => `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/>`
        + `<c:spPr>${preenchimento(cor)}<a:ln w="19050">${preenchimento('FFFFFF')}</a:ln></c:spPr></c:dPt>`).join('');
      return `<c:ser>${base}${pontos}${catXml}${val}</c:ser>`;
    }
    return `<c:ser>${base}<c:spPr>${preenchimento(s.cor)}</c:spPr><c:invertIfNegative val="0"/>${catXml}${val}</c:ser>`;
  }

  function xmlEixos(g) {
    const fmtCat = g.categorias.numerico ? `<c:numFmt formatCode="${esc(g.categorias.formato || 'General')}" sourceLinked="1"/>` : '';
    return '<c:catAx><c:axId val="500"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>'
      + `${fmtCat}<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>`
      + `<c:spPr><a:ln w="9525">${preenchimento('C7CCC6')}</a:ln></c:spPr>`
      + '<c:crossAx val="501"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>'
      + '<c:valAx><c:axId val="501"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>'
      + `<c:majorGridlines><c:spPr><a:ln w="6350">${preenchimento('E1E4DF')}</a:ln></c:spPr></c:majorGridlines>`
      + `<c:numFmt formatCode="${esc(g.formatoValor || 'General')}" sourceLinked="0"/>`
      + '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>'
      + '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>'
      + '<c:crossAx val="500"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>';
  }

  function xmlGrafico(g) {
    const titulo = '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr>'
      + `<a:r><a:rPr lang="pt-BR" sz="1200" b="1"/><a:t>${esc(g.titulo)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
    let corpo;
    if (g.tipo === 'rosca') {
      corpo = `<c:doughnutChart><c:varyColors val="1"/>${xmlSerie(g.series[0], 0, g.categorias, 'rosca')}`
        + '<c:firstSliceAng val="0"/><c:holeSize val="58"/></c:doughnutChart>';
    } else {
      const barras = g.series.filter((s) => (s.marca || (g.tipo === 'linha' ? 'linha' : 'barra')) === 'barra');
      const linhas = g.series.filter((s) => (s.marca || (g.tipo === 'linha' ? 'linha' : 'barra')) === 'linha');
      corpo = '';
      if (barras.length) {
        corpo += '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>'
          + barras.map((s) => xmlSerie(s, g.series.indexOf(s), g.categorias, 'barra')).join('')
          + '<c:gapWidth val="70"/><c:axId val="500"/><c:axId val="501"/></c:barChart>';
      }
      if (linhas.length) {
        corpo += '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>'
          + linhas.map((s) => xmlSerie(s, g.series.indexOf(s), g.categorias, 'linha')).join('')
          + '<c:marker val="1"/><c:axId val="500"/><c:axId val="501"/></c:lineChart>';
      }
      corpo += xmlEixos(g);
    }
    return CAB + `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}">`
      + '<c:lang val="pt-BR"/><c:roundedCorners val="0"/>'
      + `<c:chart>${titulo}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${corpo}</c:plotArea>`
      + `<c:legend><c:legendPos val="${g.tipo === 'rosca' ? 'r' : 'b'}"/><c:overlay val="0"/></c:legend>`
      + '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>'
      + `<c:spPr>${preenchimento('FFFFFF')}<a:ln w="9525">${preenchimento('E1E4DF')}</a:ln></c:spPr>`
      + `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900">${preenchimento('4D5550')}</a:defRPr></a:pPr><a:endParaRPr lang="pt-BR"/></a:p></c:txPr>`
      + '</c:chartSpace>';
  }

  function xmlDesenho(graficos, primeiroId) {
    const ancoras = graficos.map((g, i) => {
      const p = g.posicao;
      return `<xdr:oneCellAnchor><xdr:from><xdr:col>${p.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${p.linha}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
        + `<xdr:ext cx="${Math.round(p.largura * 360000)}" cy="${Math.round(p.altura * 360000)}"/>`
        + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${primeiroId + i}" name="${esc(g.titulo)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>`
        + '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>'
        + `<a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" r:id="rId${i + 1}"/></a:graphicData></a:graphic>`
        + '</xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>';
    }).join('');
    return CAB + `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS_A}" xmlns:r="${NS_R}">${ancoras}</xdr:wsDr>`;
  }

  const relacao = (id, tipo, alvo) => `<Relationship Id="${id}" Type="${NS_R}/${tipo}" Target="${alvo}"/>`;

  // abas: [{ nome, colunas: [{largura, estilo}], linhas, cabecalhos: [índices], congelar, filtro, graficos }]
  function escreverXLSX(abas, { ativa = 0 } = {}) {
    const arquivos = [];
    const tipos = [
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    ];
    let nGrafico = 0, nDesenho = 0, idForma = 2;
    const nomes = [];
    abas.forEach((aba, i) => {
      const graficos = aba.graficos || [];
      const temDesenho = graficos.length > 0;
      arquivos.push({ nome: `xl/worksheets/sheet${i + 1}.xml`, dados: xmlAba(aba, i, i === ativa, temDesenho) });
      tipos.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
      if (temDesenho) {
        nDesenho++;
        arquivos.push({ nome: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, dados: CAB + `<Relationships xmlns="${NS_PKG}">${relacao('rId1', 'drawing', `../drawings/drawing${nDesenho}.xml`)}</Relationships>` });
        arquivos.push({ nome: `xl/drawings/drawing${nDesenho}.xml`, dados: xmlDesenho(graficos, idForma) });
        idForma += graficos.length;
        tipos.push(`<Override PartName="/xl/drawings/drawing${nDesenho}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
        const rels = graficos.map((g) => {
          nGrafico++;
          arquivos.push({ nome: `xl/charts/chart${nGrafico}.xml`, dados: xmlGrafico(g) });
          tipos.push(`<Override PartName="/xl/charts/chart${nGrafico}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
          return nGrafico;
        });
        arquivos.push({ nome: `xl/drawings/_rels/drawing${nDesenho}.xml.rels`, dados: CAB + `<Relationships xmlns="${NS_PKG}">${rels.map((n, k) => relacao(`rId${k + 1}`, 'chart', `../charts/chart${n}.xml`)).join('')}</Relationships>` });
      }
      nomes.push(aba.nome);
    });
    const definidos = abas.map((aba, i) => (aba.filtro
      ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(nomeAba(aba.nome))}!${aba.filtro.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>`
      : '')).join('');
    arquivos.push({
      nome: 'xl/workbook.xml',
      dados: CAB + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><workbookPr/><bookViews><workbookView activeTab="${ativa}"/></bookViews>`
        + `<sheets>${nomes.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
        + (definidos ? `<definedNames>${definidos}</definedNames>` : '')
        + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>',
    });
    arquivos.push({
      nome: 'xl/_rels/workbook.xml.rels',
      dados: CAB + `<Relationships xmlns="${NS_PKG}">${nomes.map((_, i) => relacao(`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`)).join('')}`
        + relacao(`rId${nomes.length + 1}`, 'styles', 'styles.xml') + '</Relationships>',
    });
    arquivos.push({ nome: 'xl/styles.xml', dados: XML_ESTILOS });
    const agora = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    arquivos.push({
      nome: 'docProps/core.xml',
      dados: CAB + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        + '<dc:title>Livro-Caixa</dc:title><dc:creator>Livro-Caixa</dc:creator>'
        + `<dcterms:created xsi:type="dcterms:W3CDTF">${agora}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${agora}</dcterms:modified></cp:coreProperties>`,
    });
    arquivos.push({
      nome: 'docProps/app.xml',
      dados: CAB + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Livro-Caixa</Application></Properties>',
    });
    arquivos.push({
      nome: '_rels/.rels',
      dados: CAB + `<Relationships xmlns="${NS_PKG}">${relacao('rId1', 'officeDocument', 'xl/workbook.xml')}`
        + `<Relationship Id="rId2" Type="${NS_PKG}/metadata/core-properties" Target="docProps/core.xml"/>`
        + relacao('rId3', 'extended-properties', 'docProps/app.xml') + '</Relationships>',
    });
    arquivos.unshift({ nome: '[Content_Types].xml', dados: CAB + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${tipos.join('')}</Types>` });
    return criarZip(arquivos);
  }

  // ── O livro-caixa no formato da planilha "Gastos" ───────────────────────

  const HEX_CLARO = LC.PALETA.claro.map((h) => h.slice(1).toUpperCase());
  const hexCor = (ref) => (/^p[1-8]$/.test(ref) ? HEX_CLARO[+ref[1] - 1] : /^#[0-9a-f]{6}$/i.test(ref) ? ref.slice(1).toUpperCase() : '9A9D97');

  function nomesDeAba() {
    const usados = new Set();
    return (base) => {
      const limpo = String(base).replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Planilha';
      let nome = limpo, k = 2;
      while (usados.has(nome.toLowerCase())) nome = `${limpo.slice(0, 27)} ${k++}`;
      usados.add(nome.toLowerCase());
      return nome;
    };
  }

  /*
   * Um ano em uma pasta do Excel, como a planilha "Gastos":
   *   "Gastos <pessoa>"  Mês × categorias | Total Gasto | Salário | Total restante (com fórmulas)
   *   "Total finanças"   Total Recebido / Total Gasto / Total Restante somando as abas das pessoas
   *   "Lançamentos"      a lista detalhada do ano
   * Mudar um valor no Excel atualiza os totais e os gráficos nativos.
   */
  function excelNoFormatoGastos(est, ano, hoje) {
    const Dd = LC.Dados;
    const L = (i) => LC.letraColuna(i);
    const cats = Dd.mapaPorId(est.categorias);
    const nomeAbaUnico = nomesDeAba();
    const abas = [];
    const refs = []; // por pessoa: onde ficam o gasto e o recebido de cada mês
    const totalCategoria = new Map(); // categoria → [refs da linha Total de cada aba]
    const valorCategoria = new Map();

    for (const p of est.pessoas) {
      const mz = Dd.matrizMensal(est, p.id, ano);
      const nome = nomeAbaUnico(`Gastos ${p.nome}`);
      const N = nomeAba(nome);
      const colunas = [{ titulo: 'Mês', largura: 12 }];
      for (const id of mz.despesas) colunas.push({ titulo: cats.get(id).nome, largura: Math.max(12, cats.get(id).nome.length + 4), estilo: 'moeda', cat: id });
      const iGasto = colunas.length;
      colunas.push({ titulo: 'Total Gasto', largura: 14, estilo: 'moeda' });
      const iRec0 = colunas.length;
      for (const id of mz.receitas) colunas.push({ titulo: cats.get(id).nome, largura: Math.max(13, cats.get(id).nome.length + 4), estilo: 'moeda', cat: id });
      let iRecebido = mz.receitas.length === 1 ? iRec0 : null;
      if (mz.receitas.length > 1) { iRecebido = colunas.length; colunas.push({ titulo: 'Total Recebido', largura: 15, estilo: 'moeda' }); }
      const iRestante = colunas.length;
      colunas.push({ titulo: 'Total restante', largura: 15, estilo: 'moeda' });

      const linhas = [colunas.map((c) => c.titulo)];
      mz.meses.forEach((m, k) => {
        const r = k + 2;
        const linha = [m.nome];
        for (const id of mz.despesas) linha.push(m.valor(id) || '');
        linha.push({ f: mz.despesas.length ? `SUM(B${r}:${L(iGasto - 1)}${r})` : '0', v: m.gasto });
        for (const id of mz.receitas) linha.push(m.valor(id) || '');
        if (mz.receitas.length > 1) linha.push({ f: `SUM(${L(iRec0)}${r}:${L(iRec0 + mz.receitas.length - 1)}${r})`, v: m.recebido });
        linha.push({ f: iRecebido != null ? `${L(iRecebido)}${r}-${L(iGasto)}${r}` : `-${L(iGasto)}${r}`, v: m.restante });
        linhas.push(linha);
      });
      const somaColuna = (j) => LC.arred(linhas.slice(1).reduce((s, l) => s + (typeof l[j] === 'number' ? l[j] : l[j] && Number.isFinite(l[j].v) ? l[j].v : 0), 0));
      linhas.push([{ v: 'Total', s: 'totalTexto' }, ...colunas.slice(1).map((_, k) => ({ f: `SUM(${L(k + 1)}2:${L(k + 1)}13)`, s: 'totalMoeda', v: somaColuna(k + 1) }))]);
      mz.despesas.forEach((id, k) => {
        if (!totalCategoria.has(id)) { totalCategoria.set(id, []); valorCategoria.set(id, 0); }
        totalCategoria.get(id).push(`${N}!$${L(k + 1)}$14`);
        valorCategoria.set(id, LC.arred(valorCategoria.get(id) + somaColuna(k + 1)));
      });

      const graficos = [];
      const catMeses = { ref: `${N}!$A$2:$A$13`, valores: Dd.MESES_NOMES };
      const serie = (i, nomeSerie, cor, marca) => ({
        nome: nomeSerie, refNome: `${N}!$${L(i)}$1`, ref: `${N}!$${L(i)}$2:$${L(i)}$13`,
        valores: mz.meses.map((m) => (i === iGasto ? m.gasto : i === iRestante ? m.restante : i === iRecebido ? m.recebido : 0)), cor, marca,
      });
      const seriesFluxo = [];
      if (iRecebido != null) seriesFluxo.push(serie(iRecebido, colunas[iRecebido].titulo, HEX_CLARO[0], 'barra'));
      seriesFluxo.push(serie(iGasto, 'Total Gasto', HEX_CLARO[1], 'barra'), serie(iRestante, 'Total restante', HEX_CLARO[2], 'linha'));
      graficos.push({ tipo: 'colunas', titulo: `${p.nome}: recebido x gasto (${ano})`, categorias: catMeses, formatoValor: '"R$" #,##0', series: seriesFluxo, posicao: { col: colunas.length + 1, linha: 1, largura: 17, altura: 8.5 } });
      if (mz.despesas.length) {
        graficos.push({
          tipo: 'rosca', titulo: `${p.nome}: gastos por categoria (${ano})`,
          categorias: { ref: `${N}!$B$1:$${L(iGasto - 1)}$1`, valores: mz.despesas.map((id) => cats.get(id).nome) },
          series: [{ nome: 'Total', refNome: `${N}!$A$14`, ref: `${N}!$B$14:$${L(iGasto - 1)}$14`, valores: mz.despesas.map((_, k) => somaColuna(k + 1)), coresPontos: mz.despesas.map((id) => hexCor(cats.get(id).cor)) }],
          posicao: { col: colunas.length + 1, linha: 19, largura: 13, altura: 8.5 },
        });
      }
      abas.push({ nome, colunas: colunas.map((c) => ({ largura: c.largura, estilo: c.estilo })), cabecalhos: [0], congelar: 1, congelarColunas: 1, linhas, graficos, corAba: hexCor(p.cor) });
      refs.push({ N, iGasto, iRecebido });
    }

    // Total finanças: as mesmas fórmulas da planilha original, para quantas pessoas houver
    const resumo = Dd.MESES_NOMES.map((_, k) => Dd.resumoMes(est, `${ano}-${String(k + 1).padStart(2, '0')}`));
    const soma = (partes) => (partes.length ? partes.join('+') : '0');
    const total = {
      nome: nomeAbaUnico('Total finanças'), corAba: '1F5C4A',
      colunas: [{ largura: 20 }, { largura: 17, estilo: 'moeda' }, { largura: 17, estilo: 'moeda' }, { largura: 17, estilo: 'moeda' }, { largura: 12, estilo: 'pct' }],
      cabecalhos: [0], congelar: 1,
      linhas: [['Mês', 'Total Recebido', 'Total Gasto', 'Total Restante', '% guardado']],
      graficos: [],
    };
    resumo.forEach((m, k) => {
      const r = k + 2;
      total.linhas.push([
        Dd.MESES_NOMES[k],
        { f: soma(refs.filter((x) => x.iRecebido != null).map((x) => `${x.N}!${L(x.iRecebido)}${r}`)), v: m.receitas },
        { f: soma(refs.map((x) => `${x.N}!${L(x.iGasto)}${r}`)), v: m.despesas },
        { f: `B${r}-C${r}`, v: m.restante },
        { f: `IF(B${r}=0,"",D${r}/B${r})`, v: m.receitas ? m.restante / m.receitas : undefined },
      ]);
    });
    const t = resumo.reduce((s, m) => ({ r: s.r + m.receitas, d: s.d + m.despesas }), { r: 0, d: 0 });
    total.linhas.push([{ v: 'Total', s: 'totalTexto' },
      { f: 'SUM(B2:B13)', s: 'totalMoeda', v: LC.arred(t.r) }, { f: 'SUM(C2:C13)', s: 'totalMoeda', v: LC.arred(t.d) },
      { f: 'SUM(D2:D13)', s: 'totalMoeda', v: LC.arred(t.r - t.d) }, { f: 'IF(B14=0,"",D14/B14)', s: 'totalPct', v: t.r ? (t.r - t.d) / t.r : undefined }]);
    // Gasto do ano por categoria, abaixo dos meses (alimenta a rosca)
    const ordemCats = [...totalCategoria.keys()].filter((id) => valorCategoria.get(id)).sort((a, b) => valorCategoria.get(b) - valorCategoria.get(a));
    total.linhas.push([]);
    const linhaCabCat = total.linhas.length; // índice 0-based da linha de títulos das categorias
    total.cabecalhos.push(linhaCabCat);
    total.linhas.push(['Categoria', `Gasto em ${ano}`]);
    for (const id of ordemCats) total.linhas.push([cats.get(id).nome, { f: totalCategoria.get(id).join('+'), v: valorCategoria.get(id), s: 'moeda' }]);
    total.linhas.push([]);
    total.linhas.push([{ v: `Gerado pelo Livro-Caixa em ${LC.fmt.data(hoje)}. Mude os valores nas abas das pessoas: totais e gráficos se atualizam.`, s: 'nota' }]);
    const T = nomeAba(total.nome);
    const catMeses = { ref: `${T}!$A$2:$A$13`, valores: Dd.MESES_NOMES };
    total.graficos.push({
      tipo: 'colunas', titulo: `Recebido x gasto (${ano})`, categorias: catMeses, formatoValor: '"R$" #,##0',
      series: [
        { nome: 'Total Recebido', refNome: `${T}!$B$1`, ref: `${T}!$B$2:$B$13`, valores: resumo.map((m) => m.receitas), cor: HEX_CLARO[0], marca: 'barra' },
        { nome: 'Total Gasto', refNome: `${T}!$C$1`, ref: `${T}!$C$2:$C$13`, valores: resumo.map((m) => m.despesas), cor: HEX_CLARO[1], marca: 'barra' },
        { nome: 'Total Restante', refNome: `${T}!$D$1`, ref: `${T}!$D$2:$D$13`, valores: resumo.map((m) => m.restante), cor: HEX_CLARO[2], marca: 'linha' },
      ],
      posicao: { col: 6, linha: 1, largura: 18, altura: 9 },
    });
    if (ordemCats.length) {
      const ini = linhaCabCat + 2, fim = linhaCabCat + 1 + ordemCats.length;
      total.graficos.push({
        tipo: 'rosca', titulo: `Gastos por categoria (${ano})`,
        categorias: { ref: `${T}!$A$${ini}:$A$${fim}`, valores: ordemCats.map((id) => cats.get(id).nome) },
        series: [{ nome: `Gasto em ${ano}`, refNome: `${T}!$B$${linhaCabCat + 1}`, ref: `${T}!$B$${ini}:$B$${fim}`, valores: ordemCats.map((id) => valorCategoria.get(id)), coresPontos: ordemCats.map((id) => hexCor(cats.get(id).cor)) }],
        posicao: { col: 6, linha: 20, largura: 14, altura: 9 },
      });
    }

    // Lançamentos do ano, um por linha
    const pessoas = Dd.mapaPorId(est.pessoas);
    const doAno = est.lancamentos.filter((x) => x.data.startsWith(ano + '-')).sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
    const lanc = {
      nome: nomeAbaUnico('Lançamentos'), cabecalhos: [0], congelar: 1,
      colunas: [{ largura: 12, estilo: 'data' }, { largura: 36 }, { largura: 18 }, { largura: 14 }, { largura: 14, estilo: 'moeda' },
        { largura: 14 }, { largura: 16 }, { largura: 11 }, { largura: 18 }, { largura: 30 }],
      linhas: [['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor', 'Pessoa', 'Para (transferência)', 'Situação', 'Origem', 'Observação']],
    };
    for (const x of doAno) {
      lanc.linhas.push([LC.isoParaSerial(x.data), x.descricao, x.tipo === 'transferencia' ? '' : cats.get(x.categoria)?.nome || '',
        Dd.ROTULO_TIPO[x.tipo], x.valor, pessoas.get(x.pessoa)?.nome || '', x.tipo === 'transferencia' ? pessoas.get(x.destino)?.nome || '' : '',
        x.situacao === 'pago' ? 'Pago' : 'Pendente', x.mensal ? 'Planilha mensal' : 'Lançamento', x.obs || '']);
    }
    lanc.filtro = `A1:J${lanc.linhas.length}`;

    const todas = [...abas, total, lanc];
    return escreverXLSX(todas, { ativa: abas.length });
  }

  // ── CSV e backup ─────────────────────────────────────────────────────────

  function csvDosLancamentos(lista, est) {
    const cats = LC.Dados.mapaPorId(est.categorias), pessoas = LC.Dados.mapaPorId(est.pessoas);
    const campo = (v) => {
      const s = String(v ?? '');
      return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const linhas = [['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor', 'Pessoa', 'Para (transferência)', 'Situação', 'Observação']];
    for (const t of lista) {
      linhas.push([LC.fmt.data(t.data), t.descricao, t.tipo === 'transferencia' ? '' : cats.get(t.categoria)?.nome || '',
        LC.Dados.ROTULO_TIPO[t.tipo], t.valor.toFixed(2).replace('.', ','), pessoas.get(t.pessoa)?.nome || '',
        t.tipo === 'transferencia' ? pessoas.get(t.destino)?.nome || '' : '', t.situacao === 'pago' ? 'Pago' : 'Pendente', t.obs || '']);
    }
    return '﻿' + linhas.map((l) => l.map(campo).join(';')).join('\r\n') + '\r\n';
  }

  function backup(est) {
    return JSON.stringify({ app: 'livro-caixa', versao: 2, exportadoEm: new Date().toISOString(), dados: est }, null, 1);
  }

  LC.Arquivos = {
    decodificarTexto, lerCSV, lerOFX, lerZip, criarZip, crc32, lerXLSX, lerArquivo, escreverXLSX,
    excelNoFormatoGastos, csvDosLancamentos, backup,
  };
})(globalThis.LC = globalThis.LC || {});
