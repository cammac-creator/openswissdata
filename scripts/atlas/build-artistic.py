"""Argent sculptural → or web GLB et scène Blender, sans ressource distante.

L'occlusion calculée dans Blender est conservée dans les couleurs du volume.
Les ombres d'orientation et les reflets restent calculés pendant la rotation web.
"""
import argparse
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
parser.add_argument('--samples', type=int, default=32)
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
args.output.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for device in prefs.devices: device.use = device.type == 'METAL'
    if any(device.type == 'METAL' for device in prefs.devices): scene.cycles.device = 'GPU'
except (TypeError, RuntimeError):
    print('Calcul Cycles sur le processeur.', flush=True)

def linear(rgb):
    rgb = np.asarray(rgb, dtype=np.float32)
    return np.where(rgb <= .04045, rgb/12.92, ((rgb+.055)/1.055)**2.4)

def material(name, color, roughness, metal=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*linear(color), 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = mat.diffuse_color
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metal
    return mat

def mesh_object(name, vertices, faces, mat, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    for face in data.polygons: face.use_smooth = smooth
    return obj

ivory = material('Ivoire sculpté', [.92, .87, .77], .76)
forest = material('Laque vert forêt', [.065, .255, .195], .34, .05)
red = material('Filet vermillon satiné', [.80, .17, .105], .3, .04)
stamp_mat = material('Frappe patinée', [.43, .58, .48], .34, .3)
data = np.load(args.geometry/'sculpture.npz')
xyz, faces, edges = data['vertices'], data['faces'], data['edges']
terrain_mat = material('Pigments ivoire et émeraude', [1, 1, 1], .72)
terrain = mesh_object('Massifs sculptés et vallées émeraude', xyz.tolist(), faces.tolist(), terrain_mat)
terrain['strates'] = True
col = terrain.data.color_attributes.new(name='Pigments', type='FLOAT_COLOR', domain='CORNER')
terrain.data.color_attributes.active_color = col
loop_vertices = np.empty(len(terrain.data.loops), dtype=np.int32)
terrain.data.loops.foreach_get('vertex_index', loop_vertices)
original = np.ones((len(loop_vertices), 4), dtype=np.float32)
original[:, :3] = linear(data['colors'])[loop_vertices]
col.data.foreach_set('color', original.ravel())
node = terrain_mat.node_tree.nodes.new('ShaderNodeVertexColor')
node.layer_name = 'Pigments'
terrain_mat.node_tree.links.new(node.outputs['Color'], terrain_mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])

# Chant vertical orienté vers l'extérieur : aucune alternance de normales inversées.
wall_vertices, wall_faces = [], []
for a, b in edges:
    i = len(wall_vertices)
    va, vb = xyz[a], xyz[b]
    wall_vertices.extend([va.tolist(), [float(va[0]), float(va[1]), .105], [float(vb[0]), float(vb[1]), .105], vb.tolist()])
    wall_faces.append([i, i+1, i+2, i+3])
walls = mesh_object('Chant ivoire adouci', wall_vertices, wall_faces, ivory)
bm = bmesh.new(); bm.from_mesh(walls.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=.000001)
bm.to_mesh(walls.data); bm.free()

outline = np.load(args.geometry/'contour.npz')
xy, caps, border = outline['vertices'], outline['faces'], outline['edges']
def slab(name, lower, upper, mat, bevel):
    count = len(xy)
    vertices = [[float(x), float(y), z] for z in (lower, upper) for x, y in xy]
    polygons = [list(reversed(f)) for f in caps.tolist()] + [[i+count for i in f] for f in caps.tolist()]
    polygons += [[int(a), int(b), int(b)+count, int(a)+count] for a, b in border]
    obj = mesh_object(name, vertices, polygons, mat)
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data); bm.free()
    for face in obj.data.polygons: face.use_smooth = abs(face.normal.z) < .5
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new('Arêtes polies', 'BEVEL')
    modifier.width = bevel
    modifier.segments = 3
    modifier.limit_method = 'ANGLE'
    modifier.angle_limit = .7
    modifier.harden_normals = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    weighted = obj.modifiers.new('Reflets continus sur les chants', 'WEIGHTED_NORMAL')
    weighted.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=weighted.name)
    return obj
base = slab('Socle vert profond et revers', -.48, .064, forest, .028)
stripe = slab('Liseré rouge', .064, .107, red, .009)
base['inscription'] = 'Made in Switzerland'

