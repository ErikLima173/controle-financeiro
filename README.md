# Livro-Caixa

Controle financeiro visual no formato da planilha **Gastos**: uma aba por pessoa (um mês por linha, uma
categoria por coluna, Total gasto, Salário e Total restante) e a aba **Total finanças** que soma todo mundo.
Roda no navegador, sem instalar nada.

## Como abrir

- **Na internet, para a casa toda:** publique no Vercel e ligue o login (passo a passo abaixo). Cada pessoa entra
  com o próprio e-mail e senha e vê os mesmos valores, ao vivo, no celular e no computador.
- **Só no seu computador:** dois cliques em `abrir.bat` (Windows) ou abra o `index.html` no Chrome, Edge ou Firefox.
  Sem o login ligado, os dados ficam só no navegador onde você abriu.
- A biblioteca de gráficos (Chart.js) e o Firebase vêm junto, na pasta `vendor/`. A fonte IBM Plex vem do Google
  Fonts quando há internet; sem ela, o sistema usa a fonte do aparelho.

## Primeiros passos

1. Na primeira abertura aparecem **valores de exemplo** nas colunas da planilha (inventados e marcados como exemplo).
2. Clique em **Importar minha planilha** e escolha o seu `Gastos.xlsx`. O sistema reconhece as abas
   "Gastos Nathy" e "Gastos vini", e também a aba oculta "Gastos" com os blocos de 2025 e 2026.
   Ele pergunta de quem é cada aba, mostra quanto entra em cada ano e tira os exemplos.
   Na aba antiga, os anos que as abas das pessoas já cobrem ficam desmarcados, porque a Total finanças da
   planilha soma só as abas das pessoas e importar os dois contaria os mesmos gastos duas vezes. Dá para marcar.
3. Daí em diante, use a tela **Mensal** como a sua planilha: clique numa célula e digite o total do mês.
   Total gasto, Total restante, Total e Média são calculados sozinhos.
4. Em **Cadastros → Pessoas**, confira o **Saldo hoje** de cada pessoa. Se não bater com o banco, digite o valor
   certo: a diferença vira o saldo inicial, e o saldo segue somando o que entra e tirando o que sai.

## Telas

| Tela | O que tem |
|---|---|
| **Painel** | Total restante do mês, com quanto cada pessoa gastou do que recebeu; total recebido, total gasto, total restante e % guardado no período, comparados com o período anterior; contas a pagar e a receber; gráficos editáveis |
| **Mensal** | As abas "Gastos ‹pessoa›" e "Total finanças", editáveis pelo teclado como no Excel, com seletor de ano, colunas que você adiciona, move ou tira, e um gráfico de recebido x gasto |
| **Lançamentos** | Opcional: cada gasto ou recebimento numa linha (mercado, posto…), com busca, filtros, saldo corrido, edição direto na célula, parcelamento e repetição mensal. A planilha mensal soma esses lançamentos na célula do mês |
| **Orçamento** | Quanto cada categoria pode gastar por mês, quanto já foi usado e quanto dá para gastar por dia até o fim do mês |
| **Cadastros** | Pessoas (com o saldo de hoje de cada uma), categorias e cores, quem usa o livro-caixa (com o login ligado), exportação, backup e atalhos |

## Gráficos editáveis

No painel, o lápis de cada gráfico abre o editor, com prévia ao vivo. Dá para mudar:

- o tipo: colunas, barras, linha, área, rosca ou pizza;
- o que mostrar: gastos, recebido, restante, recebido x gasto, saldo acumulado, % guardado, orçado x gasto;
- como agrupar: por mês, semana, dia, dia da semana, categoria, grupo de categorias, fixo ou variável, pessoa ou situação;
- separar em séries (por exemplo, uma cor por pessoa) e mostrar só algumas pessoas ou categorias;
- os valores escritos no gráfico, a linha de meta, as cores de cada série, a largura e a altura.

Também tem modelos prontos, como "Gastos por pessoa", "Gastos de uma pessoa" e "% guardado por mês".

**Grupos e gastos fixos.** Cada categoria de gasto fica num grupo (Moradia, Pets, Transporte, Alimentação…) e pode ser
marcada como **gasto fixo** (conta que se repete todo mês, como aluguel e internet). As duas coisas se ajustam em
**Cadastros → Categorias**, onde os gastos aparecem separados por grupo. No painel, o gráfico **Gastos por grupo** abre
as categorias de um grupo quando você clica nele (e "Todos os grupos" volta), e **Fixos x variáveis** mostra, mês a mês,
quanto foi conta fixa e quanto foi o resto. Categorias que vieram da planilha ganham um grupo sugerido pelo nome.
Arraste um gráfico pela alça para reordenar. Cada gráfico tem uma visão em tabela e pode ser baixado em PNG.

