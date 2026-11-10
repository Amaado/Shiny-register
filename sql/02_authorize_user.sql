-- PASO 2: en Supabase > Authentication > Users, crea antes tu usuario (correo + contraseña).
-- Sustituye PON_AQUI_TU_CORREO por ese correo y ejecuta en SQL Editor.
-- Si el correo no existe, este script da error. No crea cuentas públicamente.
do $$
declare found_id uuid;
begin
  select id into found_id from auth.users
    where lower(email) = lower('andresamadocibreiro22@gmail.com') limit 1;
  if found_id is null then
    raise exception 'Usuario inexistente. Créalo antes en Authentication > Users.';
  end if;
  insert into public.sr_web_access(user_id) values (found_id)
    on conflict (user_id) do nothing;
  raise notice 'Acceso de lectura concedido al usuario %', found_id;
end $$;
