"""Comprobaciones sin acceso a cuentas reales de Supabase."""
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class LocalAuthTests(unittest.TestCase):
    def test_login_register_markup(self):
        html = (ROOT / 'index.html').read_text()
        self.assertIn('id="rememberSession"', html)
        self.assertIn('id="confirmPassword"', html)
        self.assertIn('id="toggleRegister"', html)
        self.assertIn('id="loginForm"', html)
        self.assertNotIn('id="googleButton"', html)

    def test_password_endpoints_and_storage(self):
        js = (ROOT / 'app.js').read_text()
        self.assertIn("/auth/v1/signup?redirect_to=", js)
        self.assertIn("/auth/v1/token?grant_type=password", js)
        self.assertIn("/auth/v1/logout", js)
        self.assertIn("sessionPersistence === 'local' ? localStorage : sessionStorage", js)
        self.assertIn("other.removeItem(STORAGE_SESSION)", js)
        self.assertIn("sessionStorage.removeItem(STORAGE_SESSION)", js)
        self.assertNotIn("provider', 'google'", js)
        self.assertNotIn('startGoogleAuth', js)

    def test_js_syntax(self):
        subprocess.run(['node', '--check', 'app.js'], cwd=ROOT, check=True, capture_output=True)

    def test_session_state_functional(self):
        # Ejecuta funciones reales con un navegador simulado: sin llamadas a red.
        js = (ROOT / 'app.js').read_text()
        fragment = js[js.index('function saveSession(value) {'):js.index('async function refreshSession()')]
        test_js = """
          const vm=require('node:vm');const assert=require('node:assert/strict');
          const src=process.argv[1];
          const makeStorage=()=>{const d=new Map();return {setItem:(k,v)=>d.set(k,v),getItem:k=>d.get(k)||null,removeItem:k=>d.delete(k)}};
          const localStorage=makeStorage(),sessionStorage=makeStorage();
          const state={session:null,user:null};const imageCache=new Map();
          let sessionPersistence='session';
          const STORAGE_SESSION='shiny-register-web-session-v2';
          const LEGACY_SESSION='shiny-register-web-session-v1';
          const checkbox={checked:false};const $=()=>checkbox;
          vm.runInThisContext(src);
          const issued={access_token:'ACCESS',refresh_token:'REFRESH',expires_in:3600,user:{id:'U'}};
          saveSession(issued);
          assert.ok(sessionStorage.getItem(STORAGE_SESSION));assert.equal(localStorage.getItem(STORAGE_SESSION),null);
          clearSession();assert.equal(sessionStorage.getItem(STORAGE_SESSION),null);
          sessionPersistence='local';saveSession(issued);
          assert.ok(localStorage.getItem(STORAGE_SESSION));assert.equal(sessionStorage.getItem(STORAGE_SESSION),null);
          state.session=null;sessionPersistence='session';
          assert.equal(restoreStoredSession(),true);assert.equal(sessionPersistence,'local');assert.equal(checkbox.checked,true);
          clearSession();assert.equal(localStorage.getItem(STORAGE_SESSION),null);
        """
        # El código de las funciones accede a nombres definidos en el contexto global de VM.
        # Ejecutarlo directamente junto con los stubs para conservar el mismo alcance léxico.
        test_js = test_js.replace("vm.runInThisContext(src);", "eval(src);")
        subprocess.run(['node', '-e', test_js, fragment], cwd=ROOT, check=True, capture_output=True)


if __name__ == '__main__':
    unittest.main()
