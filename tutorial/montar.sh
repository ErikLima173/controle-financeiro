#!/bin/bash
# Junta o vídeo gravado (saida/tutorial.webm) com as falas (falas/*.mp3) nos momentos de saida/marcas.json.
set -e
cd "$(dirname "$0")"
python3 - <<'PY'
import json, subprocess
marcas = json.load(open('saida/marcas.json'))
cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-i', 'saida/tutorial.webm']
filtros = []
for i, m in enumerate(marcas):
    cmd += ['-i', f"falas/{m['id']}.mp3"]
    ms = int(m['inicio'] * 1000)
    filtros.append(f"[{i+1}:a]adelay={ms}|{ms},volume=1.0[a{i}]")
filtros.append(''.join(f'[a{i}]' for i in range(len(marcas))) + f"amix=inputs={len(marcas)}:normalize=0[voz]")
cmd += ['-filter_complex', ';'.join(filtros), '-map', '0:v', '-map', '[voz]',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '30',
        '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-shortest', 'saida/tutorial-livro-caixa.mp4']
subprocess.run(cmd, check=True)
print('pronto: tutorial/saida/tutorial-livro-caixa.mp4')
PY
