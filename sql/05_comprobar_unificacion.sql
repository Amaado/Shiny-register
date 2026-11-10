-- Comprobaciones de SOLO LECTURA tras aplicar la migración.
SELECT count(*) AS capturas, count(distinct pokemon_name) AS nombres_unicos,
       count(*) FILTER (WHERE pokemon_name IS NULL) AS por_identificar
FROM public.sr_captures;

SELECT pokemon_name, count(*) AS ejemplares,
       count(distinct account_id) AS cuentas
FROM public.sr_captures
WHERE lower(pokemon_name) IN ('giratina','buizel')
GROUP BY pokemon_name ORDER BY pokemon_name;

SELECT pokemon_name, cp, iv_percent, pokemon_level, size, background,
       dynamax, gigantamax, discord_message_id
FROM public.sr_captures
WHERE lower(pokemon_name) IN ('giratina','buizel')
ORDER BY pokemon_name, captured_at DESC LIMIT 30;
