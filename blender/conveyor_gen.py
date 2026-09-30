"""
EV 모형 생산 라인 — 컨베이어 스테이션 에셋 생성 (Blender 4.2+)

사용법
  1) Blender > Scripting 탭 > 이 파일 열기 > Run Script
  2) 또는 명령줄:  blender -b -P conveyor_gen.py

결과
  OUT_DIR/ev_line_conveyor.blend
  OUT_DIR/ev_line_conveyor.glb   (three.js에서 GLTFLoader로 불러옴)

좌표 (Blender 기준, 단위 m)
  +X = 제품 흐름 방향 (ST1 -> ST2 -> ST3)
  +Y = 로봇 쪽(뒤),  -Y = 관람자 쪽(앞)
  +Z = 위,  원점 = 라인 중앙 바닥
  glTF로 내보내면 Y-up으로 바뀜: Blender Z -> three Y, Blender Y -> three -Z

이름 규칙 (three.js에서 getObjectByName으로 찾는 이름)
  Conveyor_Belt            벨트 (UV 스크롤로 흐름 표현)
  Drum_Head / Drum_Tail    양 끝 드럼 (기준점 = 회전축 중심)
  Roller_01 ~ Roller_NN    하부 리턴 롤러 (기준점 = 회전축 중심)
  Pallet_01 ~ Pallet_03    팔레트 (기준점 = 바닥 중심)
  Robot_Mount_ST1~3        Indy7을 붙일 빈 오브젝트 (받침대 윗면 중심)
  Status_Ring_ST1~3        스테이션 상태 링 (재질 개별)
  Sensor_ST1~3_LED         팔레트 도착 센서 표시등
  Camera_ST2/ST3_Light     카메라 링 조명
  Sensor_CV2_LED, Sensor_CV5_LED  버퍼·회수 구간 도착 센서 표시등
  Zone_CV1 ~ Zone_CV5      구간 경계 빈 오브젝트 (extras: cv, role, x_start, x_end)
  Tray_Pass / Tray_Fail    합격/불합격 트레이 (ST3 받침대 양옆). 전차 자리 = Tray_*_Slot_01~03
  Storage                  보관창고 고정부 (기둥, 서보 모터)
  Storage_Rack             서보로 상하 이동하는 3단 선반. 기준점 = 1칸 윗면 중심, 기본 = 1칸이 벨트 높이
  Storage_Slot_01 ~ 03     선반의 칸 (Storage_Rack 자식, extras.level). k칸을 벨트에 맞추려면
                           Storage_Rack 높이를 -(k-1)×storage_pitch 만큼 내린다
  EV_Line extras           zone_x, storage_slots, storage_pitch, storage_stroke, storage_x
"""
import bpy
import bmesh
import math
import os
import numpy as np
from mathutils import Vector, Matrix

# ─────────────────────────────── 파라미터 ───────────────────────────────
P = dict(
    length=3.8,            # 드럼 중심 간 거리
    belt_w=0.24,           # 벨트 폭
    belt_top=0.80,         # 벨트 윗면 높이
    belt_t=0.003,          # 벨트 두께
    drum_r=0.032,          # 드럼 반지름
    rail_w=0.04,           # 사이드 레일 프로파일 폭 (40x80)
    rail_h=0.08,
    rail_gap=0.0055,       # 벨트 가장자리 ~ 레일 안쪽 면
    rail_above=0.012,      # 레일 윗면이 벨트보다 높은 양
    guide_w=0.010,         # 팔레트 가이드 (UHMW)
    guide_h=0.014,
    guide_overhang=0.008,  # 가이드가 레일 안쪽으로 튀어나온 양
    leg=0.04,              # 다리 프로파일 40x40
    leg_x=[-1.78, -0.55, 0.55, 1.78],
    brace_z=0.14,          # 하부 보강재 높이
    station_x=[-1.1, 0.0, 1.1],
    robot_y=0.48,          # 로봇 받침대 중심 (컨베이어 중심에서 뒤로)
    pedestal=0.22,
    pedestal_top=0.72,     # Indy7 설치면 높이
    pallet=(0.28, 0.22, 0.022),
    return_r=0.015,        # 리턴 롤러 반지름
    return_pitch=0.38,
    belt_tile=0.25,        # 벨트 텍스처 반복 길이 (근사값, 이음매 없게 자동 보정)
    # 컨베이어 5구간 경계 x (CV1 ST1 | CV2 버퍼 | CV3 ST2 | CV4 ST3 | CV5 회수). 벨트는 하나, 구간은 논리 분할
    zone_x=[-1.9, -0.825, -0.275, 0.55, 1.4, 1.9],
    zone_sensor_cv=[2, 5],  # 스테이션 외에 도착 센서를 다는 구간 (버퍼, 회수)
    cameras=[2, 3],         # 카메라 스탠드를 세울 스테이션 (라인 PRD P0은 ST3만, 디자인팀 확인 전까지 유지)
    # 합격/불합격 트레이 (ST3 로봇 받침대 양옆)
    tray_dx=0.38,           # ST3 중심에서 트레이 중심까지 x 거리 (불합격 -, 합격 +). ST3 카메라 스탠드와 간섭 없게
    tray=(0.26, 0.60, 0.04),  # 트레이 외곽 L(x), W(y, 전차 자리가 이 방향으로 늘어섬), 벽 높이
    tray_top=0.60,          # 트레이 받침대 윗면 높이
    tray_slots=3,           # 트레이 위 전차 자리 수 (표시용)
    # 보관창고: 헤드 드럼 너머, 서보가 3단 선반 전체를 상하로 움직여 채울 칸을 벨트 높이에 맞춘다
    storage_slots=3,        # 칸 수 (2026-09-30 확정)
    storage_pitch=0.18,     # 칸 간격 (가정: 전차를 얹은 팔레트 높이 + 여유)
    storage_gap=0.09,       # 헤드 드럼과 선반 사이 틈 (레일 끝·기어박스와 간섭 없게)
)

