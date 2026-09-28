"""preview_src.html + GLB + Indy7(URDF·STL) -> 단일 HTML (에셋을 base64로 포함)"""
import base64, json, sys, pathlib
here = pathlib.Path(__file__).parent
src = (here / "preview_src.html").read_text(encoding="utf-8")
glb = base64.b64encode((here / "assets" / "ev_line_conveyor.glb").read_bytes()).decode()
indy = here / "assets" / "indy7"
indy7 = json.dumps({
    "urdf": (indy / "indy7.urdf").read_text(encoding="utf-8"),
    "meshes": {p.name: base64.b64encode(p.read_bytes()).decode() for p in sorted((indy / "meshes").glob("*.stl"))},
}).replace("<", "\\u003c")  # <script> 안에서 URDF 주석(<!--)·태그가 파싱되지 않게
three = sys.argv[2] if len(sys.argv) > 2 else "https://cdn.jsdelivr.net/npm/three@0.169.0"
urdf_loader = "https://cdn.jsdelivr.net/npm/urdf-loader@0.12.6/src/URDFLoader.js"  # digital_twin2와 같은 버전
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else here / "conveyor_preview.html"
html = (src.replace("__GLB_BASE64__", glb).replace("__INDY7__", indy7)
        .replace("__URDF_LOADER__", urdf_loader).replace("__THREE__", three))
if len(sys.argv) > 2: html = '<meta charset="utf-8">\n' + html  # 로컬 테스트용
out.write_text(html, encoding="utf-8")
print(out, round(out.stat().st_size / 1e6, 2), "MB")
