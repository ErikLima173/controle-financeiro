# Livro-Caixa

Controle financeiro visual no formato da planilha **Gastos**: uma aba por pessoa (um mês por linha, uma
categoria por coluna, Total gasto, Salário e Total restante) e a aba **Total finanças** que soma todo mundo.
Roda no navegador, sem instalar nada, e os dados ficam no seu computador.

## Como abrir

- **Windows:** dois cliques em `abrir.bat` (ou direto no `index.html`).
- **Qualquer sistema:** abra o `index.html` no Chrome, Edge ou Firefox.
- Funciona sem internet: a biblioteca de gráficos (Chart.js) vem junto, na pasta `vendor/`. A fonte IBM Plex
  vem do Google Fonts quando há internet; sem ela, o sistema usa a fonte do computador.

## Primeiros passos

1. Na primeira abertura aparecem **valores de exemplo** nas colunas da planilha (inventados e marcados como exemplo).
2. Clique em **Importar minha planilha** e escolha o seu `Gastos.xlsx`. O sistema reconhece as abas
   "Gastos Nathy" e "Gastos vini", e também a aba oculta "Gastos" com os blocos de 2025 e 2026.
   Ele pergunta de quem é cada aba, mostra quanto entra em cada ano e tira os exemplos.
3. Daí em diante, use a tela **Mensal** como a sua planilha: clique numa célula e digite o total do mês.
   Total gasto, Total restante, Total e Média são calculados sozinhos.

## Telas

| Tela | O que tem |
|---|---|
| **Painel** | Total restante do mês, com quanto cada pessoa gastou do que recebeu; total recebido, total gasto, total restante e % guardado no período, comparados com o período anterior; contas a pagar e a receber; gráficos editáveis |
| **Mensal** | As abas "Gastos ‹pessoa›" e "Total finanças", editáveis pelo teclado como no Excel, com seletor de ano, colunas que você adiciona, move ou tira, e um gráfico de recebido x gasto |
| **Lançamentos** | Opcional: cada gasto ou recebimento numa linha (mercado, posto…), com busca, filtros, saldo corrido, edição direto na célula, parcelamento e repetição mensal. A planilha mensal soma esses lançamentos na célula do mês |
| **Orçamento** | Quanto cada categoria pode gastar por mês, quanto já foi usado e quanto dá para gastar por dia até o fim do mês |
| **Cadastros** | Pessoas, categorias (cores), exportação, backup e atalhos |

## Gráficos editáveis

No painel, o lápis de cada gráfico abre o editor, com prévia ao vivo. Dá para mudar:

- o tipo: colunas, barras, linha, área, rosca ou pizza;
- o que mostrar: gastos, recebido, restante, recebido x gasto, saldo acumulado, % guardado, orçado x gasto;
- como agrupar: por mês, semana, dia, dia da semana, categoria, pessoa ou situação;
- separar em séries (por exemplo, uma cor por pessoa) e mostrar só algumas pessoas ou categorias;
- os valores escritos no gráfico, a linha de meta, as cores de cada série, a largura e a altura.

Também tem modelos prontos, como "Gastos por pessoa", "Gastos de uma pessoa" e "% guardado por mês".
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

## Onde ficam os dados

No navegador do computador onde você abriu o Livro-Caixa (localStorage). Nada é enviado para servidor nenhum.

- Faça um backup de vez em quando: **Cadastros → Baixar backup**.
- Para levar a outro computador ou navegador, importe esse backup lá.
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
js/dados.js             pessoas, categorias, lançamentos, planilha mensal, importação e contas dos gráficos
js/arquivos.js          leitura de .xlsx, .csv e .ofx; Excel no formato Gastos (fórmulas e gráficos nativos)
js/armazenamento.js     onde salvar (navegador ou nuvem do Claude) e downloads
js/ui.js                avisos, confirmações, menus, seletor de cor e controles
js/graficos.js          gráficos (Chart.js), cartões do painel e o editor de gráficos
js/mensal.js            a tela Mensal (abas por pessoa e Total finanças)
js/planilha.js          a tela Lançamentos
js/app.js               navegação, painel, orçamento, cadastros, formulários e importação
vendor/                 Chart.js 4.5.1 (licença MIT)
testes/                 testes automatizados (Node)
```

Testes (Node 18 ou mais novo): `npm test` ou `node --test testes/*.test.js`.
