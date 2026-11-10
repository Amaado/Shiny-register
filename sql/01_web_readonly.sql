-- shiny-register-web v1.0
-- EJECUTAR EN EL MISMO PROYECTO SUPABASE QUE shiny-register.
-- No modifica ni elimina las capturas existentes.
-- Activa lectura PRIVADA con Supabase Auth. El bot sigue usando su clave secreta.

-- Lista blanca de usuarios autorizados para consultar la web.
create table if not exists public.sr_web_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.sr_web_access enable row level security;
revoke all on table public.sr_web_access from public, anon, authenticated;
grant select on table public.sr_web_access to authenticated;
drop policy if exists sr_web_access_self_read on public.sr_web_access;
create policy sr_web_access_self_read on public.sr_web_access
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Las tablas del bot mantienen RLS; navegador: solo SELECT para autorizados.
alter table public.sr_accounts enable row level security;
alter table public.sr_variants enable row level security;
alter table public.sr_captures enable row level security;
revoke all on table public.sr_accounts, public.sr_variants, public.sr_captures
  from public, anon, authenticated;
grant select on table public.sr_accounts, public.sr_variants, public.sr_captures to authenticated;

drop policy if exists sr_web_accounts_read on public.sr_accounts;
create policy sr_web_accounts_read on public.sr_accounts
  for select to authenticated using (
    exists (select 1 from public.sr_web_access a where a.user_id = (select auth.uid()))
  );
drop policy if exists sr_web_variants_read on public.sr_variants;
create policy sr_web_variants_read on public.sr_variants
  for select to authenticated using (
    exists (select 1 from public.sr_web_access a where a.user_id = (select auth.uid()))
  );
drop policy if exists sr_web_captures_read on public.sr_captures;
create policy sr_web_captures_read on public.sr_captures
  for select to authenticated using (
    exists (select 1 from public.sr_web_access a where a.user_id = (select auth.uid()))
  );

-- Resumen de cuentas, incluida la bandeja virtual «Sin asignar».
create or replace view public.sr_web_accounts_summary
with (security_invoker = true) as
select a.id::text as account_id, a.account_key, a.username, a.trainer_name,
       count(c.discord_message_id)::bigint as total_captures,
       count(distinct c.variant_key)::bigint as distinct_variants,
       count(c.discord_message_id) filter (where c.status = 'needs_review')::bigint as needs_review
from public.sr_accounts a
left join public.sr_captures c on c.account_id = a.id
group by a.id
union all
select 'unassigned'::text, null::text, null::text, null::text,
       count(*)::bigint,
       count(distinct c.variant_key)::bigint,
       count(*) filter (where c.status = 'needs_review')::bigint
from public.sr_captures c
where c.account_id is null
having count(*) > 0;

-- Una fila por variante real: la misma que identifica el bot (fondo/forma/etc.).
create or replace view public.sr_web_variants_summary
with (security_invoker = true) as
select v.variant_key, v.species, v.form, v.shiny, v.background, v.background_name,
       v.dynamax, v.gigantamax, v.shadow, v.purified, v.costume, v.gender,
       coalesce(v.image_path,
         (array_agg(c.card_image_path order by c.captured_at desc)
           filter (where c.card_image_path is not null))[1]) as image_path,
       v.image_origin, v.first_seen_at,
       count(c.discord_message_id)::bigint as total_captures,
       count(distinct coalesce(c.account_id::text, 'unassigned'))
         filter (where c.discord_message_id is not null)::bigint as account_count,
       max(c.captured_at) as last_captured_at
from public.sr_variants v
left join public.sr_captures c on c.variant_key = v.variant_key
group by v.variant_key;

-- Cuántos ejemplares de cada variante hay en cada cuenta.
create or replace view public.sr_web_item_locations
with (security_invoker = true) as
select coalesce(c.account_id::text, 'unassigned') as account_id,
       c.variant_key,
       count(*)::bigint as quantity,
       count(*) filter (where c.status = 'needs_review')::bigint as needs_review
from public.sr_captures c
group by c.account_id, c.variant_key;

-- Las vistas NO deben estar disponibles para usuarios anónimos.
revoke all on public.sr_web_accounts_summary, public.sr_web_variants_summary,
  public.sr_web_item_locations from public, anon, authenticated;
grant select on public.sr_web_accounts_summary, public.sr_web_variants_summary,
  public.sr_web_item_locations to authenticated;

-- El bucket es PRIVADO. Las imágenes se consultan mediante enlaces temporales.
-- No se otorgan permisos de subida, modificación ni borrado desde la web.
update storage.buckets set public = false where id = 'shiny-register';
drop policy if exists sr_web_storage_read on storage.objects;
create policy sr_web_storage_read on storage.objects
  for select to authenticated using (
    bucket_id = 'shiny-register' and
    exists (select 1 from public.sr_web_access a where a.user_id = (select auth.uid()))
  );
