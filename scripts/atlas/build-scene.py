"""Blender : argent géométrique → scène, modèle web et affiches de repli.

blender --background --python build-scene.py -- --geometry DOSSIER --output DOSSIER
Le relief est mesuré puis amplifié ×8. Les matériaux et le socle sont artistiques.
"""
import argparse
import colorsys
import json
import math
import sys
from pathlib import Path
import bpy
import bmesh
import numpy as np
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--geometry', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--stamp', default='Made in Switzerland')
parser.add_argument('--samples', type=int, default=48)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
args.output.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def linear(v):
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4

def material(name, hex_color, saturation=1, roughness=.6, metal=0):
    rgb = tuple(int(hex_color[i:i+2], 16) / 255 for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(*rgb)
    rgb = colorsys.hls_to_rgb(h, l, min(1, s * saturation))
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*[linear(v) for v in rgb], 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = mat.diffuse_color
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metal
    return mat

ivory = material('Ivoire sculpté', 'E9E0CB', roughness=.79)
green = material('Vert forêt — saturation +20 %', '315F4B', saturation=1.2, roughness=.4)
stamp_material = material('Frappe satinée', '6D8D7C', saturation=1.2, roughness=.35, metal=.2)
red = material('Vermillon — saturation +20 %', 'C43E2D', saturation=1.2, roughness=.32)

def make_mesh(name, vertices, faces, mat, smooth=False):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons: poly.use_smooth = smooth
    return obj

data = np.load(args.geometry / 'terrain.npz')
xyz, triangles, edges = data['vertices'], data['faces'], data['edges']
terrain = make_mesh('Relief MNT25 ×8', xyz.tolist(), triangles.tolist(), ivory, True)
bpy.context.view_layer.objects.active = terrain
modifier = terrain.modifiers.new('Maillage web conservant les arêtes du relief', 'DECIMATE')
modifier.ratio = .30
bpy.ops.object.modifier_apply(modifier=modifier.name)

# Le chant suit les altitudes du bord jusqu'au socle horizontal.
wall_vertices, wall_faces = [], []
for a, b in edges:
    i = len(wall_vertices)
    va, vb = xyz[a], xyz[b]
    wall_vertices.extend([va.tolist(), vb.tolist(), [float(vb[0]), float(vb[1]), .06], [float(va[0]), float(va[1]), .06]])
    wall_faces.append([i, i+1, i+2, i+3])
walls = make_mesh('Chant ivoire', wall_vertices, wall_faces, ivory)
bm = bmesh.new()
bm.from_mesh(walls.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.000001)
bm.to_mesh(walls.data)
bm.free()
for poly in walls.data.polygons: poly.use_smooth = True

outline = np.load(args.geometry / 'contour.npz')
xy, caps, border = outline['vertices'], outline['faces'], outline['edges']

def slab(name, lower, upper, mat):
    count = len(xy)
    verts = [[float(x), float(y), z] for z in (lower, upper) for x, y in xy]
    faces = [list(reversed(f)) for f in caps.tolist()] + [[v + count for v in f] for f in caps.tolist()]
    faces += [[int(a), int(b), int(b) + count, int(a) + count] for a, b in border]
    return make_mesh(name, verts, faces, mat)

base = slab('Socle vert et revers frappé', -.35, .016, green)
stripe = slab('Liseré rouge', .016, .06, red)
bm = bmesh.new()
bm.from_mesh(base.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.000001)
bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=0.0000001)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
print('Socle avant gravure :', len(bm.verts), 'sommets ;', sum(not e.is_manifold for e in bm.edges), 'arêtes non fermées ; volume', bm.calc_volume(signed=True), flush=True)
bm.to_mesh(base.data)
bm.free()

