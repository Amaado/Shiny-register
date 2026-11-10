#!/usr/bin/env python3
"""Construye una web estática publicable leyendo .env o variables de entorno.

Únicamente emite URL, public/anon key y nombre de bucket. NO metas aquí
ninguna credencial privada: todo dist/ es visible a los visitantes.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import shutil
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
ALLOW = ('SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_STORAGE_BUCKET')


def load_dotenv(path):
    result = {}
    if not path.exists():
        return result
    for n, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        row = line.strip()
        if not row or row.startswith('#'):
            continue
        if row.startswith('export '):
            row = row[7:].lstrip()
        if '=' not in row:
            raise ValueError(f'Formato .env incorrecto (línea {n})')
        key, value = row.split('=', 1)
        key, value = key.strip(), value.strip()
        if key not in ALLOW:
            # Esta aplicación solo necesita tres variables públicas.
            # Ignoramos otras variables sin incorporarlas a dist/.
            continue
        if value.startswith(('"', "'")):
            if len(value) < 2 or value[-1] != value[0]:
                raise ValueError(f'Comillas sin cerrar en .env (línea {n})')
            value = value[1:-1]
        result[key] = value
    return result


def validate_public_key(key):
    if not key or key.startswith(('TU_', 'sb_secret_')):
        raise ValueError('Clave inválida: utiliza una clave publishable/anon, nunca secret/service_role')
    if key.startswith('sb_publishable_'):
        if len(key) < 25 or not re.fullmatch(r'sb_publishable_[A-Za-z0-9_-]+', key):
            raise ValueError('Clave publishable inválida')
        return
    # Anon JWT antiguo; nunca permitir service_role ni otro rol.
    if key.startswith('eyJ') and key.count('.') == 2:
        try:
            payload = key.split('.')[1]
            payload += '=' * (-len(payload) % 4)
            role = json.loads(base64.urlsafe_b64decode(payload)).get('role')
        except Exception as exc:
            raise ValueError('JWT de Supabase inválido') from exc
        if role != 'anon':
            raise ValueError('JWT NO permitido: se requiere rol anon, nunca service_role')
        return
    raise ValueError('Se requiere SUPABASE_PUBLISHABLE_KEY (sb_publishable_...) o JWT anon')


def build(root=ROOT, environ=None):
    env = load_dotenv(root / '.env')
    # En CI, las variables de entorno tienen prioridad sobre .env.
    env.update({k: v for k, v in (environ or os.environ).items() if k in ALLOW and v})
    url = env.get('SUPABASE_URL', '').rstrip('/')
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path not in ('', '/')):
        raise ValueError('SUPABASE_URL debe ser una URL HTTPS de proyecto, sin ruta ni credenciales')
    if parsed.hostname.lower() == 'tu-proyecto.supabase.co':
        raise ValueError('Sustituye TU-PROYECTO por tu proyecto real')
    key = env.get('SUPABASE_PUBLISHABLE_KEY', '')
    validate_public_key(key)
    bucket = env.get('SUPABASE_STORAGE_BUCKET', 'shiny-register')
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', bucket):
        raise ValueError('SUPABASE_STORAGE_BUCKET inválido')
    out = root / 'dist'
    out.mkdir(parents=True, exist_ok=True)
    for filename in ('index.html', 'app.js', 'styles.css'):
        shutil.copy2(root / filename, out / filename)
    shutil.copytree(root / 'assets', out / 'assets', dirs_exist_ok=True)
    generated = ('// Generado automáticamente. Valores PÚBLICOS del navegador.\n'
                 + 'export const SUPABASE_URL = ' + json.dumps(url) + ';\n'
                 + 'export const SUPABASE_PUBLISHABLE_KEY = ' + json.dumps(key) + ';\n'
                 + 'export const SUPABASE_STORAGE_BUCKET = ' + json.dumps(bucket) + ';\n')
    (out / 'config.js').write_text(generated, encoding='utf-8')
    print('Web generada en dist/ (index, JS, CSS, imágenes y configuración pública).')
    return out


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Generar shiny-register-web desde .env / variables de entorno')
    parser.parse_args()
    try:
        build()
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