## Excel

**Exportar → Excel de 2026 (formato Gastos)** gera um arquivo no mesmo formato da sua planilha:

- uma aba "Gastos ‹pessoa›" por pessoa, com fórmulas: Total Gasto é a soma do mês; Total restante é Salário − Total Gasto;
- a aba "Total finanças", somando as abas das pessoas com as mesmas fórmulas da planilha original, mais o % guardado e o gasto do ano por categoria;
- gráficos nativos do Excel, que você edita lá dentro: recebido x gasto por mês e gastos por categoria;
- a aba "Lançamentos", com tudo o que foi lançado no ano.

Mudar um valor no Excel atualiza os totais e os gráficos. O arquivo exportado pode ser importado de volta.
Na importação, a opção "Substituir os valores desses meses" evita somar duas vezes.

Também dá para exportar CSV, baixar um backup completo (.json) e baixar uma planilha modelo vazia.
Na importação, além do formato mensal, o sistema aceita listas de lançamentos em .xlsx ou .csv e extratos .ofx do banco.

## Instalar como app

Pelo endereço do Vercel, o Livro-Caixa pode ser instalado como um app, com ícone próprio, janela só dele e
funcionando sem internet. Não precisa de loja de apps, e as atualizações chegam sozinhas.

- **PC (Chrome ou Edge):** clique no ícone de instalar no fim da barra de endereço, ou em **Instalar app** no menu do Livro-Caixa.
- **Android (Chrome):** menu ⋮ → **Instalar app** (ou o aviso que aparece embaixo).
- **iPhone (Safari):** botão **Compartilhar** → **Adicionar à Tela de Início**.

## Publicar no Vercel

