"""Build out/index.html from dist using only the Python standard library."""
import base64
import hashlib
import html
import json
import os
from pathlib import Path
import re
import tempfile


ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
OUT = ROOT / "out" / "index.html"
VENDOR = {
    "three": "vendor/three.module.min.js",
    "core": "vendor/three.core.min.js",
    "gsap": "vendor/gsap.min.js",
}
CDN = {
    "three": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.min.js",
    "core": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.core.min.js",
    "gsap": "https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js",
    "tailwind": "https://cdn.tailwindcss.com/3.4.17",
}
MIME = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".svg": "image/svg+xml", ".ttf": "font/ttf",
    ".woff": "font/woff", ".woff2": "font/woff2", ".avif": "image/avif",
}
IMPORT = re.compile(r"""(?P<prefix>\b(?:from\s*|import\s*(?:\(\s*)?))(?P<q>['"])(?P<ref>\.{1,2}/[^'"]+)(?P=q)""")
MODULE_URL = re.compile(r"""new\s+URL\(\s*(?P<q>['"])(?P<ref>[^'"]+)(?P=q)\s*,\s*import\.meta\.url\s*\)(?P<href>\.href)?""")
CSS_URL = re.compile(r"""url\(\s*(?P<q>['"]?)(?P<ref>[^'"()]+?)(?P=q)\s*\)""")
MARKER = "__ATLAS_ESCAPED_LESS_THAN__"


def source_text(path):
    return path.read_text(encoding="utf-8-sig")


def rel(path):
    return path.resolve().relative_to(DIST.resolve()).as_posix()


def data_url(path):
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return "data:" + MIME[path.suffix.lower()] + ";base64," + payload


def inline_script_body(text):
    # Store original source in inert script elements. Restore the escaping before
    # execution so even regex literals and shader template strings are unchanged.
    if MARKER in text:
        raise ValueError("Source collides with the inline script escape marker")
    return re.sub(r"<(?=/script\b|script\b|!--)", MARKER, text, flags=re.I)


def js_data(data):
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")


def stylesheet(path):
    def inline_url(match):
        ref = match["ref"].strip()
        if ref.startswith(("data:", "#")):
            return match[0]
        if "://" in ref or ref.startswith("/"):
            raise ValueError("Unexpected external CSS asset: " + ref)
        return 'url("' + data_url(path.parent / ref) + '")'
    return CSS_URL.sub(inline_url, source_text(path))


def module_source(path, assets):
    def module_import(match):
        spec = rel(path.parent / match["ref"])
        if not (DIST / spec).is_file():
            raise FileNotFoundError(f"{rel(path)} imports missing module {spec}")
        return match["prefix"] + json.dumps("atlas/" + spec)

    def texture(match):
        asset = path.parent / match["ref"]
        key = rel(asset)
        if key not in assets:
            assets[key] = data_url(asset)
        accessor = "window.atlasAsset(" + json.dumps(key) + ")"
        return accessor if match["href"] else "new URL(" + accessor + ")"

    return MODULE_URL.sub(texture, IMPORT.sub(module_import, source_text(path)))


def tag_attribute(tag, name):
    match = re.search(r"""\b""" + name + r"""\s*=\s*(["'])(.*?)\1""", tag, re.I)
    return match[2] if match else None


def inline_link(match):
    tag = match[0]
    ref = tag_attribute(tag, "href")
    kind = tag_attribute(tag, "rel")
    if kind == "stylesheet":
        css = stylesheet(DIST / ref)
        if "</style" in css.lower():
            raise ValueError(f"Unexpected style terminator in {ref}")
        return f'<style data-source="{html.escape(ref)}">\n{css}\n</style>'
    if kind == "icon":
        return tag.replace(ref, data_url(DIST / ref))
    return tag


def legal_notices():
    notices = {rel(path): source_text(path) for path in sorted(DIST.rglob("*"))
               if path.is_file() and ("LICENSE" in path.name.upper() or "CREDITS" in path.name.upper())}
    # Both distribution packages ship the MIT terms. Preserve Tailwind's own copyright.
    mit = notices["vendor/LICENSE"]
    notices.setdefault("Tailwind CSS 3.4.17", re.sub(r"Copyright[^\n]+", "Copyright (c) Tailwind Labs, Inc.", mit, count=1))
    gsap_notice = source_text(DIST / VENDOR["gsap"]).split("*/", 1)[0] + "*/"
    notices["GSAP 3.13.0"] = gsap_notice
    return "\n\n".join(f"===== {name} =====\n{content.strip()}" for name, content in notices.items())


