-- Ejecutar DESPUÉS de sql/03_unificar_inventario.sql.
-- Sustituye el correo por el de tu propia cuenta administradora.
-- No otorgues permisos de borrado a usuarios que solo deban consultar.
DO $$
DECLARE
    target_id uuid;
BEGIN
    SELECT id INTO target_id
    FROM auth.users
    WHERE lower(email)=lower('PON_AQUI_TU_CORREO')
    LIMIT 1;
    IF target_id IS NULL THEN
        RAISE EXCEPTION 'No se ha encontrado la cuenta de administrador.';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.sr_web_access WHERE user_id=target_id) THEN
        RAISE EXCEPTION 'El usuario debe estar autorizado primero en sr_web_access.';
    END IF;
    UPDATE public.sr_web_access SET can_delete=true WHERE user_id=target_id;
    RAISE NOTICE 'Permiso de eliminación concedido a %', target_id;
END $$;
