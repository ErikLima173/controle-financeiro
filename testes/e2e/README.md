# Testes no navegador

Abrem o Livro-Caixa no Chromium e usam o sistema como uma pessoa usaria. Ficam fora do `npm test` porque
precisam do Playwright.

```text
npm install --no-save playwright
npx playwright install chromium
node testes/e2e/telas.js        # todas as telas, no computador (claro e escuro) e no celular
node testes/e2e/importacao.js   # importa a planilha de exemplo e confere a aba Total finanças
```

As capturas de tela vão para a pasta temporária do sistema (`livro-caixa-capturas`), ou para `$CAPTURAS`.

| Script | O que confere |
|---|---|
| `telas.js` | erros no console; rolagem horizontal; cada item do menu abre; a linha de Dezembro aparece em todas as abas da tela Mensal; o leitor de .xlsx do app lê a planilha de exemplo com os totais certos |
| `importacao.js` | importação pelo assistente: a aba Total finanças bate com as fórmulas da planilha, mês a mês e por pessoa; os exemplos saem; recarregar mantém os dados; importar de novo não soma duas vezes; a aba oculta "Gastos" entra em 2025 e 2026 |

A planilha usada é `testes/fixtures/gastos-exemplo.xlsx`: o mesmo layout do `Gastos.xlsx` (abas "Gastos Nathy",
"Gastos vini", "Total finanças" e a oculta "Gastos"), com **valores inventados**. Os totais esperados estão em
`gastos-exemplo.esperado.json`. Os dois arquivos saem de `testes/fixtures/gerar_gastos_exemplo.py`.
