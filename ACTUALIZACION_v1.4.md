# Shiny Register Web 1.4 — Inventario unificado

## Qué cambia

- Una única ficha por **nombre de Pokémon**. La tabla `public.sr_pokemon` usa `name` como clave primaria.
- Los ejemplares permanecen en `public.sr_captures` (ID único de mensaje de Discord). Cada captura conserva PC, IV, nivel, talla, forma, shiny, fondo, Dinamax/Gigamax, cuenta e imagen.
- Desaparece el listado separado por variantes; dentro de cada ficha se ven todos los ejemplares y las cuentas en las que están.
- Filtros **combinados** con lógica AND: `Shiny` + `Con fondo` solo muestra las capturas que cumplen ambas condiciones.
- Botón **eliminar** por captura, visible únicamente a quien el administrador haya autorizado.
- Un registro eliminado recibe una marca privada para que no vuelva a importarse del histórico.
- Se priorizan fotos almacenadas en Supabase y se intenta cargar la tarjeta original cuando la fotografía principal falla. Si faltan ambas, se muestra el marcador.

## Orden de instalación obligatorio

1. En el proyecto Supabase **del bot**, ejecutar `sql/03_unificar_inventario.sql` en SQL Editor. Es una transacción que no borra capturas ni imágenes. Crea `sr_pokemon`, columnas de atributos y la vista `sr_web_captures`.
2. Ejecutar `sql/05_comprobar_unificacion.sql` y revisar que **capturas** no se han reducido. Los registros mal interpretados sin nombre reconocible quedan por identificar; la migración no inventa especies.
3. Para permitirte eliminar capturas, ejecutar `sql/04_autorizar_borrado.sql`, sustituyendo `PON_AQUI_TU_CORREO`. **No conceder** ese permiso a lectores normales.
4. Copiar el ZIP de la web en el repositorio de GitHub (sin sobrescribir `.env`, `config.js`, ni `.github/workflows`). Confirmar el commit y hacer `git push origin main`.
5. Instalar también el parche del bot 0.4 en ServerKodiMc para evitar errores en las futuras capturas y respetar las eliminaciones durante el histórico.

## Seguridad y límites

- No publiques claves secretas en GitHub. La web usa solamente `sb_publishable_` / `anon`; el bot mantiene su clave secreta en su `.env` privado.
- La eliminación usa la función `sr_delete_capture(message_id)` con comprobación de administrador del lado de Supabase y no concede `DELETE` directo al navegador.
- Borrar una captura no borra el mensaje de Discord ni el archivo físico de imagen en Storage; el registro deja de contarse. Para restaurarla necesitarías una operación de administrador en SQL.
- La tabla técnica `sr_variants` permanece para compatibilidad con el bot anterior, **pero ya no representa fichas principales de inventario**.
- Las capturas con datos incompletos siguen pendientes de revisión. El OCR local no garantiza leer todos los campos.
- No se ha aplicado este SQL en tu Supabase real ni ejecutado el bot real. Prueba primero en una copia si la base tiene modificaciones manuales ajenas a nuestras versiones.

## Ejemplo de uso

`Inventario → Giratina` presenta una única ficha. Dentro se muestran las capturas de todas las cuentas, cada una con su CP, IV, nivel, tamaño, forma, Shiny, fondo y, si procede, Max. Si marcas `Shiny` y `Con fondo`, únicamente cuenta los ejemplares que cumplen ambas condiciones a la vez.