BOOTSTRAP = r"""
(async function startAtlas() {
  const read = (id) => JSON.parse(document.getElementById(id).textContent);
  const assets = read('atlas-assets');
  // Keep the recovery film outside the JSON map. A WebGL-capable browser
  // never needs to parse or decode the video payload to begin its live scene.
  window.atlasAsset = (path) => {
    const key=String(path).replace(/^(?:\.\/|\/)+/, '');
    if(key==='assets/previews/mission-film.mp4') return 'data:video/mp4;base64,'+document.getElementById('atlas-film-print').textContent;
    return assets[key];
  };
  const config = read('atlas-dependencies');
  const sourceOf = (node) => node.textContent.replaceAll('__ATLAS_ESCAPED_LESS_THAN__', '<');
  const scriptUrl = (source) => URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
  function runClassic(source) {
    const script = document.createElement('script');
    script.text = source;
    document.head.append(script);
    script.remove();
  }

  // The default presentation uses only the embedded source. With ?cdn=1 the
  // browser tries the pinned distributions before using the same embedded copies.
  // Verify upstream JS before mapping it, so a partial response cannot break boot.
  const remote = {};
  if (new URLSearchParams(location.search).get('cdn') === '1') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await Promise.all(Object.entries(config.urls).map(async ([id, url]) => {
      try {
        const response = await fetch(url, {signal:controller.signal, credentials:'omit'});
        if (!response.ok) throw new Error('Unavailable dependency');
        const code = (await response.text()).replace(/\r\n?/g, '\n');
        if (config.hashes[id]) {
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
          const hex = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2,'0')).join('');
          if (hex !== config.hashes[id]) throw new Error('Unexpected distribution');
        }
        remote[id] = code;
      } catch {
        // The corresponding local library and compiled utilities are already present.
      }
    }));
    clearTimeout(timeout);
  }

  const modules = new Map();
  for (const node of document.querySelectorAll('script[data-atlas-module]')) {
    modules.set(node.dataset.atlasModule, sourceOf(node));
  }
  if (remote.core) modules.set(config.vendor.core, remote.core);
  if (remote.three) {
    modules.set(config.vendor.three, remote.three.replaceAll('./three.core.min.js', 'atlas/' + config.vendor.core));
  }
  runClassic(remote.gsap || sourceOf(document.getElementById('atlas-gsap')));
  if (remote.tailwind) {
    runClassic(remote.tailwind);
    if (window.tailwind) window.tailwind.config = {corePlugins:{preflight:false}};
  }

  // Install the entire graph before any import, including deferred imports. Bare
  // names resolve in Blob modules under file://, and do not depend on a web root.
  const imports = {};
  for (const [name, code] of modules) {
    imports['atlas/' + name] = scriptUrl(code + '\n//# sourceURL=earth-migration/' + name);
  }
  imports.three = imports['atlas/' + config.vendor.three];
  const map = document.createElement('script');
  map.type = 'importmap';
  map.textContent = JSON.stringify({imports});
  document.head.append(map);
  await import('atlas/main.js');
})().catch((error) => {
  const label = document.getElementById('loading-label');
  if (label) label.textContent = '加载失败，请在支持 WebGL 2 的现代浏览器中重新打开。';
  console.error('The Earth Migration Project could not start.', error);
});
"""


def build():
    document = source_text(DIST / "index.html")
    document = re.sub(r"<link\b[^>]*>", inline_link, document, flags=re.I)
    document = re.sub(r"""<script\b[^>]*type=["']importmap["'][^>]*>.*?</script>""", "", document, flags=re.I | re.S)
    document, classic_count = re.subn(r"""<script\b[^>]*src=["']\./vendor/gsap\.min\.js["'][^>]*>\s*</script>""",
                                     "", document, flags=re.I)
    if classic_count != 1:
        raise ValueError("Expected one local GSAP script in dist/index.html")

    assets = {rel(path): data_url(path) for path in sorted((DIST / "assets/previews").glob("*.webp"))}
    module_tags = []
    for path in sorted(DIST.rglob("*.js")):
        if rel(path) not in {VENDOR["gsap"], "vendor/OrbitControls.js"}:
            code = inline_script_body(module_source(path, assets))
            module_tags.append(f'<script type="text/plain" data-atlas-module="{html.escape(rel(path))}">\n{code}\n</script>')
    hashes = {name: hashlib.sha256(source_text(DIST / path).encode()).hexdigest() for name,path in VENDOR.items()}
    hashes["tailwind"] = "176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15"
    metadata = {"vendor": VENDOR, "urls": CDN, "hashes": hashes}
    bundle = "\n".join([
        '<script type="application/octet-stream" id="atlas-film-print">' +
        base64.b64encode((DIST / 'assets/previews/mission-film.mp4').read_bytes()).decode('ascii') + '</script>',
        '<script type="application/json" id="atlas-assets">' + js_data(assets) + '</script>',
        '<script type="application/json" id="atlas-dependencies">' + js_data(metadata) + '</script>',
        '<script type="text/plain" id="atlas-credits">\n' + inline_script_body(legal_notices()) + '\n</script>',
        *module_tags,
        '<script type="text/plain" id="atlas-gsap">\n' + inline_script_body(source_text(DIST / VENDOR["gsap"])) + '\n</script>',
        '<script>' + BOOTSTRAP + '</script>'
    ])
    document, n = re.subn(r"""<script\b[^>]*src=["']\./main\.js["'][^>]*>\s*</script>""",
                          lambda _: bundle, document, flags=re.I)
    if n != 1:
        raise ValueError("Expected one local main.js entry in dist/index.html")

    OUT.parent.mkdir(exist_ok=True)
    # Atomic replacement keeps a previous working deliverable readable on rebuild failure.
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", suffix=".tmp",
                                     dir=OUT.parent, delete=False) as stream:
        temp = Path(stream.name)
        try:
            stream.write(document)
        except BaseException:
            stream.close()
            temp.unlink(missing_ok=True)
            raise
    try:
        os.replace(temp, OUT)
    finally:
        temp.unlink(missing_ok=True)
    print(f"{OUT}  {OUT.stat().st_size:,} bytes | {len(module_tags)} modules | {len(assets)} mapped images")


if __name__ == "__main__":
    build()
