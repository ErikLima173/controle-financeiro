/*
 * Gera a narração do tutorial com a ElevenLabs: um MP3 por fala de narracao.json, em tutorial/falas/.
 *   ELEVENLABS_API_KEY=... node tutorial/gerar-narracao.js [modelo] [voz]
 * Sem modelo, usa o mais novo multilíngue da conta (v4, se houver; senão v3).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const chave = process.env.ELEVENLABS_API_KEY;
if (!chave) { console.error('Falta ELEVENLABS_API_KEY.'); process.exit(2); }
const VOZ = process.argv[3] || 'RGymW84CSmfVugnA5tvA';
const pasta = path.join(__dirname, 'falas');
fs.mkdirSync(pasta, { recursive: true });
(async () => {
  let modelo = process.argv[2];
  if (!modelo) {
    const modelos = await (await fetch('https://api.elevenlabs.io/v1/models', { headers: { 'xi-api-key': chave } })).json();
    const ids = modelos.filter((m) => m.can_do_text_to_speech !== false).map((m) => m.model_id);
    modelo = ids.find((m) => /eleven_v4/.test(m)) || ids.find((m) => /eleven_v3/.test(m)) || 'eleven_multilingual_v2';
    console.log('modelos:', ids.join(', '), '→ usando', modelo);
  }
  for (const f of JSON.parse(fs.readFileSync(path.join(__dirname, 'narracao.json'), 'utf8'))) {
    const destino = path.join(pasta, f.id + '.mp3');
    if (fs.existsSync(destino)) continue;
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOZ}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: f.texto, model_id: modelo, language_code: 'pt' }),
    });
    if (!r.ok) { console.error(f.id, r.status, await r.text()); process.exit(1); }
    fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
    console.log('ok', f.id);
  }
})();