OUT_DIR = os.environ.get(
    "CONVEYOR_OUT",
    os.path.join(os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.path.expanduser("~"), "ev_line_assets"),
)

# 파생 치수
RAIL_IN = P["belt_w"] / 2 + P["rail_gap"]          # 레일 안쪽 면 y
RAIL_CY = RAIL_IN + P["rail_w"] / 2                # 레일 중심 y
RAIL_OUT = RAIL_IN + P["rail_w"]                   # 레일 바깥 면 y
RAIL_TOP = P["belt_top"] + P["rail_above"]
RAIL_BOT = RAIL_TOP - P["rail_h"]
BELT_R = P["drum_r"] + P["belt_t"] / 2             # 벨트 중심선 반지름
DRUM_Z = P["belt_top"] - P["belt_t"] - P["drum_r"]  # 드럼 축 높이
HALF_L = P["length"] / 2
RAIL_LEN = P["length"] + 2 * P["drum_r"] + 0.05


def zone_center(cv):
    """구간 CV{cv}의 가운데 x."""
    return (P["zone_x"][cv - 1] + P["zone_x"][cv]) / 2


# ─────────────────────────────── 재질 ───────────────────────────────
def srgb(v):
    """sRGB(0~1) -> Linear. Blender 재질 입력은 Linear 값."""
    v = np.asarray(v, dtype=float)
    return tuple(np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4))


def make_mat(name, color, metal=0.0, rough=0.5, emit=None, strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(color), 1.0)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit is not None:
        b.inputs["Emission Color"].default_value = (*srgb(emit), 1.0)
        b.inputs["Emission Strength"].default_value = strength
    return m


def belt_texture(size=512):
    """고무 벨트 무늬: 가로 리브 + 미세 노이즈. U = 흐름 방향."""
    rng = np.random.default_rng(7)
    u = np.linspace(0, 1, size, endpoint=False)
    base = np.full((size, size), 0.085)
    ribs = 0.5 + 0.5 * np.cos(u * 2 * np.pi * 10)                    # 타일당 리브 10개
    base += (ribs ** 8)[None, :] * 0.085
    base += rng.normal(0, 0.012, (size, size))
    edge = np.abs(np.linspace(-1, 1, size))[:, None]                  # 벨트 가장자리 살짝 밝게
    base += np.clip((edge - 0.93) * 2.0, 0, 1) * 0.06
    base = np.clip(base, 0, 1)
    rgba = np.ones((size, size, 4), dtype=np.float32)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = base
    img = bpy.data.images.new("T_Belt", size, size, alpha=False)
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def make_belt_mat():
    m = bpy.data.materials.new("M_Belt")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = belt_texture()
    tex.extension = "REPEAT"
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.72
    b.inputs["Metallic"].default_value = 0.0
    return m


MAT = {}


def build_materials():
    MAT["frame"] = make_mat("M_Frame_Anodized", (0.36, 0.37, 0.39), metal=0.55, rough=0.40)
    MAT["paint"] = make_mat("M_Graphite_Paint", (0.44, 0.45, 0.47), metal=0.10, rough=0.50)
    MAT["alu"] = make_mat("M_Aluminum", (0.78, 0.79, 0.80), metal=1.0, rough=0.32)
    MAT["steel"] = make_mat("M_Steel", (0.80, 0.80, 0.80), metal=1.0, rough=0.24)
    MAT["black"] = make_mat("M_Black_Plastic", (0.06, 0.06, 0.065), metal=0.0, rough=0.55)
    MAT["rubber"] = make_mat("M_Rubber", (0.05, 0.05, 0.05), metal=0.0, rough=0.9)
    MAT["guide"] = make_mat("M_Guide_UHMW", (0.92, 0.92, 0.89), metal=0.0, rough=0.45)
    MAT["pallet"] = make_mat("M_Pallet_Alu", (0.74, 0.75, 0.76), metal=0.9, rough=0.36)
    MAT["motor"] = make_mat("M_Motor_Paint", (0.20, 0.25, 0.31), metal=0.3, rough=0.42)
    MAT["reflector"] = make_mat("M_Reflector", (0.75, 0.08, 0.06), metal=0.0, rough=0.3)
    MAT["lens"] = make_mat("M_Lens", (0.02, 0.02, 0.03), metal=0.0, rough=0.05)
    MAT["led_amber"] = make_mat("M_Sensor_LED", (0.3, 0.2, 0.05), emit=(1.0, 0.62, 0.12), strength=3.0)
    MAT["ring_light"] = make_mat("M_Camera_Light", (0.9, 0.9, 0.9), emit=(0.92, 0.96, 1.0), strength=2.0)
    for i in (1, 2, 3):  # 스테이션마다 따로 색을 바꿀 수 있게 재질을 나눔
        MAT[f"status{i}"] = make_mat(f"M_Status_ST{i}", (0.05, 0.3, 0.12), emit=(0.15, 1.0, 0.45), strength=3.0)
    MAT["belt"] = make_belt_mat()


