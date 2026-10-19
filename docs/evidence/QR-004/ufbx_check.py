import sys, json, numpy as np, ufbx
path, mode = sys.argv[1], sys.argv[2]
axes = {"rh_zup": ufbx.axes_right_handed_z_up, "lh_zup": ufbx.axes_left_handed_z_up}[mode]
sc = ufbx.load_file(path, target_axes=axes, target_unit_meters=0.01)
out = {"unit_meters": sc.settings.unit_meters, "meshes": {}}
for node in sc.nodes:
    if node.mesh is None:
        continue
    w = node.geometry_to_world
    M = np.array([[c.x, c.y, c.z] for c in (w.c0, w.c1, w.c2, w.c3)]).T   # 3x4
    pos = np.array([[p.x, p.y, p.z] for p in node.mesh.vertex_position.values])
    world = pos @ M[:, :3].T + M[:, 3]
    out["meshes"][node.name] = {"tris": node.mesh.num_triangles, "uv_sets": len(node.mesh.uv_sets),
                                "min": world.min(0).round(3).tolist(), "max": world.max(0).round(3).tolist()}
print(json.dumps(out))
sys.stdout.flush()
