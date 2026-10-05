/*
 * nuvem.js — Login, cadastro e o livro-caixa compartilhado no Firebase.
 *
 * Só entra em ação quando js/config-nuvem.js tem a configuração do Firebase. Sem ela, nada daqui
 * carrega e o Livro-Caixa guarda tudo no navegador, como antes.
 *
 *   Login: Firebase Authentication, e-mail e senha. A conta só abre um livro-caixa depois de confirmar o e-mail.
 *   Dados: Cloud Firestore, com cópia no aparelho (abre sem internet e envia quando ela volta).
 *     livros/{id}                               { nome, emails: [...], criadoPor, criadoEm }   quem usa
 *     livros/{id}/livro/config                  pessoas, categorias e gráficos
 *     livros/{id}/livro/config/meses/AAAA-MM    { itens: [...] }   um documento por mês
 *   As regras (firestore.rules) só deixam ler e gravar quem confirmou um dos e-mails da lista do livro.
 */
(function (LC) {
  'use strict';

  const SDK = ['vendor/firebase/firebase-app-compat.js', 'vendor/firebase/firebase-auth-compat.js', 'vendor/firebase/firebase-firestore-compat.js'];
  const CHAVE_LIVRO = 'livro-caixa/livro'; // último livro aberto neste aparelho: { uid, id }
  const MAX_EMAILS = 10;

  function config() {
    const c = globalThis.LC_FIREBASE;
    return c && typeof c === 'object' && c.apiKey && c.projectId ? c : null;
  }
  const configurada = () => !!config();

  const normalizarEmail = (s) => String(s ?? '').trim().toLowerCase();
  const emailValido = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizarEmail(s));
  // "a@x.com, b@y.com; c@z.com" → ['a@x.com', 'b@y.com', 'c@z.com'], sem repetir
  const listaDeEmails = (texto) => [...new Set(String(texto ?? '').split(/[\s,;]+/).map(normalizarEmail).filter(Boolean))];

  const MENSAGENS = {
    'auth/invalid-email': 'Esse e-mail não parece completo. Confira se não faltou nada.',
    'auth/missing-email': 'Escreva o seu e-mail.',
    'auth/missing-password': 'Escreva a senha.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/invalid-login-credentials': 'E-mail ou senha incorretos.',
    'auth/user-disabled': 'Esta conta foi desativada no Firebase.',
    'auth/email-already-in-use': 'Já existe uma conta com esse e-mail. Entre com ela, ou use "Esqueci minha senha".',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'auth/password-does-not-meet-requirements': 'A senha não segue as regras de senha definidas no Firebase.',
    'auth/too-many-requests': 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.',
    'auth/network-request-failed': 'Sem conexão com a internet. Confira a rede e tente de novo.',
    'auth/operation-not-allowed': 'O login por e-mail e senha não está ligado no Firebase. Veja o passo a passo no README.',
    'auth/admin-restricted-operation': 'A criação de contas está desligada neste Livro-Caixa. Peça para quem cuida dele liberar no Firebase.',
    'auth/requires-recent-login': 'Por segurança, saia e entre de novo antes de fazer isso.',
    'permission-denied': 'Sem permissão no banco de dados. Confira se o seu e-mail está na lista do livro-caixa e se as regras do Firebase foram publicadas (veja o README).',
    'unavailable': 'Sem conexão com o banco de dados. Confira a internet e tente de novo.',
    'failed-precondition': 'O banco de dados do Firebase ainda não foi criado. Veja o passo a passo no README.',
    'lc/sdk': 'Não foi possível carregar o login. Confira a internet e tente de novo.',
  };

  function mensagemErro(e) {
    const codigo = e && e.code;
    if (MENSAGENS[codigo]) return MENSAGENS[codigo];
    return `Não deu certo agora${codigo ? ` (${codigo})` : ''}. Tente de novo em instantes.`;
  }

  // ── Firebase ─────────────────────────────────────────────────────────────

  let fb = null;
  let auth = null;
  let fs = null;
  let iniciando = null;

  function carregarScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(Object.assign(new Error('Firebase não carregou'), { code: 'lc/sdk' }));
      document.head.append(s);
    });
  }

  function iniciarFirebase() {
    if (!iniciando) {
      iniciando = (async () => {
        await carregarScript(SDK[0]);
        await Promise.all(SDK.slice(1).map(carregarScript));
        fb = globalThis.firebase;
        const { emuladores, ...opcoes } = config();
        const appFb = fb.initializeApp(opcoes);
        auth = appFb.auth();
        fs = appFb.firestore();
        if (emuladores) { // só nos testes automáticos
          auth.useEmulator(emuladores.auth, { disableWarnings: true });
          const [host, porta] = emuladores.firestore.split(':');
          fs.useEmulator(host, +porta);
        }
        auth.useDeviceLanguage(); // e-mails de confirmação e de senha no idioma do aparelho
        try { await fs.enablePersistence({ synchronizeTabs: true }); } catch (_) { /* sem cópia no aparelho: funciona só com internet */ }
      })();
      iniciando.catch(() => { iniciando = null; });
    }
    return iniciando;
  }

  const usuarioInicial = () => new Promise((resolve) => {
    const parar = auth.onAuthStateChanged((u) => { parar(); resolve(u); });
  });

  // Links dos e-mails do Firebase voltam para o site; se o domínio não estiver autorizado no Firebase, vão sem volta.
  async function comVolta(fn) {
    const url = /^https?:$/.test(location.protocol) ? location.origin + location.pathname : null;
    if (!url) return fn(undefined);
    try { return await fn({ url }); } catch (e) {
      if (e && /continue-uri|unauthorized-domain|invalid-dynamic-link/.test(e.code || '')) return fn(undefined);
      throw e;
    }
  }
  const enviarConfirmacao = (u) => comVolta((volta) => u.sendEmailVerification(volta));
  const enviarNovaSenha = (email) => comVolta((volta) => auth.sendPasswordResetEmail(email, volta));

  // ── Tela de acesso ───────────────────────────────────────────────────────

  let tela = null;
  let erroEnvio = null; // o e-mail de confirmação do cadastro não saiu: a tela de confirmar mostra o motivo

  function mostrar(...conteudo) {
    const app = document.getElementById('app');
    if (!tela) {
      tela = LC.el('div', { id: 'acesso', class: 'acesso' });
      document.body.append(tela);
      if (app) app.inert = true;
    }
    LC.esvaziar(tela).append(LC.el('div', { class: 'acesso-caixa', role: 'region', 'aria-labelledby': 'acesso-titulo' }, marca(), ...conteudo));
    tela.scrollTop = 0;
    const foco = tela.querySelector('input:not([type="hidden"]):not([disabled])') || tela.querySelector('.botao-primario');
    if (foco) foco.focus({ preventScroll: true });
  }

  function fechar() {
    if (tela) { tela.remove(); tela = null; }
    const app = document.getElementById('app');
    if (app) app.inert = false;
  }

  const marca = () => LC.el('div', { class: 'acesso-marca' },
    LC.el('span', { class: 'marca-icone' }, LC.icone('livro')),
    LC.el('span', { class: 'marca-textos' },
      LC.el('span', { class: 'marca-nome', text: 'Livro-Caixa' }),
      LC.el('span', { class: 'marca-sub', text: 'controle financeiro da casa' })));

  const titulo = (texto) => LC.el('h1', { id: 'acesso-titulo', class: 'acesso-titulo', text: texto });
  const texto = (...partes) => LC.el('p', { class: 'acesso-texto' }, ...partes);

  // Linha de aviso dentro de um formulário: erro em vermelho, confirmação em verde.
  function linhaAviso() {
    const p = LC.el('p', { class: 'acesso-aviso', role: 'status', hidden: true });
    return {
      el: p,
      mostrar(msg, campo = null, tipo = 'erro') {
        p.textContent = msg || '';
        p.hidden = !msg;
        p.className = 'acesso-aviso ' + tipo;
        if (campo) campo.focus();
      },
    };
  }

  // Desliga o botão e troca o texto enquanto a ação roda.
  async function ocupado(botao, enquanto, fn) {
    const antes = botao.textContent;
    botao.disabled = true;
    botao.textContent = enquanto;
    try { return await fn(); } finally {
      if (botao.isConnected) { botao.disabled = false; botao.textContent = antes; }
    }
  }

  function campoSenha(id, autocomplete) {
    const input = LC.el('input', { id, class: 'entrada', type: 'password', autocomplete, required: true, autocapitalize: 'none', spellcheck: 'false' });
    const ver = LC.el('button', { type: 'button', class: 'botao-icone acesso-ver', 'aria-label': 'Mostrar a senha', 'aria-pressed': 'false', 'aria-controls': id }, LC.icone('olho'));
    ver.addEventListener('click', () => {
      const aberta = input.type === 'password';
      input.type = aberta ? 'text' : 'password';
      ver.setAttribute('aria-pressed', String(aberta));
      ver.setAttribute('aria-label', aberta ? 'Esconder a senha' : 'Mostrar a senha');
      LC.esvaziar(ver).append(LC.icone(aberta ? 'olho-riscado' : 'olho'));
      input.focus();
    });
    return { input, caixa: LC.el('div', { class: 'acesso-senha' }, input, ver) };
  }

  function campoEmail(id, valor, autocomplete) {
    return LC.el('input', {
      id, class: 'entrada', type: 'email', inputmode: 'email', autocomplete, autocapitalize: 'none', spellcheck: 'false',
      required: true, value: valor || '', placeholder: 'nome@gmail.com',
    });
  }

  function rodapeConta(email, aoSair) {
    return LC.el('p', { class: 'acesso-rodape' }, 'Entrou como ', LC.el('strong', { text: email }), ' · ',
      LC.el('button', { type: 'button', class: 'link', onclick: async () => { try { await auth.signOut(); } catch (_) { /* segue */ } aoSair(); } }, 'Sair'));
  }

  // Entrar, criar conta ou pedir senha nova. Resolve com o usuário logado.
  function telaEntrar() {
    return new Promise((resolve) => {
      let modo = 'entrar';
      let emailDigitado = '';

      const desenhar = () => (modo === 'senha' ? desenharSenha() : desenharEntrar());

      function desenharEntrar() {
        const criar = modo === 'criar';
        const email = campoEmail('acesso-email', emailDigitado, criar ? 'email' : 'username');
        email.addEventListener('input', () => { emailDigitado = email.value; });
        const senha = campoSenha('acesso-senha', criar ? 'new-password' : 'current-password');
        const senha2 = criar ? campoSenha('acesso-senha2', 'new-password') : null;
        const aviso = linhaAviso();
        const botao = LC.el('button', { type: 'submit', class: 'botao botao-primario acesso-botao' }, criar ? 'Criar conta' : 'Entrar');
        const form = LC.el('form', { class: 'acesso-form', novalidate: true },
          LC.UI.campo('E-mail', email),
          LC.UI.campo('Senha', senha.caixa, { para: 'acesso-senha', ajuda: criar ? 'Pelo menos 6 caracteres.' : null }),
          criar ? LC.UI.campo('Repita a senha', senha2.caixa, { para: 'acesso-senha2' }) : null,
          aviso.el, botao);
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const e = normalizarEmail(email.value);
          const s = senha.input.value;
          if (!emailValido(e)) return aviso.mostrar('Escreva o e-mail completo, como nome@gmail.com.', email);
          if (!s) return aviso.mostrar('Escreva a senha.', senha.input);
          if (criar && s.length < 6) return aviso.mostrar('A senha precisa ter pelo menos 6 caracteres.', senha.input);
          if (criar && s !== senha2.input.value) return aviso.mostrar('As duas senhas estão diferentes.', senha2.input);
          aviso.mostrar('');
          await ocupado(botao, criar ? 'Criando a conta…' : 'Entrando…', async () => {
            try {
              const cred = criar ? await auth.createUserWithEmailAndPassword(e, s) : await auth.signInWithEmailAndPassword(e, s);
              if (criar) { try { await enviarConfirmacao(cred.user); } catch (x) { erroEnvio = x; } }
              resolve(cred.user);
            } catch (x) { aviso.mostrar(mensagemErro(x)); }
          });
        });
        const trocar = LC.UI.segmentado([{ valor: 'entrar', rotulo: 'Entrar' }, { valor: 'criar', rotulo: 'Criar conta' }], modo,
          (v) => { modo = v; desenhar(); }, { rotulo: 'Entrar ou criar conta' });
        mostrar(
          trocar,
          titulo(criar ? 'Criar a sua conta' : 'Entrar no livro-caixa'),
          texto(criar
            ? 'Com a conta, os valores ficam guardados na nuvem e aparecem em todos os aparelhos de quem usa o livro-caixa.'
            : 'Use o e-mail e a senha da sua conta. Depois de entrar uma vez, este aparelho lembra de você.'),
          form,
          criar ? null : LC.el('p', { class: 'acesso-rodape' },
            LC.el('button', { type: 'button', class: 'link', onclick: () => { modo = 'senha'; desenhar(); } }, 'Esqueci minha senha')));
      }

      function desenharSenha() {
        const email = campoEmail('acesso-email', emailDigitado, 'username');
        email.addEventListener('input', () => { emailDigitado = email.value; });
        const aviso = linhaAviso();
        const botao = LC.el('button', { type: 'submit', class: 'botao botao-primario acesso-botao' }, 'Mandar o link');
        const form = LC.el('form', { class: 'acesso-form', novalidate: true }, LC.UI.campo('E-mail da conta', email), aviso.el, botao);
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const e = normalizarEmail(email.value);
          if (!emailValido(e)) return aviso.mostrar('Escreva o e-mail completo, como nome@gmail.com.', email);
          await ocupado(botao, 'Mandando…', async () => {
            const pronto = `Pronto. Se existir uma conta com ${e}, chega nela um link para criar uma senha nova. Confira também a caixa de spam.`;
            try { await enviarNovaSenha(e); aviso.mostrar(pronto, null, 'ok'); } catch (x) {
              // Não conta se o e-mail tem conta ou não.
              if (x && x.code === 'auth/user-not-found') aviso.mostrar(pronto, null, 'ok'); else aviso.mostrar(mensagemErro(x));
            }
          });
        });
        mostrar(
          titulo('Criar uma senha nova'),
          texto('Mandamos um link para o seu e-mail. Abra, crie a senha nova e volte aqui para entrar.'),
          form,
          LC.el('p', { class: 'acesso-rodape' }, LC.el('button', { type: 'button', class: 'link', onclick: () => { modo = 'entrar'; desenhar(); } }, 'Voltar para entrar')));
      }

      desenhar();
    });
  }

  // Espera a pessoa confirmar o e-mail. Resolve com o usuário confirmado, ou null se ela sair.
  function telaConfirmar(u) {
    return new Promise((resolve) => {
      let fim = false;
      const aviso = linhaAviso();
      const concluir = (valor) => {
        if (fim) return;
        fim = true;
        clearInterval(relogio);
        document.removeEventListener('visibilitychange', aoVoltar);
        resolve(valor);
      };
      const conferir = async (manual) => {
        if (fim) return;
        try { await u.reload(); } catch (x) { if (manual) aviso.mostrar(mensagemErro(x)); return; }
        const atual = auth.currentUser;
        if (!atual) { concluir(null); return; }
        if (atual.emailVerified) {
          // Token novo, para as regras do banco já verem o e-mail confirmado.
          try { await atual.getIdToken(true); } catch (_) { /* vale no próximo acesso */ }
          concluir(atual);
          return;
        }
        if (manual) aviso.mostrar('Ainda não aparece como confirmado. Toque no link do e-mail e depois aqui de novo.');
      };
      const aoVoltar = () => { if (document.visibilityState === 'visible') conferir(false); };
      document.addEventListener('visibilitychange', aoVoltar);
      const relogio = setInterval(() => conferir(false), 6000);
      if (erroEnvio) {
        const x = erroEnvio;
        erroEnvio = null;
        setTimeout(() => aviso.mostrar(`O e-mail de confirmação não foi enviado: ${mensagemErro(x)}`));
      }

      const confirmei = LC.el('button', { type: 'button', class: 'botao botao-primario acesso-botao' }, 'Já confirmei');
      confirmei.addEventListener('click', () => ocupado(confirmei, 'Conferindo…', () => conferir(true)));
      const reenviar = LC.el('button', { type: 'button', class: 'botao acesso-botao' }, 'Mandar o e-mail de novo');
      reenviar.addEventListener('click', () => ocupado(reenviar, 'Mandando…', async () => {
        try { await enviarConfirmacao(u); aviso.mostrar(`Mandamos outro e-mail para ${u.email}.`, null, 'ok'); } catch (x) { aviso.mostrar(mensagemErro(x)); }
      }));
      mostrar(
        LC.el('div', { class: 'acesso-selo' }, LC.icone('email')),
        titulo('Confirme o seu e-mail'),
        texto('Mandamos um link para ', LC.el('strong', { text: u.email }), '. Abra o e-mail, toque no link e volte aqui. Se não encontrar, confira a caixa de spam.'),
        aviso.el,
        LC.el('div', { class: 'acesso-acoes' }, confirmei, reenviar),
        rodapeConta(u.email, () => concluir(null)));
    });
  }

  async function procurarLivros(email) {
    const qs = await fs.collection('livros').where('emails', 'array-contains', email).get();
    return qs.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  function lembrar(uid, id) { try { localStorage.setItem(CHAVE_LIVRO, JSON.stringify({ uid, id })); } catch (_) { /* conveniência */ } }
  function lembrado(uid) {
    try { const x = JSON.parse(localStorage.getItem(CHAVE_LIVRO)); return x && x.uid === uid ? x.id : null; } catch (_) { return null; }
  }

  async function criarLivro(u, outros) {
    const emails = [...new Set([normalizarEmail(u.email), ...outros])];
    if (emails.length > MAX_EMAILS) throw new Error(`Um livro-caixa aceita até ${MAX_EMAILS} e-mails.`);
    const ref = fs.collection('livros').doc();
    await ref.set({ nome: 'Livro-Caixa', emails, criadoPor: u.uid, criadoEm: fb.firestore.FieldValue.serverTimestamp() });
    return { id: ref.id, emails, novo: true };
  }

  // Qual livro-caixa abrir: o único com o e-mail da pessoa, o último aberto aqui, ou ela escolhe ou cria.
  async function escolherLivro(u) {
    const email = normalizarEmail(u.email);
    const ultimo = lembrado(u.uid);
    if (ultimo && navigator.onLine === false) return { id: ultimo, emails: [email] }; // sem internet: a cópia do aparelho abre
    let livros;
    try { livros = await procurarLivros(email); } catch (x) {
      if (ultimo && x && x.code === 'unavailable') return { id: ultimo, emails: [email] };
      throw x;
    }
    if (!livros.length) return telaSemLivro(u);
    return livros.find((l) => l.id === ultimo) || (livros.length === 1 ? livros[0] : telaEscolher(u, livros));
  }

  // Ninguém pôs o e-mail desta pessoa em um livro-caixa: procurar de novo ou criar um.
  function telaSemLivro(u) {
    return new Promise((resolve) => {
      const email = normalizarEmail(u.email);
      const avisoProcura = linhaAviso();
      const procurar = LC.el('button', { type: 'button', class: 'botao acesso-botao' }, 'Procurar de novo');
      procurar.addEventListener('click', () => ocupado(procurar, 'Procurando…', async () => {
        try {
          const livros = await procurarLivros(email);
          if (!livros.length) { avisoProcura.mostrar('Ainda nada. Confira se o e-mail adicionado foi exatamente este.'); return; }
          resolve(livros.length === 1 ? livros[0] : await telaEscolher(u, livros));
        } catch (x) { avisoProcura.mostrar(mensagemErro(x)); }
      }));

      const outros = LC.el('input', { id: 'acesso-outros', class: 'entrada', type: 'text', inputmode: 'email', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'nome@gmail.com' });
      const aviso = linhaAviso();
      const criar = LC.el('button', { type: 'submit', class: 'botao botao-primario acesso-botao' }, 'Criar o livro-caixa');
      const form = LC.el('form', { class: 'acesso-form acesso-form-solto', novalidate: true },
        LC.UI.campo('E-mail de quem vai usar junto (opcional)', outros, { ajuda: 'Para mais de uma pessoa, separe os e-mails com vírgula. Dá para mudar depois, em Cadastros.' }),
        aviso.el, criar);
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const lista = listaDeEmails(outros.value);
        const ruim = lista.find((e) => !emailValido(e));
        if (ruim) return aviso.mostrar(`"${ruim}" não parece um e-mail completo.`, outros);
        await ocupado(criar, 'Criando…', async () => {
          try { resolve(await criarLivro(u, lista)); } catch (x) { aviso.mostrar(x.code ? mensagemErro(x) : x.message); }
        });
      });

      mostrar(
        titulo('Abrir o livro-caixa'),
        texto('Ainda não existe um livro-caixa com o seu e-mail, ', LC.el('strong', { text: email }), '.'),
        LC.el('section', { class: 'acesso-bloco', 'aria-labelledby': 'acesso-bloco-1' },
          LC.el('h2', { id: 'acesso-bloco-1', class: 'acesso-subtitulo', text: 'Outra pessoa já criou?' }),
          texto('Peça para ela adicionar o seu e-mail em Cadastros, no quadro "Quem usa este livro-caixa". Depois toque em Procurar de novo.'),
          avisoProcura.el, procurar),
        LC.el('section', { class: 'acesso-bloco', 'aria-labelledby': 'acesso-bloco-2' },
          LC.el('h2', { id: 'acesso-bloco-2', class: 'acesso-subtitulo', text: 'Começar um novo' }),
          texto('Você cria o livro-caixa e diz quem mais pode abrir. Cada pessoa entra com a própria conta.'),
          form),
        rodapeConta(email, () => resolve(null)));
    });
  }

  function telaEscolher(u, livros) {
    return new Promise((resolve) => {
      const email = normalizarEmail(u.email);
      mostrar(
        titulo('Qual livro-caixa?'),
        texto('O seu e-mail está em mais de um livro-caixa. Escolha qual abrir; dá para trocar depois saindo e entrando de novo.'),
        LC.el('ul', { class: 'acesso-livros' }, livros.map((l) => LC.el('li', null,
          LC.el('button', { type: 'button', class: 'botao acesso-livro', onclick: () => resolve(l) },
            LC.el('strong', { text: l.nome || 'Livro-Caixa' }),
            LC.el('span', { class: 'ajuda', text: (l.emails || []).filter((e) => e !== email).join(', ') || 'só você' }))))),
        rodapeConta(email, () => resolve(null)));
    });
  }

  // Erro que impede abrir: tentar de novo recarrega a página. Não resolve.
  function telaErro(msg) {
    return new Promise(() => {
      const tentar = LC.el('button', { type: 'button', class: 'botao botao-primario acesso-botao', onclick: () => location.reload() }, 'Tentar de novo');
      mostrar(
        LC.el('div', { class: 'acesso-selo acesso-selo-alerta' }, LC.icone('alerta')),
        titulo('Não deu para abrir o livro-caixa'),
        texto(msg),
        LC.el('div', { class: 'acesso-acoes' }, tentar),
        auth && auth.currentUser
          ? LC.el('p', { class: 'acesso-rodape' }, LC.el('button', { type: 'button', class: 'link', onclick: sair }, 'Sair desta conta'))
          : null);
    });
  }

  // ── Sessão ───────────────────────────────────────────────────────────────

  let sessao = null;
  const ouvintes = new Set();

  function iniciarSessao(u, livro) {
    const raiz = fs.collection('livros').doc(livro.id);
    sessao = {
      usuario: { email: normalizarEmail(u.email), uid: u.uid },
      livro: { id: livro.id, emails: (livro.emails || []).slice() },
      novo: !!livro.novo,
      // O que o armazenamento usa: caminhos relativos ao livro, "confirmar" espera o servidor receber tudo,
      // e as escutas também avisam quando a cópia do aparelho foi conferida com o servidor.
      db: {
        doc: (caminho) => fs.doc(`livros/${livro.id}/${caminho}`),
        confirmar: () => fs.waitForPendingWrites(),
        opcoesEscuta: { includeMetadataChanges: true },
      },
    };
    // A lista de quem usa, ao vivo. Se tirarem o e-mail desta pessoa da lista, o banco corta a leitura na hora.
    const perdeuAcesso = () => telaErro('O seu e-mail saiu da lista de quem usa este livro-caixa. Peça para alguém da lista adicionar de novo, em Cadastros.');
    raiz.onSnapshot((snap) => {
      if (!snap.exists) return;
      const emails = (snap.data().emails || []).slice();
      if (!snap.metadata.fromCache && !emails.includes(sessao.usuario.email)) { perdeuAcesso(); return; }
      sessao.livro.emails = emails;
      for (const f of ouvintes) f(sessao.livro);
    }, (e) => { if (e && e.code === 'permission-denied') perdeuAcesso(); });
    return sessao;
  }

  // Mostra as telas de acesso até haver uma conta confirmada com um livro-caixa aberto.
  async function abrir() {
    try { await iniciarFirebase(); } catch (x) { await telaErro(mensagemErro(x)); }
    let u = await usuarioInicial();
    for (;;) {
      if (!u) u = await telaEntrar();
      if (!u.emailVerified) {
        u = await telaConfirmar(u);
        if (!u) continue;
      }
      let livro;
      try { livro = await escolherLivro(u); } catch (x) { await telaErro(mensagemErro(x)); }
      if (!livro) { u = null; continue; }
      lembrar(u.uid, livro.id);
      fechar();
      return iniciarSessao(u, livro);
    }
  }

  async function adicionarEmails(textoEmails) {
    const lista = listaDeEmails(textoEmails);
    if (!lista.length) throw new Error('Escreva o e-mail da pessoa.');
    const ruim = lista.find((e) => !emailValido(e));
    if (ruim) throw new Error(`"${ruim}" não parece um e-mail completo.`);
    const novos = lista.filter((e) => !sessao.livro.emails.includes(e));
    if (!novos.length) throw new Error(lista.length > 1 ? 'Esses e-mails já estão na lista.' : 'Esse e-mail já está na lista.');
    if (sessao.livro.emails.length + novos.length > MAX_EMAILS) throw new Error(`Um livro-caixa aceita até ${MAX_EMAILS} e-mails.`);
    try { await fs.doc(`livros/${sessao.livro.id}`).update({ emails: fb.firestore.FieldValue.arrayUnion(...novos) }); } catch (x) { throw new Error(mensagemErro(x)); }
    return novos;
  }

  async function removerEmail(email) {
    if (sessao.livro.emails.length <= 1) throw new Error('O livro-caixa precisa de pelo menos um e-mail na lista.');
    try { await fs.doc(`livros/${sessao.livro.id}`).update({ emails: fb.firestore.FieldValue.arrayRemove(email) }); } catch (x) { throw new Error(mensagemErro(x)); }
  }

  async function trocarSenha() {
    try { await enviarNovaSenha(sessao.usuario.email); } catch (x) { throw new Error(mensagemErro(x)); }
  }

  // Sai da conta e apaga a cópia do livro-caixa guardada neste aparelho.
  async function sair() {
    // Dá alguns segundos para o que está na fila chegar ao servidor.
    try { await Promise.race([fs.waitForPendingWrites(), new Promise((r) => setTimeout(r, 5000))]); } catch (_) { /* segue */ }
    try { await auth.signOut(); } catch (_) { /* segue */ }
    try { await fs.terminate(); await fs.clearPersistence(); } catch (_) { /* outra aba aberta: a cópia fica, mas só abre com login */ }
    try { localStorage.removeItem(CHAVE_LIVRO); } catch (_) { /* conveniência */ }
    location.reload();
  }

  LC.Nuvem = {
    configurada, abrir, sair, telaErro, trocarSenha, adicionarEmails, removerEmail,
    sessao: () => sessao,
    aoMudarLivro: (f) => { ouvintes.add(f); return () => ouvintes.delete(f); },
    normalizarEmail, emailValido, listaDeEmails, mensagemErro,
  };
})(globalThis.LC = globalThis.LC || {});
