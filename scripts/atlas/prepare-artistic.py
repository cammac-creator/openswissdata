#!/usr/bin/env python3
"""Argent MNT25/contour → argent de la sculpture, sans téléchargement ni écriture source.

La topographie guide les masses ; lissage, amplification et bord adouci sont artistiques.
Dépendances : numpy, scipy, shapely, triangle. Les archives d'origine restent intactes.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from scipy.interpolate import NearestNDInterpolator, RegularGridInterpolator
from scipy.ndimage import gaussian_filter
import shapely
from shapely.geometry import LineString
from shapely.geometry.polygon import orient
from shapely.ops import polygonize
import triangle

parser = argparse.ArgumentParser()
parser.add_argument('--geometry', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--amplification', type=float, default=16)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
source = np.load(args.geometry / 'terrain.npz')
contour = np.load(args.geometry / 'contour.npz')
country = max(polygonize([LineString(contour['vertices'][edge]) for edge in contour['edges']]), key=lambda p: p.area)
# Le contour conserve sa silhouette, avec des petites aspérités arrondies à l'échelle de l'objet.
country = orient(country.buffer(.035, quad_segs=5).buffer(-.035, quad_segs=5).simplify(.010), sign=1)
points, segments, holes = [], [], []
for ring in [country.exterior, *country.interiors]:
    xy = np.asarray(shapely.segmentize(ring, .035).coords)[:-1, :2]
    start = len(points)
    points.extend(xy.tolist())
    segments.extend([[start+i, start+(i+1) % len(xy)] for i in range(len(xy))])
for ring in country.interiors:
    point = shapely.Polygon(ring).representative_point()
    holes.append([point.x, point.y])
outline = {'vertices': np.asarray(points), 'segments': np.asarray(segments)}
if holes: outline['holes'] = np.asarray(holes)
cap = triangle.triangulate(outline, 'pQ')
np.savez_compressed(args.output / 'contour.npz', vertices=cap['vertices'], faces=cap['triangles'], edges=cap['segments'])

step = .0175
xs = np.arange(-5.04, 5.05, step)
ys = np.arange(-3.21, 3.22, step)
xx, yy = np.meshgrid(xs, ys)
inside = shapely.contains_xy(country.buffer(-.004), xx.ravel(), yy.ravel())
points.extend(np.column_stack([xx.ravel()[inside], yy.ravel()[inside]]).tolist())
mesh_source = {'vertices': np.asarray(points), 'segments': np.asarray(segments)}
if holes: mesh_source['holes'] = np.asarray(holes)
mesh = triangle.triangulate(mesh_source, 'pQ')
xy = mesh['vertices']
field = NearestNDInterpolator(source['vertices'][:, :2], source['elevations'])(xx, yy)
# Les sommets voisins forment des massifs lisibles ; le grain altimétrique fin ne domine plus.
detail = gaussian_filter(field, .7)
field = gaussian_filter(field, 2.8)*.82 + detail*.18
broad = gaussian_filter(field, 10)
elevation = RegularGridInterpolator((ys, xs), field, bounds_error=False, fill_value=None)(xy[:, ::-1])
basin = RegularGridInterpolator((ys, xs), broad-field, bounds_error=False, fill_value=None)(xy[:, ::-1])
distance = shapely.distance(shapely.points(xy), country.boundary)

def smoothstep(low, high, values):
    t = np.clip((values-low)/(high-low), 0, 1)
    return t*t*(3-2*t)

scale = (source['vertices'][:, 2].max()-.14)/(source['elevations'].max()*8)
taper = smoothstep(0, .36, distance)
height = .23 + np.maximum(0, elevation-330)*scale*args.amplification*(.12+.88*taper)
# Un bord constant remplace les grandes falaises de découpe de l'ancien volume.
height = .23 + (height-.23)*smoothstep(0, .065, distance)
vertices = np.column_stack([xy, height])
faces = mesh['triangles']
# Chaque triangle supérieur regarde vers le ciel, indépendamment de la triangulation.
d = xy[faces]
ab, ac = d[:, 1]-d[:, 0], d[:, 2]-d[:, 0]
reverse = ab[:, 0]*ac[:, 1]-ab[:, 1]*ac[:, 0] < 0
faces[reverse] = faces[reverse][:, ::-1]

valleys = smoothstep(55, 220, basin) * (1-smoothstep(1350, 2350, elevation))
low = (1-smoothstep(470, 850, elevation)) * .12
edge = (1-smoothstep(.045, .20, distance)) * .22
pigment = np.clip(np.maximum(valleys, low)+edge*.45, 0, .94)
ivory = np.array([.91, .855, .745])
emerald = np.array([.10, .34, .255])
colors = ivory[None, :]*(1-pigment[:, None])+emerald[None, :]*pigment[:, None]
# Une variation de matière très fine suit les strates, sans code géologique.
phase = np.mod(height/.066, 1)
line = np.exp(-((phase-.18)/.115)**2)
colors *= (1-.075*line[:, None])
np.savez_compressed(args.output / 'sculpture.npz', vertices=vertices.astype(np.float32), faces=faces.astype(np.int32), edges=mesh['segments'].astype(np.int32), colors=colors.astype(np.float32), pigment=pigment.astype(np.float32))
report = {'source': 'MNT25 et swissBOUNDARIES3D 2026 ©swisstopo', 'amplificationAvantAdoucissement': args.amplification, 'sommets': len(vertices), 'triangles': len(faces), 'hauteurMax': float(height.max()), 'traitement': 'Contour arrondi, relief lissé et amplifié, bord progressivement abaissé, strates fines et vallées colorées', 'couleurs': 'Décoratives, sans signification géologique', 'usage': 'Sculpture de présentation, impropre à la mesure'}
(args.output / 'sculpture.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(report, ensure_ascii=False), flush=True)
