#!/usr/bin/env python3
"""Empaqueter le GLB quantifié et copier son rendu Blender, sans modifier l’image."""
import argparse
import gzip
import hashlib
import json
import shutil
from pathlib import Path
parser = argparse.ArgumentParser()
parser.add_argument('--input', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--version', choices=['v2', 'v4'], default='v2')
parser.add_argument('--without-poster', action='store_true')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
model = args.input / 'swiss-atlas-quantized.glb'
assert model.read_bytes()[:4] == b'glTF'
# .bin évite qu’un serveur interprète .gz comme une compression de transport.
target = args.output / f'swiss-atlas-{args.version}.bin'
target.write_bytes(gzip.compress(model.read_bytes(), compresslevel=9, mtime=0))
if not args.without_poster:
    shutil.copyfile(args.input / 'swiss-atlas-front.png', args.output / f'swiss-atlas-{args.version}.png')
print(json.dumps({'octets':target.stat().st_size, 'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}))
