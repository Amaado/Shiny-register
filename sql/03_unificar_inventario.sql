-- shiny-register-web v1.4 / shiny-register-bot v0.4
-- Ejecutar UNA VEZ (seguro al repetir) en SQL Editor del mismo Supabase.
-- No elimina ninguna captura, variante ni imagen. Las capturas siguen identificadas
-- exclusivamente por el ID del mensaje de Discord.

BEGIN;

-- 1. Identidad principal: nombre del Pokémon, no sus PC/IV/forma/fondo.
CREATE OR REPLACE FUNCTION public.sr_clean_pokemon_name(raw_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT nullif(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(coalesce(raw_name,''), '^\s*Shiny\s+', '', 'i'),
            '[,[:space:]]+CP\s*:?\s*[0-9].*$', '', 'i'),
          '[,[:space:]]+(IVs?|Level|Size|Shiny|Hundo|Background|Dynamax|Gigantamax)\s*[:=].*$', '', 'i'),
        '\s*\([^)]*\)\s*$', '', 'g'),
      '\s+((Giratina\s+)?(Altered|Origin)|Zacian\s+Hero)\s*$', '', 'i'),
    ' ,'), '');
$$;

CREATE TABLE IF NOT EXISTS public.sr_pokemon (
  name text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sr_pokemon ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sr_pokemon FROM public, anon, authenticated;
GRANT SELECT ON public.sr_pokemon TO authenticated;
DROP POLICY IF EXISTS sr_web_pokemon_read ON public.sr_pokemon;
CREATE POLICY sr_web_pokemon_read ON public.sr_pokemon FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.sr_web_access a WHERE a.user_id = (select auth.uid())));

-- 2. Propiedades de CADA captura; no forman parte de la clave principal.
ALTER TABLE public.sr_captures
  ADD COLUMN IF NOT EXISTS pokemon_name text,
  ADD COLUMN IF NOT EXISTS form text,
  ADD COLUMN IF NOT EXISTS shiny boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS background boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS background_name text,
  ADD COLUMN IF NOT EXISTS dynamax boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gigantamax boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shadow boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS purified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS costume text,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS size text;

-- Recuperar atributos heredados de sr_variants; resolver el falso positivo
-- Background: No que se había interpretado como un fondo existente.
UPDATE public.sr_captures c SET
  pokemon_name = public.sr_clean_pokemon_name(v.species),
  form = coalesce(c.form, v.form),
  shiny = v.shiny,
  background = CASE
    WHEN concat_ws(' ', v.species, c.raw_message::text) ~* 'background\s*[:=]\s*(no|false|none|0)([^a-z]|$)' THEN false
    WHEN concat_ws(' ', v.species, c.raw_message::text) ~* 'background\s*[:=]\s*(yes|true|si|sí|1)([^a-z]|$)' THEN true
    ELSE v.background END,
  background_name = CASE
    WHEN concat_ws(' ', v.species, c.raw_message::text) ~* 'background\s*[:=]\s*(no|false|none|0)([^a-z]|$)' THEN NULL
    ELSE v.background_name END,
  dynamax = v.dynamax, gigantamax = v.gigantamax,
  shadow = v.shadow, purified = v.purified,
  costume = coalesce(c.costume,v.costume), gender = coalesce(c.gender,v.gender),
  size = coalesce(c.size,
    (regexp_match(concat_ws(' ',v.species,c.raw_message::text),
    'size\s*[:=]\s*(XXS|XS|S|M|L|XL|XXL)([^a-z]|$)','i'))[1])
FROM public.sr_variants v
WHERE c.variant_key = v.variant_key AND c.pokemon_name IS NULL;

-- Rescatar también PC/IV/nivel que estaban incrustados en el nombre erróneo
-- (por ejemplo "Buizel CP: 12 IVs: 9/5/2 (35.6%) Size: M").
UPDATE public.sr_captures c SET
  cp = coalesce(c.cp, (regexp_match(v.species, 'CP\s*:?\s*([0-9]+)', 'i'))[1]::integer),
  iv_percent = coalesce(c.iv_percent,
    (regexp_match(v.species, 'IVs?\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)\s*%', 'i'))[1]::numeric,
    (regexp_match(v.species, '\(\s*(\d{1,3}(?:\.\d+)?)\s*%\s*\)', 'i'))[1]::numeric),
  iv_attack = coalesce(c.iv_attack,
    (regexp_match(v.species, 'IVs?\s*[:=]?\s*(?:\d{1,3}(?:\.\d+)?%\s*)?\(?\s*(\d{1,2})\s*/', 'i'))[1]::smallint),
  iv_defense = coalesce(c.iv_defense,
    (regexp_match(v.species, 'IVs?\s*[:=]?\s*(?:\d{1,3}(?:\.\d+)?%\s*)?\(?\s*\d{1,2}\s*/\s*(\d{1,2})\s*/', 'i'))[1]::smallint),
  iv_stamina = coalesce(c.iv_stamina,
    (regexp_match(v.species, 'IVs?\s*[:=]?\s*(?:\d{1,3}(?:\.\d+)?%\s*)?\(?\s*\d{1,2}\s*/\s*\d{1,2}\s*/\s*(\d{1,2})', 'i'))[1]::smallint),
  pokemon_level = coalesce(c.pokemon_level,
    (regexp_match(v.species, 'Level\s*[:=]?\s*(\d+(?:\.\d+)?)', 'i'))[1]::numeric)
