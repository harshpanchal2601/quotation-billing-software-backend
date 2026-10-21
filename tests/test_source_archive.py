"""Regression coverage for the source archive file policy, with no application data."""

import importlib.util
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location(
    "source_archive", Path(__file__).resolve().parents[1] / "scripts/export-source-archive.py"
)
source_archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source_archive)


class SourceArchivePolicyTests(unittest.TestCase):
    def test_excludes_secrets_private_data_and_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in [
                "src/app.ts", "package.json", ".github/workflows/check.yml", "prisma/schema.prisma",
                ".env", ".env.production", "src/.env", "src/secrets/token.json",
                "src/key.pem", "src/service-credentials.json", "storage/customer.pdf",
                "node_modules/module.js", ".aws/credentials", "private/data.json", "backup.zip",
            ]:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("fixture")
            (root / "src/link.ts").symlink_to(root / ".env")
            self.assertEqual(
                {str(path.relative_to(root)) for path in source_archive.source_files(root)},
                {"src/app.ts", "package.json", ".github/workflows/check.yml", "prisma/schema.prisma"},
            )


if __name__ == "__main__":
    unittest.main()
