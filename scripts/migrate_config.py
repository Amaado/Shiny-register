#!/usr/bin/env python3
"""Migra la configuración pública previa de config.js a .env una sola vez.

No imprime valores. No borra automáticamente config.js, que puede usarse
como copia local. Ese archivo no debe subirse a GitHub.
"""
import ast
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
old = ROOT / 'config.js'
new = ROOT / '.env'
if new.exists():
    raise SystemExit('Ya existe .env. No se ha sobreescrito.')
if not old.exists():
    raise SystemExit('No existe config.js antiguo. Copia .env.example a .env y edítalo.')
data = {}
for key in ('SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_STORAGE_BUCKET'):
    # El proyecto original usa export const KEY = 'texto';
    m = re.search(r'^\s*export\s+const\s+' + re.escape(key) + r'\s*=\s*("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\')\s*;', old.read_text(), re.M)
    if not m:
        raise SystemExit(f'No se puede migrar {key}: revisa config.js manualmente')
    try:
        value = ast.literal_eval(m.group(1))
    except Exception as exc:
        raise SystemExit(f'Formato de {key} no compatible') from exc
    if not isinstance(value, str) or any(c in value for c in '\r\n'):
        raise SystemExit(f'Valor incorrecto en {key}')
    data[key] = value
with new.open('x', encoding='utf-8') as f:
    for k, v in data.items():
        f.write(f'{k}={v}\n')
os.chmod(new, 0o600)
print('Archivo .env creado (modo 600). Revisa y valida con python3 scripts/build.py.')
