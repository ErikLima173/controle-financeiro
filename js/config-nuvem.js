/*
 * config-nuvem.js — Liga o login e o livro-caixa compartilhado (Firebase).
 *
 * Com null, o Livro-Caixa guarda tudo só neste navegador, sem login.
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
globalThis.LC_FIREBASE = null;