curve = bpy.data.curves.new('Matrice de frappe', type='FONT')
curve.body = 'Made in Switzerland'; curve.align_x = 'CENTER'; curve.align_y = 'CENTER'
curve.size = .59; curve.space_character = 1.08; curve.extrude = .018
curve.bevel_depth = .006; curve.bevel_resolution = 3
stamp = bpy.data.objects.new('Made in Switzerland', curve)
bpy.context.collection.objects.link(stamp)
stamp.location = (0, .05, -.481); stamp.rotation_euler = (math.pi, 0, 0)
stamp.data.materials.append(stamp_mat)
bpy.ops.object.select_all(action='DESELECT'); stamp.select_set(True)
bpy.context.view_layer.objects.active = stamp; bpy.ops.object.convert(target='MESH'); stamp = bpy.context.object
for face in stamp.data.polygons: face.use_smooth = True

# Calculer une seule fois les ombres des creux et les conserver dans le modèle, tous angles confondus.
bpy.ops.object.select_all(action='DESELECT'); terrain.select_set(True)
bpy.context.view_layer.objects.active = terrain
scene.render.bake.target = 'VERTEX_COLORS'
bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
baked = np.empty_like(original); col.data.foreach_get('color', baked.ravel())
# Moyenne par sommet : pas de bruit entre triangles partageant un même point.
counts = np.bincount(loop_vertices, minlength=len(xyz))
sums = np.bincount(loop_vertices, weights=baked[:, :3].mean(axis=1), minlength=len(xyz))
ao = np.clip(sums/np.maximum(counts, 1), .16, 1)**.68
original[:, :3] *= ao[loop_vertices, None]
col.data.foreach_set('color', original.ravel())
print('Occlusion :', float(ao.min()), float(ao.mean()), flush=True)
objects = [terrain, walls, base, stripe, stamp]
for obj in objects: obj['creation'] = 'Sculpture artistique à partir de MNT25/swissBOUNDARIES3D — ©swisstopo'
bpy.ops.object.select_all(action='DESELECT')
for obj in objects: obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(args.output/'swiss-atlas.glb'), export_format='GLB', use_selection=True, export_extras=True, export_cameras=False, export_lights=False, export_texcoords=False)

# Le studio sert à comparer la géométrie, sans texture photographique plaquée sur le volume.
world = scene.world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.75, .8, .85, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .24

def area(name, location, energy, size, color):
    light = bpy.data.lights.new(name, 'AREA'); light.energy = energy; light.shape = 'DISK'; light.size = size; light.color = color
    obj = bpy.data.objects.new(name, light); bpy.context.collection.objects.link(obj); obj.location = location
    obj.rotation_euler = (Vector((0, 0, .5))-obj.location).to_track_quat('-Z', 'Y').to_euler()
area('Lumière chaude de côté', (-5, -5, 7), 1600, 4, (1, .91, .75))
area('Lumière de contour', (4, 5, 6), 1000, 4, (.9, .96, 1))
area('Remplissage doux', (3, -6, 5), 200, 6, (1, .97, .9))
area('Lecture du revers', (-4, -2, -7), 850, 5, (1, .95, .84))
paper = material('Papier de studio', [.958, .953, .928], .9)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.55)); floor = bpy.context.object; floor.data.materials.append(paper)
camera_data = bpy.data.cameras.new('Caméra'); camera = bpy.data.objects.new('Caméra', camera_data); bpy.context.collection.objects.link(camera); scene.camera = camera
camera_data.type = 'ORTHO'; camera_data.ortho_scale = 11.6
camera.location = (-2.6, -8.7, 11); camera.rotation_euler = (Vector((0, 0, .65))-camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.resolution_x = 1500; scene.render.resolution_y = 1250; scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'; scene.view_settings.view_transform = 'AgX'
bpy.ops.wm.save_as_mainfile(filepath=str(args.output/'swiss-atlas.blend'))
scene.render.filepath = str(args.output/'swiss-atlas-front.png'); bpy.ops.render.render(write_still=True)
report = {'objets': [{'nom':o.name, 'sommets':len(o.data.vertices), 'faces':len(o.data.polygons)} for o in objects], 'occlusionMoyenne':float(ao.mean()), 'blender':bpy.app.version_string, 'inscription':'Made in Switzerland'}
(args.output/'scene.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(report, ensure_ascii=False), flush=True)