# ─────────────────────────────── 형상 헬퍼 ───────────────────────────────
class Part:
    """bmesh 하나에 여러 형상을 누적하고, 재질 슬롯을 관리."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.bevel = None

    def _slot(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _assign(self, verts, mat):
        idx = self._slot(mat)
        for f in {f for v in verts for f in v.link_faces}:
            f.material_index = idx

    def box(self, size, center, mat):
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        m = Matrix.Translation(Vector(center)) @ Matrix.Diagonal((*size, 1.0))
        bmesh.ops.transform(self.bm, matrix=m, verts=r["verts"])
        self._assign(r["verts"], mat)

    def cyl(self, r, depth, center, mat, axis="Z", segs=32, r2=None):
        res = bmesh.ops.create_cone(
            self.bm, cap_ends=True, cap_tris=False, segments=segs,
            radius1=r, radius2=r if r2 is None else r2, depth=depth)
        rot = {"Z": Matrix(), "X": Matrix.Rotation(math.pi / 2, 4, "Y"),
               "Y": Matrix.Rotation(math.pi / 2, 4, "X")}[axis]
        bmesh.ops.transform(self.bm, matrix=Matrix.Translation(Vector(center)) @ rot, verts=res["verts"])
        self._assign(res["verts"], mat)

    def annulus(self, r_in, r_out, z0, z1, center, mat, segs=96):
        """바닥 링 (얇은 도넛)."""
        bm = self.bm
        cx, cy = center
        rings = []
        for (r, z) in ((r_out, z0), (r_out, z1), (r_in, z1), (r_in, z0)):
            rings.append([bm.verts.new((cx + r * math.cos(2 * math.pi * k / segs),
                                         cy + r * math.sin(2 * math.pi * k / segs), z)) for k in range(segs)])
        verts = []
        for a in range(4):
            A, B = rings[a], rings[(a + 1) % 4]
            for k in range(segs):
                k2 = (k + 1) % segs
                bm.faces.new((A[k], A[k2], B[k2], B[k]))
            verts += A
        self._assign(verts, mat)

    def profile(self, w, h, length, center, mat, axis="X"):
        """T슬롯 알루미늄 프로파일 단면을 축 방향으로 압출."""
        pts = slot_profile(w, h)
        ring0, ring1 = [], []
        c = Vector(center)
        for p in pts:
            for s, ring in ((-length / 2, ring0), (length / 2, ring1)):
                co = {"X": (s, p.x, p.y), "Y": (p.x, s, p.y), "Z": (p.x, p.y, s)}[axis]
                ring.append(self.bm.verts.new(Vector(co) + c))
        n = len(pts)
        for i in range(n):
            j = (i + 1) % n
            self.bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
        self.bm.faces.new(list(reversed(ring0)))
        self.bm.faces.new(ring1)
        self._assign(ring0 + ring1, mat)

    def build(self, parent=None, location=(0, 0, 0), smooth_angle=32, bevel=None):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        # 스무스 셰이딩 + 각도 기준 샤프 엣지 (원통은 부드럽게, 상자 모서리는 날카롭게)
        lim = math.radians(smooth_angle)
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0) > lim:
                e.smooth = False
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = location
        if parent:
            ob.parent = parent
        if bevel:
            mod = ob.modifiers.new("Bevel", "BEVEL")
            mod.width = bevel
            mod.segments = 3
            mod.limit_method = "ANGLE"
            mod.angle_limit = math.radians(40)
            mod.harden_normals = True
            mod.use_clamp_overlap = True
        return ob


def slot_profile(w, h, slot=0.0082, depth=0.0045, ch=0.0015, module=0.04):
    """40 모듈 T슬롯 프로파일 외곽선 (CCW). 각 면 40mm마다 홈 하나."""
    hw, hh = w / 2, h / 2
    corners = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
    pts = []
    for i in range(4):
        a, b = Vector(corners[i]), Vector(corners[(i + 1) % 4])
        d = b - a
        L = d.length
        t = d / L
        n_in = Vector((-t.y, t.x))
        pts.append(a + t * ch)
        m = max(1, round(L / module))
        for k in range(m):
            c = (k + 0.5) * L / m
            for s, dd in ((c - slot / 2, 0), (c - slot / 2, depth), (c + slot / 2, depth), (c + slot / 2, 0)):
                pts.append(a + t * s + n_in * dd)
        pts.append(b - t * ch)
    return pts


def empty(name, location=(0, 0, 0), parent=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = "PLAIN_AXES"
    ob.empty_display_size = 0.08
    bpy.context.scene.collection.objects.link(ob)
    ob.location = location
    if parent:
        ob.parent = parent
    return ob


# ─────────────────────────────── 컨베이어 ───────────────────────────────
def build_belt(parent):
    """드럼을 감싸는 벨트 루프. U = 경로 길이 / 타일 길이 (three.js에서 offset.x로 흐름 표현)."""
    R = BELT_R
    zc = DRUM_Z
    arc_n = 28
    path = []
    # 위쪽 직선: tail(-X) -> head(+X)
    path += [(-HALF_L, zc + R), (HALF_L, zc + R)]
    # head 드럼 반바퀴 (위 -> 아래)
    for k in range(1, arc_n):
        a = math.pi / 2 - math.pi * k / arc_n
        path.append((HALF_L + R * math.cos(a), zc + R * math.sin(a)))
    # 아래 직선: head -> tail
    path += [(HALF_L, zc - R), (-HALF_L, zc - R)]
    # tail 드럼 반바퀴 (아래 -> 위)
    for k in range(1, arc_n):
        a = -math.pi / 2 - math.pi * k / arc_n
        path.append((-HALF_L + R * math.cos(a), zc + R * math.sin(a)))
    path.append(path[0])  # 이음매 (UV가 달라야 하므로 정점을 새로 만든다)

    seg = [math.dist(path[i], path[i + 1]) for i in range(len(path) - 1)]
    total = sum(seg)
    tile = total / round(total / P["belt_tile"])      # 한 바퀴에 정수 개 타일 -> 이음매 없음
    s_acc = [0.0]
    for d in seg:
        s_acc.append(s_acc[-1] + d)

    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    hw = P["belt_w"] / 2
    left = [bm.verts.new((x, -hw, z)) for x, z in path]
    right = [bm.verts.new((x, hw, z)) for x, z in path]
    for i in range(len(path) - 1):
        f = bm.faces.new((left[i], left[i + 1], right[i + 1], right[i]))
        for loop, (uu, vv) in zip(f.loops, ((s_acc[i], 0), (s_acc[i + 1], 0), (s_acc[i + 1], 1), (s_acc[i], 1))):
            loop[uv].uv = (uu / tile, vv)
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    top_face = bm.faces[0]                             # 위쪽 직선 면: 법선이 +Z여야 함
    if top_face.normal.z < 0:
        for f in bm.faces:
            f.normal_flip()
    for f in bm.faces:
        f.smooth = True
    me = bpy.data.meshes.new("Conveyor_Belt")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MAT["belt"])
    ob = bpy.data.objects.new("Conveyor_Belt", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    sol = ob.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = P["belt_t"]
    sol.offset = 0.0
    ob["belt_tile_m"] = tile                            # three.js에서 스크롤 속도 계산에 사용
    return ob, tile


def build_roller(name, r, length, location, parent, mat_body, axle_len=None):
    """회전체: 기준점 = 회전축 중심. 끝면에 볼트 자국을 넣어 회전이 눈에 보이게 함."""
    pt = Part(name)
    pt.cyl(r, length, (0, 0, 0), mat_body, axis="Y", segs=40)
    for sgn in (-1, 1):
        y = sgn * (length / 2 + 0.0008)
        pt.cyl(r * 0.78, 0.0016, (0, y, 0), MAT["frame"], axis="Y", segs=40)       # 엔드캡
        pt.cyl(r * 0.16, 0.0024, (0, y * 1.0 + sgn * 0.0006, r * 0.45), MAT["black"], axis="Y", segs=12)  # 볼트 (회전 표시)
        if axle_len:
            pt.cyl(0.007, axle_len, (0, sgn * (length / 2 + axle_len / 2), 0), MAT["steel"], axis="Y", segs=16)
    return pt.build(parent=parent, location=location)


def build_conveyor(root):
    conv = empty("Conveyor", parent=root)
    belt, tile = build_belt(conv)

    # 드럼 (벨트가 감기는 양 끝)
    drum_len = P["belt_w"] + 0.008
    axle = RAIL_IN - drum_len / 2 + 0.01
    build_roller("Drum_Head", P["drum_r"], drum_len, (HALF_L, 0, DRUM_Z), conv, MAT["steel"], axle_len=axle)
    build_roller("Drum_Tail", P["drum_r"], drum_len, (-HALF_L, 0, DRUM_Z), conv, MAT["steel"], axle_len=axle)

    # 하부 리턴 롤러 (레일 아래에 매달림, 측면에서 보이는 디테일)
    ret_z = DRUM_Z - BELT_R - P["belt_t"] / 2 - P["return_r"]
    ret_len = 2 * (RAIL_OUT - 0.0045)
    xs = []
    x = -HALF_L + 0.22
    while x < HALF_L - 0.2:
        if all(abs(x - lx) > 0.07 for lx in P["leg_x"]):
            xs.append(round(x, 4))
        x += P["return_pitch"]
    for i, x in enumerate(xs, 1):
        build_roller(f"Roller_{i:02d}", P["return_r"], ret_len, (x, 0, ret_z), conv, MAT["steel"])

    # 프레임 (정적, 재질별로 오브젝트 하나씩)
    frame = Part("Conveyor_Frame")
    hw_ = Part("Conveyor_Hardware")
    caps = Part("Conveyor_Caps")
    rail_zc = (RAIL_TOP + RAIL_BOT) / 2
    for s in (-1, 1):
        frame.profile(P["rail_w"], P["rail_h"], RAIL_LEN, (0, s * RAIL_CY, rail_zc), MAT["frame"], axis="X")
        for ex in (-1, 1):  # 레일 끝 마감 캡
            caps.box((0.004, P["rail_w"] + 0.001, P["rail_h"] + 0.001),
                     (ex * (RAIL_LEN / 2 + 0.002), s * RAIL_CY, rail_zc), MAT["black"])
        for dx in (-HALF_L, HALF_L):  # 드럼 베어링 하우징
            hw_.box((0.052, 0.008, 0.052), (dx, s * (RAIL_OUT + 0.004), DRUM_Z), MAT["alu"])
            hw_.cyl(0.016, 0.012, (dx, s * (RAIL_OUT + 0.014), DRUM_Z), MAT["alu"], axis="Y")
            for bx, bz in ((-0.019, -0.019), (0.019, -0.019), (-0.019, 0.019), (0.019, 0.019)):
                hw_.cyl(0.0035, 0.004, (dx + bx, s * (RAIL_OUT + 0.010), DRUM_Z + bz), MAT["steel"], axis="Y", segs=6)
        for x in xs:  # 리턴 롤러 브래킷
            frame.box((0.03, 0.004, 0.045), (x, s * (RAIL_OUT - 0.002), RAIL_BOT - 0.012), MAT["frame"])

    # 다리, 발, 보강재
    leg_bot = 0.04
    for lx in P["leg_x"]:
        for s in (-1, 1):
            ly = s * RAIL_CY
            frame.profile(P["leg"], P["leg"], RAIL_BOT - leg_bot, (lx, ly, (RAIL_BOT + leg_bot) / 2), MAT["frame"], axis="Z")
            hw_.box((0.05, 0.05, 0.005), (lx, ly, leg_bot - 0.0025), MAT["alu"])            # 발 플레이트
            hw_.cyl(0.006, 0.024, (lx, ly, 0.025), MAT["steel"], segs=16)                  # 수평 조절 볼트
            hw_.cyl(0.009, 0.006, (lx, ly, 0.018), MAT["steel"], segs=6)                   # 너트
            caps.cyl(0.027, 0.012, (lx, ly, 0.006), MAT["rubber"], segs=32)                # 고무 패드
        frame.profile(P["leg"], P["leg"], 2 * RAIL_CY - P["leg"], (lx, 0, P["brace_z"]), MAT["frame"], axis="Y")
    for s in (-1, 1):
        span = P["leg_x"][-1] - P["leg_x"][0] - P["leg"]
        frame.profile(P["leg"], P["leg"], span, (0, s * RAIL_CY, P["brace_z"]), MAT["frame"], axis="X")

    # 구동 모터 (head 쪽, 관람자 쪽 -Y)
    motor = Part("Conveyor_Motor")
    gy = -(RAIL_OUT + 0.02 + 0.04)
    motor.box((0.09, 0.07, 0.10), (HALF_L, gy, DRUM_Z), MAT["motor"])                   # 기어박스
    motor.cyl(0.02, 0.022, (HALF_L, -(RAIL_OUT + 0.012), DRUM_Z), MAT["alu"], axis="Y")   # 출력축 커버
    mx0 = HALF_L - 0.045
    motor.cyl(0.036, 0.02, (mx0 - 0.01, gy, DRUM_Z), MAT["motor"], axis="X")            # 플랜지
    motor.cyl(0.042, 0.13, (mx0 - 0.085, gy, DRUM_Z), MAT["motor"], axis="X")           # 모터 몸체
    for k in range(6):                                                                  # 냉각 핀
        motor.cyl(0.046, 0.004, (mx0 - 0.035 - k * 0.018, gy, DRUM_Z), MAT["motor"], axis="X")
    motor.cyl(0.039, 0.035, (mx0 - 0.165, gy, DRUM_Z), MAT["black"], axis="X")          # 팬 커버
    motor.box((0.045, 0.04, 0.03), (mx0 - 0.07, gy, DRUM_Z + 0.055), MAT["motor"])       # 단자함
    motor.box((0.03, 0.002, 0.018), (mx0 - 0.09, gy - 0.0425, DRUM_Z), MAT["alu"])       # 명판
    motor.build(parent=conv, bevel=0.002)

    # 팔레트 가이드 (UHMW)
    guide = Part("Conveyor_Guide")
    g_in = RAIL_IN - P["guide_overhang"]
    for s in (-1, 1):
        guide.box((RAIL_LEN - 0.06, P["guide_w"], P["guide_h"]),
                  (0, s * (g_in + P["guide_w"] / 2), RAIL_TOP + P["guide_h"] / 2), MAT["guide"])
    guide.build(parent=conv, bevel=0.0012)

    # 도착 센서 (앞 레일) + 반사판 (뒤 레일): 스테이션 3곳 + 버퍼·회수 구간
    refl = Part("Conveyor_Reflectors")
    targets = [(f"Sensor_ST{i}", sx) for i, sx in enumerate(P["station_x"], 1)]
    targets += [(f"Sensor_CV{cv}", zone_center(cv)) for cv in P["zone_sensor_cv"]]
    for name, cx in targets:
        x = min(cx + P["pallet"][0] / 2 + 0.012, HALF_L - 0.24)  # head 쪽 구동 모터 몸체(x ≥ HALF_L-0.195)와 간섭 없게
        sen = Part(name)
        by = -(RAIL_OUT + 0.011)
        sen.box((0.004, 0.018, 0.05), (x, -(RAIL_OUT + 0.002), RAIL_TOP - 0.01), MAT["alu"])  # L 브래킷
        sen.box((0.024, 0.016, 0.034), (x, by, RAIL_TOP + 0.012), MAT["black"])               # 센서 몸체
        sen.cyl(0.005, 0.004, (x, by + 0.009, RAIL_TOP + 0.005), MAT["lens"], axis="Y", segs=20)
        sen.build(parent=conv, bevel=0.0015)
        led = Part(f"{name}_LED")
        led.box((0.006, 0.006, 0.002), (0, 0, 0), MAT["led_amber"])
        led.build(parent=conv, location=(x + 0.006, by, RAIL_TOP + 0.030))
        refl.box((0.022, 0.003, 0.022), (x, RAIL_OUT + 0.0015, RAIL_TOP - 0.002), MAT["reflector"])
    refl.build(parent=conv, bevel=0.001)

    frame.build(parent=conv, smooth_angle=20)
    hw_.build(parent=conv, bevel=0.0008)
    caps.build(parent=conv, bevel=0.001)
    return conv, tile


# ─────────────────────────────── 스테이션 ───────────────────────────────
def build_stations(root):
    names = {1: "ST1_Assembly", 2: "ST2_Process", 3: "ST3_Inspection"}
    for i, sx in enumerate(P["station_x"], 1):
        st = empty(f"Station_ST{i}", location=(sx, 0, 0), parent=root)
        st["role"] = names[i]
        ry = P["robot_y"]
        ped = Part(f"Robot_Pedestal_ST{i}")
        pw, top = P["pedestal"], P["pedestal_top"]
        ped.box((0.36, 0.36, 0.015), (0, ry, 0.0075), MAT["paint"])                       # 베이스 플레이트
        ped.box((pw, pw, top - 0.035), (0, ry, 0.015 + (top - 0.035) / 2), MAT["paint"])  # 기둥
        ped.box((0.26, 0.26, 0.02), (0, ry, top - 0.01), MAT["alu"])                      # 상판
        for bx in (-0.15, 0.15):
            for by in (-0.15, 0.15):
                ped.cyl(0.009, 0.01, (bx, ry + by, 0.02), MAT["steel"], segs=6)            # 앵커 볼트
        ped.build(parent=st, bevel=0.003)
        empty(f"Robot_Mount_ST{i}", location=(0, ry, top), parent=st)

        ring = Part(f"Status_Ring_ST{i}")
        ring.annulus(0.285, 0.30, 0.0005, 0.0035, (0, ry), MAT[f"status{i}"])
        ring.build(parent=st)

        if i in P["cameras"]:
            build_camera_stand(i, st)


def build_camera_stand(i, st):
    """카메라 스탠드: 컨베이어 뒤쪽(로봇 쪽)에 세워 앞 시야를 가리지 않음.
    ST2: 스테이션 중심 위에서 내려다보는 경로 카메라
    ST3: 스테이션 하류 쪽 위, 로봇이 차를 들어 보여주는 검사 위치를 내려다봄"""
    stand = Part(f"CameraStand_ST{i}")
    cam = Part(f"Camera_ST{i}")
    light = Part(f"Camera_ST{i}_Light")
    cx = 0.0 if i == 2 else 0.34            # 카메라가 내려다보는 x (스테이션 기준)
    px = cx - 0.30 if i == 2 else cx + 0.28  # 기둥 x
    py = RAIL_OUT + 0.09                     # 기둥 y (뒤 레일 바로 뒤)
    post_h = 1.34
    arm_z = post_h - 0.02
    stand.box((0.16, 0.16, 0.012), (px, py, 0.006), MAT["paint"])
    stand.profile(0.04, 0.04, post_h - 0.012, (px, py, 0.012 + (post_h - 0.012) / 2), MAT["frame"], axis="Z")
    stand.profile(0.04, 0.04, py + 0.02, (px, py / 2 - 0.01 + 0.01, arm_z), MAT["frame"], axis="Y")
    ax0, ax1 = sorted((px, cx))
    stand.profile(0.04, 0.04, ax1 - ax0 + 0.02, ((ax0 + ax1) / 2, 0, arm_z - 0.04), MAT["frame"], axis="X")
    cz = arm_z - 0.095
    cam.box((0.06, 0.06, 0.07), (cx, 0, cz), MAT["black"])
    cam.cyl(0.02, 0.035, (cx, 0, cz - 0.052), MAT["black"], segs=32)
    cam.cyl(0.013, 0.002, (cx, 0, cz - 0.07), MAT["lens"], segs=32)
    light.annulus(0.028, 0.046, cz - 0.074, cz - 0.068, (cx, 0), MAT["ring_light"], segs=64)
    stand.build(parent=st, smooth_angle=20)
    cam.build(parent=st, bevel=0.002)
    light.build(parent=st)


# ─────────────────────────────── 팔레트 ───────────────────────────────
def build_pallets(root):
    L, W, H = P["pallet"]
    for i, sx in enumerate(P["station_x"], 1):
        pt = Part(f"Pallet_{i:02d}")
        pt.box((L, W, H), (0, 0, H / 2), MAT["pallet"])
        pt.box((0.19, 0.11, 0.002), (0, 0, H + 0.001), MAT["rubber"])                    # 차량 안착 패드
        for px_, py_ in ((-0.115, -0.08), (0.115, 0.08)):                                # 위치 결정 핀
            pt.cyl(0.005, 0.012, (px_, py_, H + 0.006), MAT["steel"], segs=24)
            pt.cyl(0.0035, 0.004, (px_, py_, H + 0.014), MAT["steel"], segs=24, r2=0.0015)
        pt.box((0.05, 0.002, 0.012), (0.08, -W / 2 - 0.001, H / 2), MAT["paint"])         # ID 태그
        ob = pt.build(parent=root, location=(sx, 0, P["belt_top"]), bevel=0.0025)
        ob["pallet_no"] = i


# ─────────────────────────────── 구간 경계 ───────────────────────────────
def build_zones(root):
    """Zone_CV1~5: 벨트 윗면 높이의 빈 오브젝트. three.js는 extras의 x 범위로 구간 좌표를 얻는다."""
    roles = {1: "ST1", 2: "BUFFER", 3: "ST2", 4: "ST3", 5: "SURPLUS"}
    xs = P["zone_x"]
    for cv in range(1, len(xs)):
        ob = empty(f"Zone_CV{cv}", location=(zone_center(cv), 0, P["belt_top"]), parent=root)
        ob["cv"] = cv
        ob["role"] = roles[cv]
        ob["x_start"] = xs[cv - 1]
        ob["x_end"] = xs[cv]


# ─────────────────────────────── 트레이 ───────────────────────────────
def build_trays(root):
    """ST3 로봇 받침대 양옆의 합격/불합격 트레이 (받침대 + 트레이). 전차 자리는 Tray_*_Slot_NN."""
    L, W, wall = P["tray"]
    top = P["tray_top"]
    x3 = P["station_x"][2]
    ry = P["robot_y"]
    pitch = W / P["tray_slots"]
    for name, sign in (("Tray_Fail", -1), ("Tray_Pass", 1)):
        pt = Part(name)
        pt.box((L + 0.04, W + 0.04, 0.015), (0, 0, top - 0.0075), MAT["paint"])            # 받침대 상판
        for lx in (-1, 1):
            for ly in (-1, 1):
                pt.profile(0.03, 0.03, top - 0.015, (lx * L / 2, ly * W / 2, (top - 0.015) / 2), MAT["frame"], axis="Z")
        pt.box((L, W, 0.006), (0, 0, top + 0.003), MAT["black"])                            # 트레이 바닥
        for s in (-1, 1):
            pt.box((L, 0.006, wall), (0, s * (W / 2 - 0.003), top + wall / 2), MAT["black"])
            pt.box((0.006, W, wall), (s * (L / 2 - 0.003), 0, top + wall / 2), MAT["black"])
        for k in range(1, P["tray_slots"]):                                                 # 칸막이
            pt.box((L - 0.012, 0.004, wall * 0.6), (0, -W / 2 + k * pitch, top + wall * 0.3), MAT["black"])
        ob = pt.build(parent=root, location=(x3 + sign * P["tray_dx"], ry, 0), bevel=0.0015)
        ob["verdict"] = "PASS" if sign > 0 else "FAIL"
        for k in range(P["tray_slots"]):
            slot = empty(f"{name}_Slot_{k + 1:02d}", location=(0, -W / 2 + (k + 0.5) * pitch, top + 0.006), parent=ob)
            slot["slot"] = k + 1


# ─────────────────────────────── 보관창고 ───────────────────────────────
def build_storage(root):
    """헤드 드럼 너머의 보관창고. 서보가 Storage_Rack(3단 선반) 전체를 상하로 움직여
    채울 칸의 윗면을 벨트 윗면에 맞춘다. Rack 기준점 = 1칸 윗면 중심, 기본 위치 = 1칸이 벨트 높이."""
    n, pitch = P["storage_slots"], P["storage_pitch"]
    stroke = (n - 1) * pitch
    sl, sw = P["pallet"][0] + 0.04, P["pallet"][1] + 0.06    # 선반 한 칸 크기
    sx = HALF_L + P["drum_r"] + P["storage_gap"] + sl / 2
    bt = P["belt_top"]
    rack_h = stroke + 0.16                                    # 1칸 윗면 기준 선반 높이 범위 (-0.02 ~ rack_h)
    post_h = bt + rack_h + 0.08                               # 1칸이 벨트에 있을 때(가장 높은 위치)를 덮는 높이

    # 고정부: 기둥 4개, 상부 프레임, 서보 모터
    fx, fy = sl / 2 + 0.03, sw / 2 + 0.03
    st = Part("Storage")
    st.box((2 * fx + P["leg"], 2 * fy + 0.1, 0.012), (0, 0, 0.006), MAT["paint"])           # 바닥판 (컨베이어 끝 아래로 들어가지 않게)
    for lx in (-1, 1):
        for ly in (-1, 1):
            st.profile(P["leg"], P["leg"], post_h - 0.012, (lx * fx, ly * fy, 0.012 + (post_h - 0.012) / 2), MAT["frame"], axis="Z")
    for ly in (-1, 1):
        st.profile(P["leg"], P["leg"], 2 * fx + P["leg"], (0, ly * fy, post_h + 0.02), MAT["frame"], axis="X")
    for lx in (-1, 1):
        st.profile(P["leg"], P["leg"], 2 * fy - P["leg"], (lx * fx, 0, post_h + 0.02), MAT["frame"], axis="Y")
    st.box((0.09, 0.09, 0.08), (fx, 0, post_h + 0.08), MAT["motor"])                       # 서보 기어박스
    st.cyl(0.035, 0.12, (fx, 0, post_h + 0.18), MAT["motor"])                               # 서보 모터
    st.cyl(0.006, post_h - 0.05, (fx - 0.01, 0, (post_h + 0.05) / 2), MAT["steel"], segs=16)  # 볼 스크루
    storage = st.build(parent=root, location=(sx, 0, 0), smooth_angle=20, bevel=0.002)

    # 움직이는 3단 선반 (벨트 쪽 -X는 열려 있음)
    rk = Part("Storage_Rack")
    for k in range(n):
        z = k * pitch
        rk.box((sl, sw, 0.012), (0, 0, z - 0.006), MAT["alu"])                               # 칸 바닥
        rk.box((0.006, sw, 0.03), (sl / 2 - 0.003, 0, z + 0.015), MAT["alu"])                # 뒤 스토퍼
    for sx_ in (-1, 1):                                                                     # 모서리 기둥 (칸 안이 보이게 옆판 대신)
        for sy_ in (-1, 1):
            rk.box((0.012, 0.012, rack_h + 0.02), (sx_ * (sl / 2 - 0.006), sy_ * (sw / 2 + 0.006), (rack_h - 0.02) / 2), MAT["frame"])
    rk.box((0.02, 0.05, 0.03), (sl / 2 + 0.01, 0, rack_h / 2), MAT["steel"])                 # 볼 스크루 너트 블록
    rack = rk.build(parent=storage, location=(0, 0, bt), bevel=0.0015)
    for k in range(1, n + 1):
        slot = empty(f"Storage_Slot_{k:02d}", location=(0, 0, (k - 1) * pitch), parent=rack)
        slot["level"] = k
    root["storage_slots"] = n
    root["storage_pitch"] = pitch
    root["storage_stroke"] = stroke  # 선반 상하 이동 범위 (three.js 애니메이션)
    root["storage_x"] = sx


# ─────────────────────────────── 실행 ───────────────────────────────
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    build_materials()
    root = empty("EV_Line")
    root["station_x"] = P["station_x"]
    _, tile = build_conveyor(root)
    root["belt_tile_m"] = tile
    root["belt_top_m"] = P["belt_top"]
    build_stations(root)
    build_pallets(root)
    build_zones(root)
    build_trays(root)
    build_storage(root)
    root["zone_x"] = P["zone_x"]

    os.makedirs(OUT_DIR, exist_ok=True)
    blend = os.path.join(OUT_DIR, "ev_line_conveyor.blend")
    glb = os.path.join(OUT_DIR, "ev_line_conveyor.glb")
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    bpy.ops.export_scene.gltf(
        filepath=glb, export_format="GLB", export_apply=True, export_yup=True,
        export_texcoords=True, export_normals=True, export_materials="EXPORT",
        export_extras=True, export_cameras=False, export_lights=False,
    )
    print(f"[conveyor_gen] saved:\n  {blend}\n  {glb}\n  belt tile = {tile:.4f} m")


if __name__ == "__main__":
    main()
