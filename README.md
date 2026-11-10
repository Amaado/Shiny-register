# shiny-register-web v1.2 · GitHub + .env

Web estática privada de inventario Pokémon. Interfaz HTML/CSS/JS; lectura de Supabase; login con Google y correo; acceso sólo a usuarios autorizados por RLS.

## Punto importante sobre .env

**Los navegadores no leen `.env`.** El script `scripts/build.py` lee `.env` local (o las variables de GitHub Actions) y genera `dist/config.js`, que contiene **exclusivamente valores públicos**. La web funciona sin Node, Vite ni servidor de aplicaciones.

`dist/config.js` puede ser inspeccionado por cualquier visitante, como es normal con aplicaciones web. La seguridad del inventario depende de **Supabase Auth + políticas RLS**, no de ocultar la publishable key.

Nunca introduzcas en `.env` de esta web claves `service_role`, `sb_secret_`, el token del bot de Discord, ni el Client Secret de Google. Esas credenciales pertenecen únicamente a los respectivos servicios seguros.

## 1. Instalar en ServerKodiMc (manteniendo la versión anterior)

Directorio: `/home/andres/Dockers/bots/discord/PoGo/shiny-register-web`

Si estás actualizando desde v1.1:

```bash
cd /home/andres/Dockers/bots/discord/PoGo/shiny-register-web
# Guardar tu configuración previa, si existe
cp -n config.js config.js.backup 2>/dev/null || true
# Después de descomprimir v1.2, migra config.js:
python3 scripts/migrate_config.py
# Si no existía config.js, usa cp .env.example .env y edita .env
python3 scripts/build.py
docker compose up -d
docker compose ps
```

Si ya has creado `.env`, el migrador no sobrescribe nada. El archivo `config.js` antiguo está excluido de Git mediante `.gitignore`; **elimínalo después de comprobar que `.env` contiene los datos correctos**. No incluyas nunca este `config.js` antiguo en un commit.

### Variables de .env

```dotenv
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_TU_CLAVE_PUBLICA
SUPABASE_STORAGE_BUCKET=shiny-register
```

También se admite una antigua clave `anon` JWT. El compilador bloquea explícitamente claves privadas `sb_secret_` y JWT con rol `service_role`.

El script genera `dist/index.html`, `dist/app.js`, `dist/styles.css`, `dist/assets/` y `dist/config.js`. **No copies `.env` dentro de dist/**.

En Tailscale, si el contenedor está funcionando y el puerto está accesible, abre `http://100.103.139.31:8098`. Para iniciar sesión con Google, se recomienda una URL HTTPS.

## 2. Subir el código a GitHub

Crea en GitHub un repositorio vacío llamado `shiny-register-web` (sin README inicial). Desde la Raspberry:

```bash
cd /home/andres/Dockers/bots/discord/PoGo/shiny-register-web
git init
git branch -M main
git add .
git status --short
# Verifica que .env, config.js y dist/ NO aparecen en staged
git commit -m "shiny-register-web: inventario y Google OAuth con .env"
git remote add origin https://github.com/TU_USUARIO/shiny-register-web.git
git push -u origin main
```

Si el repo ya existe o tiene un remoto, no repitas `git init`/`git remote add`: utiliza `git remote -v` y publica en su rama correspondiente. GitHub puede solicitar autenticación con navegador, clave SSH o token; **no pegues un token en el chat**.

## 3. Publicar mediante GitHub Pages

En GitHub: **Settings → Secrets and variables → Actions**:
- **Variables**: `SUPABASE_URL` y `SUPABASE_STORAGE_BUCKET`.
- **Secrets**: `SUPABASE_PUBLISHABLE_KEY` (es una clave pública, se usa aquí para no escribirla en el repositorio; quedará visible en el JS publicado).

Después en **Settings → Pages**, selecciona **Build and deployment → Source: GitHub Actions**. El workflow `.github/workflows/pages.yml` compila y despliega cada push a `main`.

URL habitual de un repositorio Pages: `https://TU_USUARIO.github.io/shiny-register-web/`. Usa la dirección **real** que muestre el deployment.

**Atención:** GitHub Pages publica los ficheros estáticos, aunque el inventario siga protegido por Supabase Auth y RLS. No incluyas capturas privadas ni tokens en el repositorio. Si RLS no está configurado, NO publiques la web hasta corregirlo.

## 4. Configurar Google en Supabase

En **Authentication → URL Configuration**:
- Añade a Redirect URLs la URL final exacta `https://TU_USUARIO.github.io/shiny-register-web/` (termina en `/`).
- Cambia Site URL a esta URL si GitHub Pages será el acceso principal.

En **Google Cloud**, la URI de callback autorizada es la de Supabase (`https://TU-PROYECTO.supabase.co/auth/v1/callback`), **no** la URL de GitHub Pages. Si debes configurar Authorized JavaScript origins, usa `https://TU_USUARIO.github.io` (sin la ruta).

Se mantiene el control de acceso en `public.sr_web_access`. La cuenta Google debe estar autorizada por el script SQL de `sql/02_authorize_user.sql` para ver las colecciones.

## 5. Contenido

- `index.html`, `app.js`, `styles.css`, `assets/`: interfaz.
- `scripts/build.py`: compila la web con configuración pública.
- `scripts/migrate_config.py`: migra el antiguo `config.js` a `.env` sin revelar valores.
- `.env.example`: plantilla sin credenciales.
- `.gitignore`: bloquea `.env`, `config.js` y `dist/`.
- `.github/workflows/pages.yml`: publicación automática.
- `compose.yaml`, `nginx.conf`: servidor local con Docker.
- `sql/`: políticas RLS e inclusión de usuarios autorizados.

## Pruebas

```bash
python3 scripts/build.py
find dist -maxdepth 2 -type f
# comprobación opcional
git check-ignore .env config.js dist/config.js
```

El despliegue real depende de las variables de GitHub, de la configuración de Supabase/Google y de los permisos del repositorio.