# Marquage en léger relief, de la même matière que le socle, façon frappe industrielle.
# Chaque lettre est un vrai volume ; sa base pénètre le socle sans opération booléenne fragile.
curve = bpy.data.curves.new('Matrice de frappe', type='FONT')
curve.body = args.stamp
curve.align_x = 'CENTER'
curve.align_y = 'CENTER'
curve.size = .60
curve.space_character = 1.08
curve.offset = .003
curve.extrude = .023
curve.bevel_depth = .009
curve.bevel_resolution = 2
stamp = bpy.data.objects.new('Made in Switzerland — marquage frappé', curve)
bpy.context.collection.objects.link(stamp)
stamp.location = (0, .05, -.350)
stamp.rotation_euler = (math.pi, 0, 0)
stamp.data.materials.append(stamp_material)
bpy.ops.object.select_all(action='DESELECT')
stamp.select_set(True)
bpy.context.view_layer.objects.active = stamp
bpy.ops.object.convert(target='MESH')
stamp = bpy.context.object
for poly in stamp.data.polygons: poly.use_smooth = True
for obj in (base, stripe):
    for poly in obj.data.polygons: poly.use_smooth = abs(poly.normal.z) < .5

objects = [terrain, walls, base, stripe, stamp]
for obj in objects: obj['creation'] = 'OpenSwissData — relief stylisé, ©swisstopo, altitudes ×8'
base['inscription'] = args.stamp
bpy.ops.object.select_all(action='DESELECT')
for obj in objects: obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(args.output / 'swiss-atlas.glb'), export_format='GLB', use_selection=True, export_extras=True, export_cameras=False, export_lights=False, export_texcoords=False)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
try:
    preferences = bpy.context.preferences.addons['cycles'].preferences
    preferences.compute_device_type = 'METAL'
    preferences.get_devices()
    devices = [device for device in preferences.devices if device.type == 'METAL']
    if devices:
        for device in preferences.devices: device.use = device.type == 'METAL'
        scene.cycles.device = 'GPU'
except (TypeError, RuntimeError):
    print('Cycles utilisera le processeur pour cette machine.', flush=True)
scene.render.resolution_x = 1400
scene.render.resolution_y = 1400
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = True
scene.view_settings.view_transform = 'AgX'
scene.world.color = (.45, .45, .45)
world = scene.world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.72, .75, .72, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .22

def area(name, location, energy, size, color):
    light_data = bpy.data.lights.new(name, 'AREA')
    light_data.energy, light_data.shape, light_data.size, light_data.color = energy, 'DISK', size, color
    light = bpy.data.objects.new(name, light_data)
    bpy.context.collection.objects.link(light)
    light.location = location
    light.rotation_euler = (Vector((0, 0, 0)) - light.location).to_track_quat('-Z', 'Y').to_euler()

area('Lumière principale', (-5, -6, 6), 1450, 4, (1, .94, .84))
area('Reflet doux', (5, 5, 8), 650, 5, (.9, .96, 1))
area('Remplissage face', (1, -8, 3), 250, 6, (1, 1, 1))
area('Lecture du revers', (-2, -4, -8), 1000, 5, (1, .95, .86))
camera_data = bpy.data.cameras.new('Caméra')
camera = bpy.data.objects.new('Caméra', camera_data)
bpy.context.collection.objects.link(camera)
scene.camera = camera
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 12.5
camera.location = (-3.8, -7, 11)
camera.rotation_euler = (Vector((0, 0, .25)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = str(args.output / 'swiss-atlas-front.png')
bpy.ops.wm.save_as_mainfile(filepath=str(args.output / 'swiss-atlas.blend'))
bpy.ops.render.render(write_still=True)
camera.location = (1.5, -2, -12)
camera.rotation_euler = (Vector((0, 0, 0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = str(args.output / 'swiss-atlas-back.png')
bpy.ops.render.render(write_still=True)
report = {'objets': [{'nom':o.name, 'sommets':len(o.data.vertices), 'polygones':len(o.data.polygons)} for o in objects], 'inscription':args.stamp, 'amplificationVerticale':8, 'saturationVertRouge':1.2, 'blender':bpy.app.version_string}
(args.output / 'scene.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False), flush=True)
