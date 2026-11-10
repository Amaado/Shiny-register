import base64
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from build import build, validate_public_key

class BuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        for name in ('index.html', 'app.js', 'styles.css'):
            shutil.copy2(ROOT / name, self.root / name)
        shutil.copytree(ROOT / 'assets', self.root / 'assets')

    def tearDown(self):
        self.tmp.cleanup()

    def test_build_contains_only_static_files(self):
        (self.root / '.env').write_text('SUPABASE_URL=https://proyecto.supabase.co\nSUPABASE_PUBLISHABLE_KEY=sb_publishable_test123456789abcdefghijk\nSUPABASE_STORAGE_BUCKET=shiny-register\n' )
        out = build(self.root, environ={})
        self.assertEqual(sorted(p.name for p in out.iterdir()), ['app.js', 'assets', 'config.js', 'index.html', 'styles.css'])
        self.assertNotIn('.env', [p.name for p in out.iterdir()])
        content = (out / 'config.js').read_text()
        self.assertIn('proyecto.supabase.co', content)
        self.assertNotIn('service_role', content)

    def test_private_key_rejected(self):
        for value in ('sb_secret_12345', 'nonsense', 'TU_CLAVE'):
            with self.subTest(key=value):
                with self.assertRaises(ValueError):
                    validate_public_key(value)

    def test_service_role_jwt_rejected(self):
        payload = base64.urlsafe_b64encode(json.dumps({'role': 'service_role'}).encode()).rstrip(b'=').decode()
        with self.assertRaises(ValueError):
            validate_public_key('eyJhbGciOiJIUzI1NiJ9.' + payload + '.signature')

    def test_migration_preserves_existing_env(self):
        (self.root / '.env').write_text('EXISTS=yes\n')
        (self.root / 'scripts').mkdir()
        shutil.copy2(ROOT/'scripts/migrate_config.py', self.root/'scripts/migrate_config.py')
        (self.root / 'config.js').write_text("export const SUPABASE_URL = 'https://dummy.supabase.co';")
        result=subprocess.run([sys.executable, str(self.root/'scripts/migrate_config.py')], capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.root / '.env').read_text(), 'EXISTS=yes\n')

if __name__ == '__main__':
    unittest.main()
