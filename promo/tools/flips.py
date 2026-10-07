"""Моменты переворота цифр часов в клипах (для щелчков в звуке): python3 flips.py <public/frames> <клип>… → JSON {клип: [сек]}"""
import sys, os, json
import numpy as np
from PIL import Image

root, clips = sys.argv[1], sys.argv[2:]
out = {}
for c in clips:
    d = os.path.join(root, c)
    files = sorted(os.listdir(d))
    prev, diffs = None, []
    for f in files:
        im = np.asarray(Image.open(os.path.join(d, f)).convert('L').crop((60, 600, 1120, 1400)).resize((265, 200)), dtype=np.float32)
        diffs.append(0.0 if prev is None else float(np.mean(np.abs(im - prev))))
        prev = im
    diffs = np.array(diffs)
    thr = max(0.6, np.percentile(diffs, 60) * 3)
    on = [i for i in range(1, len(diffs)) if diffs[i] > thr and diffs[i - 1] <= thr]
    out[c] = [round(i / 30, 3) for i in on]
print(json.dumps(out))
