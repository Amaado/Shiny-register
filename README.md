# shiny-register-web 1.4 — una ficha por Pokémon

**Actualización:** sigue primero `ACTUALIZACION_v1.4.md` y ejecuta la migración SQL 03 antes de publicar esta versión.

# shiny-register-web v1.3 — Correo y contraseña

Inventario web de Pokémon privado, con vistas de **Inventario** y **Cuentas**. No requiere Google, servicios de IA ni frameworks.

## Acceso

- **Registrarse:** formulario de correo + contraseña (mínimo 8 caracteres) y confirmación de contraseña. Usa Supabase Auth para gestionar las contraseñas; jamás se almacenan en la web ni en GitHub.
- **Iniciar sesión:** correo + contraseña.
- **Mantener sesión iniciada:** si se marca, la sesión de Supabase se guarda en `localStorage` y puede renovarse hasta cerrar sesión o ser revocada. Sin marcarla, se usa `sessionStorage`, que se limita a la sesión de esa pestaña/navegador. Ninguno de los dos almacena la contraseña. El navegador puede restaurar pestañas en determinados escenarios.
- **Cerrar sesión:** elimina ambas copias locales y solicita a Supabase revocar la sesión actual.
- **Cuentas nuevas:** no ven el inventario hasta que el administrador las añade a `public.sr_web_access`.

### Configurar Supabase (una sola vez)

1. **Authentication → Sign In / Providers → Email:** activa el proveedor **Email** y el registro por correo.
2. **Authentication → URL Configuration:** configura como Site URL `https://amaado.github.io/Shiny-register/` y añade esta misma dirección en Redirect URLs. Ajusta la ruta si cambias de repositorio.
3. **Email confirmation:** si está activada, el usuario deberá confirmar su correo. En proyectos alojados, para mandar emails a destinatarios que no pertenezcan al equipo de Supabase puede ser necesario configurar SMTP propio en Authentication → SMTP Settings. No desactives la confirmación de correo solo para evitar configurar el SMTP.
4. Ejecuta `sql/01_web_readonly.sql` si aún no se aplicó. Después de registrar cada usuario, ejecuta `sql/02_authorize_user.sql` cambiando `PON_AQUI_TU_CORREO` por el correo autorizado. El alta por sí sola no concede acceso al inventario.
5. Puedes desactivar el proveedor **Google** en Supabase cuando ningún otro proyecto lo necesite. No tienes que crear credenciales OAuth.

**Advertencia:** GitHub Pages muestra HTML, CSS y JS públicamente. La protección de datos depende de las políticas RLS y del bucket privado de Supabase. No coloques en el repositorio claves `sb_secret_` o `service_role`.

## Construir la web con `.env` local

`.env` no es accesible desde el navegador. `scripts/build.py` transforma solamente `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_STORAGE_BUCKET` en un archivo `dist/config.js` público.

```bash
cp .env.example .env
# Edita .env con la URL y clave publishable/anon de tu Supabase.
python3 scripts/build.py
```

```dotenv
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_TU_CLAVE_PUBLICA
SUPABASE_STORAGE_BUCKET=shiny-register
```

### Raspberry Pi, acceso por Tailscale

Directorio: `/home/andres/Dockers/bots/discord/PoGo/shiny-register-web`

```bash
cd /home/andres/Dockers/bots/discord/PoGo/shiny-register-web
python3 scripts/build.py
docker compose up -d
```

Desde Tailscale (si el puerto está accesible): `http://100.103.139.31:8098`.

### GitHub Pages

Repositorio: `https://github.com/Amaado/Shiny-register`.

1. GitHub → Settings → Pages → Source: **GitHub Actions**.
2. En Secrets and variables → Actions: `SUPABASE_URL` (variable), `SUPABASE_STORAGE_BUCKET` (variable), `SUPABASE_PUBLISHABLE_KEY` (secret, aunque el navegador la recibe como clave pública).
3. El workflow `.github/workflows/pages.yml` generará y publicará `dist/` en cada push a `main`.
4. URL: `https://amaado.github.io/Shiny-register/`.

Para subir una actualización al repositorio existente:

```bash
git add -A
git status --short
# Comprueba que NO aparecen .env, config.js, dist/ ni copias de seguridad
git commit -m "Acceso por correo y registro con sesión opcional"
git push origin main
```

No se modifica `sql/01_web_readonly.sql`, ni se duplican los datos del bot. Puedes conservar usuarios actuales creados por correo y contraseña; los que solo utilizaran Google tendrán que establecer una contraseña mediante los mecanismos de recuperación de Supabase.

## Seguridad

- Sesión persistente: tokens de Supabase en localStorage. Sesión temporal: tokens en sessionStorage. Ambos almacenamientos son accesibles al JavaScript del sitio; evita sesiones permanentes en equipos compartidos.
- Usa HTTPS de GitHub Pages para registro e inicio de sesión.
- Verifica que RLS y la política de `storage.objects` siguen activadas para usuarios **autorizados**; registro público no implica autorización.
- Revisa la configuración de confirmación por email y SMTP antes de abrir el registro a terceros.