1. Entre em [vercel.com](https://vercel.com) com a sua conta do GitHub.
2. **Add New → Project** e importe este repositório (se pedir, autorize o acesso a ele).
3. Deixe as configurações como estão (Framework Preset: **Other**, sem comando de build) e clique em **Deploy**.

Sai um endereço como `controle-financeiro.vercel.app`. Cada mudança no `main` vai para o ar sozinha.
Sem o passo seguinte, cada aparelho que abrir o endereço guarda a própria cópia, separada das outras.

## Login e dados na nuvem (Firebase)

Com o Firebase ligado, o site passa a ter tela de login e cadastro, e os valores ficam num banco de dados que
aparece ao vivo em todos os aparelhos de quem usa: o que uma pessoa digita aparece na tela da outra em instantes,
sem recarregar. Sem internet, o que você muda fica guardado no aparelho e sobe quando ela volta.
O plano gratuito do Firebase (Spark) sobra para uma casa e não pede cartão.

**Uma vez só, em [console.firebase.google.com](https://console.firebase.google.com):**

1. **Projeto:** Criar projeto (Create project) → um nome, como `livro-caixa`. O Google Analytics pode ficar desligado.
2. **Login:** Authentication → Vamos começar (Get started) → Método de login (Sign-in method) → **E-mail/senha** → Ativar → Salvar.
3. **Banco de dados:** Firestore Database → Criar banco de dados (Create database) → edição Standard → local
   `southamerica-east1 (São Paulo)` → **modo de produção** (production mode).
4. **Regras:** Firestore Database → Regras (Rules) → apague o que estiver lá, cole o conteúdo do arquivo
   [`firestore.rules`](firestore.rules) deste repositório → **Publicar** (Publish).
5. **Endereço do site:** Authentication → Configurações (Settings) → Domínios autorizados (Authorized domains) →
   Adicionar domínio → o endereço do Vercel, como `controle-financeiro.vercel.app`. Assim o link dos e-mails volta para o site.
6. **Ligar no site:** Configurações do projeto (engrenagem) → Seus apps (Your apps) → ícone **`</>`** (Web) → um apelido →
   Registrar app. Copie o objeto `firebaseConfig` que aparece e cole em [`js/config-nuvem.js`](js/config-nuvem.js), no
   lugar do `null` (dá para editar pelo próprio site do GitHub, no lápis do arquivo). O Vercel publica sozinho.

**Depois, no site:**

- A primeira pessoa cria a conta e toca em **Criar o livro-caixa**, escrevendo o e-mail de quem vai usar junto.
- A outra pessoa cria a conta com esse e-mail, e o mesmo livro-caixa abre direto.
- **Cadastros → Quem usa este livro-caixa** mostra a lista: dá para adicionar e tirar e-mails, trocar a senha e sair.
  Quem sai da lista perde o acesso na hora.
- Se o navegador já tinha valores de antes de ligar o login, eles vão para o livro-caixa novo.

**Segurança:**

- Os valores de `js/config-nuvem.js` não são senha: só dizem qual é o projeto. Quem protege os dados são as regras
  do `firestore.rules`: só quem entrou com um e-mail que está na lista do livro-caixa lê ou grava.
- **Importante:** depois que todos da casa tiverem conta, feche a criação de contas, para ninguém mais criar uma conta
  com um e-mail da lista: Authentication → Configurações →
  Ações do usuário (User actions) → desmarque a criação de contas (Enable create / sign-up).
- Se o e-mail de confirmação do Firebase chegar para vocês, dá para exigir a confirmação: `confirmarEmail: true` em
  `js/config-nuvem.js` e a linha indicada no `firestore.rules`.
- Para só certas pessoas poderem criar um livro-caixa, troque a função `podeCriar()` no `firestore.rules` (o arquivo
  explica como) e publique as regras de novo.

## Onde ficam os dados

- **Com o login ligado:** no Cloud Firestore do seu projeto do Firebase, com uma cópia em cada aparelho
  (por isso abre sem internet). Sair da conta apaga a cópia do aparelho.
- **Sem o login:** no navegador do aparelho onde você abriu o Livro-Caixa (localStorage). Nada é enviado para servidor nenhum.
  Para levar a outro computador ou navegador, baixe um backup e importe lá.
- Nos dois casos, faça um backup de vez em quando: **Cadastros → Baixar backup**.
- Planilhas, extratos e backups (`.xlsx`, `.csv`, `.ofx`, `livro-caixa-backup-*.json`) estão no `.gitignore`,
  para não irem parar no GitHub por engano. Este repositório é público.

## Atalhos de teclado

| Tecla | Ação |
|---|---|
| `N` | Novo lançamento |
| `/` | Buscar nos lançamentos |
| Setas | Andar pelas células das planilhas |
| Enter ou F2 | Editar a célula; Enter de novo confirma e desce |
| Digitar um número | Começa a editar a célula da planilha mensal |
| Tab | Confirmar e ir para a próxima coluna |
| Esc | Cancelar a edição |
| Delete | Apagar o valor da célula (mensal) ou o lançamento (lançamentos) |
| Ctrl + Enter | Salvar no editor de gráfico |

## Para quem for mexer no código

HTML, CSS e JavaScript puro, sem build. É só editar e recarregar a página.

```text
index.html              estrutura da página e ícones
css/estilo.css          tema claro e escuro, layout e componentes
js/util.js              formatação pt-BR, datas, números ("1.234,56"), cores e DOM
js/dados.js             pessoas, categorias, lançamentos, planilha mensal, saldos, importação e contas dos gráficos
js/arquivos.js          leitura de .xlsx, .csv e .ofx; Excel no formato Gastos (fórmulas e gráficos nativos)
js/armazenamento.js     onde salvar (navegador, Firebase ou nuvem do Claude) e downloads
js/config-nuvem.js      configuração do Firebase (null = sem login, tudo no navegador)
js/nuvem.js             login, cadastro, confirmação do e-mail e o livro-caixa compartilhado no Firebase
js/ui.js                avisos, confirmações, menus, seletor de cor e controles
js/graficos.js          gráficos (Chart.js), cartões do painel e o editor de gráficos
js/mensal.js            a tela Mensal (abas por pessoa e Total finanças)
js/planilha.js          a tela Lançamentos
js/app.js               navegação, painel, orçamento, cadastros, formulários e importação
firestore.rules         regras de segurança do banco (quem pode ler e gravar)
firebase.json           emuladores do Firebase para os testes (e "firebase deploy --only firestore:rules", se quiser)
vendor/                 Chart.js 4.5.1 (licença MIT) e Firebase 12.19.0 (licença Apache 2.0)
testes/                 testes automatizados
```

Testes (Node 18 ou mais novo):

- `npm test`: números, datas, leitura de arquivos, planilha mensal, saldos e Excel.
- Login e sincronização, com os emuladores do Firebase (precisa de Java 11 ou mais novo e do Playwright):

  ```text
  npm install -g firebase-tools
  npm install --no-save playwright && npx playwright install chromium
  firebase emulators:exec --project demo-livro-caixa "node testes/nuvem/sincronizacao.js"
  ```
