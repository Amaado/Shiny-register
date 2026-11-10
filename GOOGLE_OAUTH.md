# Inicio de sesión con Google en GitHub Pages

1. Configura el proveedor Google en **Supabase Authentication → Sign In / Providers → Google**. Introduce allí el Client ID y el **Client Secret** de Google Cloud, nunca en la web.
2. En Google Cloud, el callback OAuth es exactamente el mostrado por Supabase: `https://TU-PROYECTO.supabase.co/auth/v1/callback`.
3. En **Supabase Authentication → URL Configuration**, añade la URL de GitHub Pages completa, como `https://TU_USUARIO.github.io/shiny-register-web/`, a **Redirect URLs** y configúrala como Site URL si será la principal.
4. La web utiliza `redirect_to` con su URL actual y vuelve a ella después del acceso. Si cambias a otro dominio, añade también ese origen/URL en Supabase.
5. El usuario se crea con Google, pero no puede ver la base de datos hasta ser incluido en `public.sr_web_access`. Usa `sql/02_authorize_user.sql`.

No se necesitan secretos de Google ni service_role en `.env` de esta web. Solo URL de Supabase + clave pública + bucket.
