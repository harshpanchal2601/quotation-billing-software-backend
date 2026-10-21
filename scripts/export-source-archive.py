"""Export the backend and sibling frontend without local secrets or runtime data."""

import argparse
import fnmatch
import os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


SOURCE_DIRECTORIES = {"src", "tests", "prisma", "docs", "scripts", "public", ".github"}
EXCLUDED_DIRECTORIES = {
    ".git", ".aws", ".agents", ".codex", ".ssh", "node_modules", "dist", "build",
    "coverage", "storage", "uploads", "backups", "private", "secrets", "__pycache__",
}
EXCLUDED_FILES = (
    ".env*", "*.pem", "*.key", "*.p12", "*.pfx", "*.crt", "*.cer", "*.log",
    "*.sql.gz", "*.dump", "*.sqlite*", "*.db", "*.zip", "*.tar*", "*.gz", "*.bak",
    "*credentials*", "*secret*", "id_rsa*", "id_ed25519*", ".npmrc", ".yarnrc*",
)
ROOT_FILES = {
    ".gitignore", ".gitattributes", ".dockerignore", "Dockerfile", "package.json",
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "index.html",
}


def source_files(root):
    for directory, children, filenames in os.walk(root, followlinks=False):
        relative = Path(directory).relative_to(root)
        children[:] = sorted(
            name for name in children
            if name.lower() not in EXCLUDED_DIRECTORIES
            and not name.startswith(".") and not (Path(directory) / name).is_symlink()
        ) if relative.parts else sorted(
            name for name in children
            if name in SOURCE_DIRECTORIES and not (root / name).is_symlink()
        )
        for name in sorted(filenames):
            path = Path(directory) / name
            if path.is_symlink() or not path.is_file():
                continue
            if any(fnmatch.fnmatch(name.lower(), pattern) for pattern in EXCLUDED_FILES):
                continue
            if not relative.parts and name not in ROOT_FILES and not (
                name.endswith((".md", ".ts", ".js", ".mjs", ".cjs"))
                or fnmatch.fnmatch(name, "tsconfig*.json")
            ):
                continue
            if name.startswith(".") and name not in ROOT_FILES and name != ".gitkeep":
                continue
            yield path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="New ZIP path outside both source repositories")
    args = parser.parse_args()
    backend = Path(__file__).resolve().parents[1]
    roots = [backend, backend.parent / "frontend"]
    output = args.output.expanduser().resolve()
    if any(output.is_relative_to(root) for root in roots):
        parser.error("Output must be outside both repositories")
    if any(not root.is_dir() for root in roots):
        parser.error("Expected sibling backend and frontend repositories")
    # Exclusive creation prevents overwriting an existing source archive.
    with ZipFile(output, "x", compression=ZIP_DEFLATED) as archive:
        for root in roots:
            for path in source_files(root):
                archive.write(path, Path(root.name) / path.relative_to(root))
    print(f"Created source archive: {output}")


if __name__ == "__main__":
    main()
