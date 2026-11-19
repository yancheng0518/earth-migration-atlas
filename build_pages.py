"""Stage the static Pages site, isolating each release's browser resources."""

from pathlib import Path
import re
import shutil
import sys


def publish(revision):
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("Expected the full Git commit ID")

    source = Path("dist")
    offline = Path("out/index.html")
    site = Path("_site")
    relative_release = f"./releases/{revision}/"
    release = site / relative_release
    shutil.copytree(source, release)
    shutil.copy2(offline, release / "standalone.html")

    # Keep stable URLs available for cached entry pages, download links and
    # direct asset links from earlier editions.
    shutil.copytree(source, site, dirs_exist_ok=True)
    shutil.copy2(offline, site / "standalone.html")
    entry = (source / "index.html").read_text(encoding="utf-8-sig")
    entry = re.sub(r'(href|src)="\./([^"]+)"', rf'\1="{relative_release}\2"', entry)
    entry = entry.replace('"three":"./vendor/', f'"three":"{relative_release}vendor/')
    entry = entry.replace("<body ", f'<body data-asset-root="{relative_release}" ', 1)
    (site / "index.html").write_text(entry, encoding="utf-8")


if __name__ == "__main__":
    publish(sys.argv[1])
