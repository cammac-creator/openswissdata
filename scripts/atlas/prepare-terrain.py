#!/usr/bin/env python3
"""Lit le bronze swisstopo, écrit l'argent géométrique. Aucun téléchargement implicite.

Usage : python prepare-terrain.py --data DOSSIER_PRIVE --output DOSSIER_ARGENT
Dépendances de préparation seulement : numpy, scipy, shapely, pyproj, rasterio, triangle.
Les archives originales restent inchangées. La géométrie n'est pas un produit de mesure.
"""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path
import numpy as np
import rasterio
from rasterio.enums import Resampling
from scipy.ndimage import map_coordinates
import shapely
from shapely.ops import transform
from pyproj import Transformer
import triangle

parser = argparse.ArgumentParser()
parser.add_argument('--data', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
gpkg = next((args.data / 'argent/frontieres').rglob('*.gpkg'))
with sqlite3.connect(f'file:{gpkg}?mode=ro', uri=True) as con:
    blob = con.execute("SELECT geom FROM tlm_landesgebiet WHERE icc='CH'").fetchone()[0]
envelope = (blob[3] >> 1) & 7
offset = 8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[envelope]
country95 = shapely.from_wkb(blob[offset:])
project = Transformer.from_crs(2056, 21781, always_xy=True)
country = transform(project.transform, country95)
# Généralisation du contour de 100 m, avec conservation de sa topologie.
country = country.simplify(100, preserve_topology=True)
parts = list(country.geoms) if country.geom_type == 'MultiPolygon' else [country]
country = max(parts, key=lambda p: p.area)
print('Contour suisse projeté et simplifié.', flush=True)
vertices, segments, holes = [], [], []
for ring in [country.exterior, *country.interiors]:
    coords = np.asarray(shapely.segmentize(ring, 350).coords)[:-1, :2]
    start = len(vertices)
    vertices.extend(coords.tolist())
    segments.extend([[start + i, start + (i + 1) % len(coords)] for i in range(len(coords))])
for ring in country.interiors:
    point = shapely.Polygon(ring).representative_point()
    holes.append([point.x, point.y])
bounds = country.bounds
step = 350
xs = np.arange(np.ceil(bounds[0] / step) * step, bounds[2], step)
ys = np.arange(np.ceil(bounds[1] / step) * step, bounds[3], step)
xx, yy = np.meshgrid(xs, ys)
interior = country.buffer(-60)
shapely.prepare(interior)
inside = shapely.contains_xy(interior, xx.ravel(), yy.ravel())
vertices.extend(np.column_stack([xx.ravel()[inside], yy.ravel()[inside]]).tolist())
source = {'vertices': np.asarray(vertices), 'segments': np.asarray(segments)}
if holes: source['holes'] = np.asarray(holes)
mesh = triangle.triangulate(source, 'pQ')
print('Triangulation du relief terminée.', flush=True)
xy = mesh['vertices']
faces = mesh['triangles']
# Le MNT 25 m est filtré à 175 m avant échantillonnage des sommets à environ 350 m.
asc = args.data / 'argent/mnt/ASCII_GRID_1part/dhm25_grid_raster.asc'
with rasterio.open(asc) as dem:
    print('Lecture filtrée du modèle altimétrique.', flush=True)
    grid = dem.read(1, out_shape=(int(np.ceil(dem.height / 7)), int(np.ceil(dem.width / 7))), resampling=Resampling.bilinear)
    affine = dem.transform * dem.transform.scale(dem.width / grid.shape[1], dem.height / grid.shape[0])
    inv = ~affine
    col, row = inv * (xy[:, 0], xy[:, 1])
    elevations = map_coordinates(grid, [row - .5, col - .5], order=1, mode='nearest')
assert np.isfinite(elevations).all() and elevations.min() > 100 and elevations.max() < 4800, (elevations.min(), elevations.max())
assert len(faces) > 500000 and len(faces) < 900000
edges = mesh['segments']
origin = np.array([(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2])
scale = 10 / (bounds[2] - bounds[0])
xyz = np.column_stack([(xy - origin) * scale, .14 + elevations * scale * 8])
np.savez_compressed(args.output / 'terrain.npz', vertices=xyz.astype(np.float32), faces=faces.astype(np.int32), edges=edges.astype(np.int32), xy=xy, elevations=elevations)
outline = {'vertices': np.asarray(source['vertices'][:len(segments)])[:, :2], 'segments': np.asarray(segments)}
if holes: outline['holes'] = np.asarray(holes)
cap = triangle.triangulate(outline, 'pQ')
np.savez_compressed(args.output / 'contour.npz', vertices=(cap['vertices'] - origin) * scale, faces=cap['triangles'], edges=cap['segments'])
report = {
    'sourceAltitude': 'MNT25 / DHM25 swisstopo, archive distribuée en 2021, source historique',
    'sourceContour': 'swissBOUNDARIES3D 2026-01, Suisse (icc=CH)',
    'attribution': '©swisstopo', 'mailleOriginaleMetres': 25, 'filtrageMetres': 175,
    'mailleGeometrieMetres': step, 'simplificationContourMetres': 100,
    'amplificationVerticale': 8, 'sommets': len(xyz), 'triangles': len(faces),
    'altitudeEchantillonneeMin': float(elevations.min()), 'altitudeEchantillonneeMax': float(elevations.max()),
    'projectionTravail': 'CH1903 / LV03 (EPSG:21781)',
    'surfaceContourKm2': country.area / 1e6, 'licence': 'https://www.swisstopo.admin.ch/fr/conditions-utilisation-geodonnees-et-geoservices-gratuit',
    'archives': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (args.data / 'bronze/2026-09-28').glob('*.zip')},
}
(args.output / 'geometrie.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
