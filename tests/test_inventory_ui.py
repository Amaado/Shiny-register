"""Prueba E2E local, datos ficticios y Supabase interceptado en el navegador."""
from __future__ import annotations
import json
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CAPTURES = [
    dict(discord_message_id='1558466720350478376', captured_at='2026-11-09T04:37:00Z', account_id='account1', pokemon_name='Giratina', form='Altered', shiny=True, background=False, dynamax=False, gigantamax=False, shadow=False, purified=False, cp=2388, iv_percent=89, iv_attack=15, iv_defense=14, iv_stamina=11, pokemon_level=25, size='M', status='complete', image_path=None, card_image_path=None, discord_jump_url='https://discord.com/channels/1/2/3', background_name=None, costume=None, gender=None),
    dict(discord_message_id='1558466720350478377', captured_at='2026-11-09T04:38:00Z', account_id='account2', pokemon_name='Giratina', form='Origin', shiny=True, background=True, dynamax=False, gigantamax=False, shadow=False, purified=False, cp=1863, iv_percent=96, iv_attack=15, iv_defense=14, iv_stamina=14, pokemon_level=25, size='L', status='needs_review', image_path=None, card_image_path=None, discord_jump_url=None, background_name='Special', costume=None, gender=None),
    dict(discord_message_id='1558466720350478378', captured_at='2026-11-09T04:39:00Z', account_id='account2', pokemon_name='Buizel', form=None, shiny=True, background=False, dynamax=False, gigantamax=False, shadow=False, purified=False, cp=12, iv_percent=35.6, iv_attack=9, iv_defense=5, iv_stamina=2, pokemon_level=1, size='M', status='complete', image_path=None, card_image_path=None, discord_jump_url=None, background_name=None, costume=None, gender=None),
]
ACCOUNTS=[dict(account_id='account1',username='cuenta1',trainer_name=None,account_key='username:cuenta1',total_captures=1,distinct_variants=1,needs_review=0),dict(account_id='account2',username='cuenta2',trainer_name=None,account_key='username:cuenta2',total_captures=2,distinct_variants=2,needs_review=1)]


def run_ui_test():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1440,'height':900})
        js_errors=[]
        page.on('pageerror',lambda err:js_errors.append(str(err)))
        page.on('dialog',lambda dialog:dialog.accept())
        # about:blank: sin acceso a Internet, todos los fetch se simulan en memoria.
        page.set_content((ROOT/'index.html').read_text())
        page.evaluate("""([accounts,captures]) => {
            const mockStorage=()=>{const items=new Map();return {setItem:(k,v)=>items.set(k,v),getItem:k=>items.get(k)||null,removeItem:k=>items.delete(k)};};
            Object.defineProperty(window,'localStorage',{configurable:true,value:mockStorage()});
            Object.defineProperty(window,'sessionStorage',{configurable:true,value:mockStorage()});
            window.__mockCaptures=captures;
            window.fetch=async (url,opts={})=>{
                const path=new URL(url).pathname;
                let value=null;
                if(path==='/auth/v1/token')value={access_token:'testtoken',refresh_token:'testrefresh',expires_in:3600,user:{id:'user1'}};
                else if(path==='/auth/v1/user')value={id:'user1',email:'test@example.com'};
                else if(path==='/rest/v1/sr_web_access')value=[{user_id:'user1',can_delete:true}];
                else if(path==='/rest/v1/sr_web_accounts_summary')value=accounts;
                else if(path==='/rest/v1/sr_web_captures')value=window.__mockCaptures;
                else if(path==='/rest/v1/rpc/sr_delete_capture'){
                    const id=JSON.parse(opts.body).message_id;
                    window.__mockCaptures=window.__mockCaptures.filter(c=>c.discord_message_id!==id);
                    value=true;
                }
                else if(path.startsWith('/storage/v1/object/sign/'))value=[];
                else throw new Error('Unexpected request '+url);
                return {ok:true,status:200,json:async()=>value};
            };
        }""" , [ACCOUNTS, CAPTURES])
        source=(ROOT/'app.js').read_text()
        source=source.replace("import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_STORAGE_BUCKET } from './config.js';",
          "const SUPABASE_URL='https://test.supabase.co'; const SUPABASE_PUBLISHABLE_KEY='sb_publishable_fake_test_key_12345'; const SUPABASE_STORAGE_BUCKET='shiny-register';")
        page.add_script_tag(content=source)
        page.locator('#loginEmail').fill('test@example.com')
        page.locator('#loginPassword').fill('12345678')
        page.locator('#loginButton').click()
        page.locator('.inventory-card').first.wait_for()
        assert page.locator('.inventory-card').count()==2,'una sola ficha Giratina + una sola Buizel'
        giratina=page.locator('.inventory-card').filter(has_text='Giratina')
        assert giratina.count()==1
        assert '2' in giratina.locator('.card-quantity').inner_text()
        page.locator('[data-filter="shiny"]').click()
        page.locator('[data-filter="fondo"]').click()
        assert page.locator('.inventory-card').count()==1,'Shiny + fondo combinan por intersección'
        assert 'Giratina' in page.locator('.inventory-card').inner_text()
        assert '1' in page.locator('.inventory-card .card-quantity').inner_text()
        page.locator('[data-clear-filters]').click()
        page.locator('.inventory-card').filter(has_text='Giratina').click()
        assert page.locator('.inventory-capture').count()==2
        assert page.locator('.capture-delete').count()==2
        page.locator('.capture-delete').first.click()
        page.wait_for_function('window.__mockCaptures.length===2')
        assert page.locator('.inventory-card').count()==2
        page.locator('[data-view="cuentas"]').first.click()
        page.locator('.account-card').first.wait_for()
        page.locator('.account-card').last.click()
        page.locator('.inventory-card').first.wait_for()
        assert not js_errors,js_errors
        browser.close()


if __name__=='__main__':
    run_ui_test()
    print('Web OK: Giratina unificado, filtros combinados, borrado individual y cuentas.')
