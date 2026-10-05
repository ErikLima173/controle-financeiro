/*
 * config-nuvem.js — Liga o login e o livro-caixa compartilhado (Firebase).
 *
 * Com null no lugar do objeto, o Livro-Caixa guarda tudo só no navegador, sem login.
 *
 * Para os dados aparecerem em todos os aparelhos, com login e cadastro: crie o projeto no Firebase
 * (passo a passo no README, em "Login e dados na nuvem") e troque o null abaixo pelo objeto que o
 * Firebase mostra em Configurações do projeto → Seus apps → Configuração do SDK, assim:
 *
 *   globalThis.LC_FIREBASE = {
 *     apiKey: "AIza...",
 *     authDomain: "seu-projeto.firebaseapp.com",
 *     projectId: "seu-projeto",
 *     storageBucket: "seu-projeto.firebasestorage.app",
 *     messagingSenderId: "123456789",
 *     appId: "1:123456789:web:abc123"
 *   };
 *
 * Esses valores não são senha: aparecem para qualquer navegador que abre o site. Quem protege os dados
 * são as regras de segurança (firestore.rules), que só deixam entrar os e-mails da lista de cada livro-caixa.
 */
globalThis.LC_FIREBASE = {
  apiKey: "AIzaSyBCRKL0b-ljkloomUx447e3AAHDuYRdc3I",
  authDomain: "controle-financeiro-38c1b.firebaseapp.com",
  projectId: "controle-financeiro-38c1b",
  storageBucket: "controle-financeiro-38c1b.firebasestorage.app",
  messagingSenderId: "792491034175",
  appId: "1:792491034175:web:4351ad14dca6a85acf9a8a"
};
