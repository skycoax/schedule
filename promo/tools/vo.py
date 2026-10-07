"""Озвучка ролика: Kokoro-82M (Apache-2.0), женский голос af_heart.
python -I vo.py <script.json> <out_dir> [voice] [speed]
script.json: [{"id": "s01", "text": "..."}]; в тексте [Para](/pˈɑɹə/) — произношение.
"""
import json, sys, os
import numpy as np, soundfile as sf
from kokoro import KPipeline

script, out = sys.argv[1], sys.argv[2]
voice = sys.argv[3] if len(sys.argv) > 3 else 'af_heart'
speed = float(sys.argv[4]) if len(sys.argv) > 4 else 0.92
os.makedirs(out, exist_ok=True)
pipe = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M')
meta = {}
for line in json.load(open(script, encoding='utf-8')):
    parts = [a for _, _, a in pipe(line['text'], voice=voice, speed=speed, split_pattern=r'\n+')]
    pause = np.zeros(int(24000 * 0.35), dtype=np.float32)
    chunks = []
    for i, a in enumerate(parts):
        chunks.append(np.asarray(a, dtype=np.float32))
        if i < len(parts) - 1: chunks.append(pause)
    audio = np.concatenate(chunks)
    path = os.path.join(out, f"{line['id']}.wav")
    sf.write(path, audio, 24000)
    meta[line['id']] = round(len(audio) / 24000, 3)
    print(line['id'], meta[line['id']], flush=True)
json.dump(meta, open(os.path.join(out, 'durations.json'), 'w'), indent=1)
