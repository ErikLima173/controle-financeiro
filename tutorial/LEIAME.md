# Vídeo tutorial

Grava o site de verdade num navegador (login e banco nos emuladores do Firebase, planilha com valores inventados),
com legendas, cursor e, se houver, a narração da ElevenLabs sincronizada.

```text
ELEVENLABS_API_KEY=... node tutorial/gerar-narracao.js        # falas em tutorial/falas/ (precisa de acesso a api.elevenlabs.io)
firebase emulators:exec --project demo-livro-caixa "node tutorial/gravar.js"
./tutorial/montar.sh                                           # tutorial/saida/tutorial-livro-caixa.mp4
```

O texto da narração está em `narracao.json`. Sem as falas, `gravar.js` faz o vídeo só com legendas.