FROM public.sr_variants v
WHERE c.variant_key = v.variant_key
  AND (c.cp IS NULL OR c.iv_percent IS NULL OR c.iv_attack IS NULL
       OR c.iv_defense IS NULL OR c.iv_stamina IS NULL OR c.pokemon_level IS NULL);

-- Protección extra si algún registro fue migrado parcialmente.
UPDATE public.sr_captures
SET background = false, background_name = NULL
WHERE background = true AND raw_message::text ~* 'background\s*[:=]\s*(no|false|none|0)([^a-z]|$)';

INSERT INTO public.sr_pokemon(name)
SELECT DISTINCT pokemon_name FROM public.sr_captures
WHERE pokemon_name IS NOT NULL AND pokemon_name <> ''
ON CONFLICT (name) DO NOTHING;

CREATE INDEX IF NOT EXISTS sr_captures_pokemon_name_idx ON public.sr_captures(pokemon_name);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sr_captures_pokemon_name_fkey') THEN
    ALTER TABLE public.sr_captures ADD CONSTRAINT sr_captures_pokemon_name_fkey
    FOREIGN KEY (pokemon_name) REFERENCES public.sr_pokemon(name);
  END IF;
END $$;

-- 3. Eliminación explícita con auditoría mínima (tombstone) e inmunidad al backfill.
CREATE TABLE IF NOT EXISTS public.sr_deleted_messages (
  discord_message_id text PRIMARY KEY,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  deleted_by uuid
);
REVOKE ALL ON public.sr_deleted_messages FROM public, anon, authenticated;
ALTER TABLE public.sr_deleted_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sr_web_access ADD COLUMN IF NOT EXISTS can_delete boolean NOT NULL DEFAULT false;

-- Si se vuelve a ejecutar el histórico, no se puede reinsertar un mensaje borrado.
CREATE OR REPLACE FUNCTION public.sr_block_deleted_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sr_deleted_messages d WHERE d.discord_message_id = NEW.discord_message_id) THEN
    RAISE EXCEPTION 'Mensaje % eliminado expresamente del inventario', NEW.discord_message_id USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sr_prevent_deleted_capture_restore ON public.sr_captures;
CREATE TRIGGER sr_prevent_deleted_capture_restore
BEFORE INSERT OR UPDATE ON public.sr_captures
FOR EACH ROW EXECUTE FUNCTION public.sr_block_deleted_message();

CREATE OR REPLACE FUNCTION public.sr_delete_capture(message_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE removed text;
BEGIN
  IF (select auth.uid()) IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.sr_web_access a
    WHERE a.user_id = (select auth.uid()) AND a.can_delete = true
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para borrar capturas.' USING ERRCODE='42501';
  END IF;
  IF message_id IS NULL OR message_id !~ '^[0-9]{10,24}$' THEN
    RAISE EXCEPTION 'Identificador de captura incorrecto';
  END IF;
  -- Grabación y borrado dentro de la misma transacción.
  DELETE FROM public.sr_captures WHERE discord_message_id = message_id
  RETURNING discord_message_id INTO removed;
  IF removed IS NULL THEN RETURN false; END IF;
  INSERT INTO public.sr_deleted_messages(discord_message_id, deleted_by)
  VALUES (removed,(select auth.uid()))
  ON CONFLICT (discord_message_id) DO NOTHING;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.sr_delete_capture(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sr_delete_capture(text) TO authenticated;

-- 4. Vista segura de datos limpios. Nunca expone raw_message ni credenciales.
CREATE OR REPLACE VIEW public.sr_web_captures
WITH (security_invoker = true) AS
SELECT c.discord_message_id, c.captured_at, c.account_id::text AS account_id,
       c.discord_jump_url, c.pokemon_name, c.form, c.shiny,
       c.background, c.background_name, c.dynamax, c.gigantamax,
       c.shadow, c.purified, c.costume, c.gender, c.size,
       c.cp, c.iv_percent, c.iv_attack, c.iv_defense, c.iv_stamina,
       c.pokemon_level, c.catch_source, c.status,
       coalesce(v.image_path,c.card_image_path) AS image_path,
       c.card_image_path
FROM public.sr_captures c
LEFT JOIN public.sr_variants v ON v.variant_key = c.variant_key;
REVOKE ALL ON public.sr_web_captures FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sr_web_captures TO authenticated;

-- No se conceden permisos DELETE directos. Sólo la función controlada.
REVOKE DELETE ON public.sr_captures FROM authenticated, anon;

COMMIT;

-- Autorización de borrado (separada, sólo para el administrador elegido):
-- UPDATE public.sr_web_access SET can_delete=true
-- WHERE user_id=(SELECT id FROM auth.users WHERE email='TU_CORREO' LIMIT 1);
