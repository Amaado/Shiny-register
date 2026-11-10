import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_STORAGE_BUCKET } from './config.js';

// Sin dependencias externas: Supabase Auth, PostgREST y Storage mediante su API HTTPS.
const $ = (selector) => document.querySelector(selector);
const els = {
  login: $('#loginScreen'), loginForm: $('#loginForm'), loginButton: $('#loginButton'),
  loginError: $('#loginError'), app: $('#appShell'), main: $('#mainContent'),
  title: $('#pageTitle'), description: $('#pageDescription'), breadcrumb: $('#breadcrumb'),
  stats: $('#statsGrid'), toolbar: $('#contentToolbar'), search: $('#searchInput'),
  filters: $('#filterGroup'), sectionTitle: $('#sectionTitle'), sectionCount: $('#sectionCount'),
  switcher: $('#viewSwitcher'), grid: $('#contentGrid'), footer: $('#listFooter'),
  navAccountCount: $('#navAccountCount'), sidebarUser: $('#sidebarUser'),
  drawer: $('#detailDrawer'), drawerContent: $('#drawerContent'), backdrop: $('#drawerBackdrop'),
};
// Un registro persistente solo si el usuario marca «Mantener sesión iniciada».
const STORAGE_SESSION = 'shiny-register-web-session-v2';
const LEGACY_SESSION = 'shiny-register-web-session-v1';
let sessionPersistence = 'session';
let authMode = 'login';
const BUCKET = SUPABASE_STORAGE_BUCKET || 'shiny-register';
const BASE = String(SUPABASE_URL || '').replace(/\/+$/, '');
const PUBLIC_KEY = String(SUPABASE_PUBLISHABLE_KEY || '');
const PAGE_SIZE = 500;
const DISPLAY_STEP = 48;
const FALLBACK = './assets/placeholder.svg';
const number = new Intl.NumberFormat('es-ES');
const state = {
  session: null, user: null, accounts: [], variants: [],
  view: 'inventario', filters: new Set(), search: '', canDelete: false, captures: [], drawerLimit: 50,
  visibleCount: DISPLAY_STEP, visibleItems: [], selectedAccount: null,
  accountItems: [], drawerVariants: [], drawerRequest: 0,
};
const imageCache = new Map();
let refreshPromise = null;
let loadGeneration = 0;

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}
function norm(value) { return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function format(n) { return number.format(Number(n) || 0); }
function amount(n) { return Number(n) || 0; }
function safeImagePath(path) {
  return typeof path === 'string' && path.length < 512 && !path.startsWith('/') &&
    !path.includes('..') && !path.includes('\\') && !/^https?:/i.test(path) ? path : null;
}
function safeDiscordLink(value) {
  try { const url = new URL(value); return url.protocol === 'https:' &&
    (url.hostname === 'discord.com' || url.hostname === 'www.discord.com') ? url.href : null; }
  catch { return null; }
}
function dateLabel(value) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 'Fecha desconocida' : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(timestamp);
}
function configIsValid() {
  try { const url = new URL(BASE); return url.protocol === 'https:' &&
    !url.hostname.includes('tu-proyecto') && PUBLIC_KEY.length > 18 && !PUBLIC_KEY.startsWith('TU_'); }
  catch { return false; }
}
function credentialsHeaders(token = null) {
  return { 'apikey': PUBLIC_KEY, ...(token ? { 'Authorization': `Bearer ${token}` } : {}) };
}
async function fetchJSON(path, { method = 'GET', body = null, authenticated = true, retry = true } = {}) {
  if (authenticated) await ensureToken();
  const response = await fetch(BASE + path, {
    method,
    headers: { ...credentialsHeaders(authenticated ? state.session?.access_token : null),
      ...(body !== null ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });
  if (response.status === 401 && authenticated && retry && state.session?.refresh_token) {
    await refreshSession();
    return fetchJSON(path, { method, body, authenticated, retry: false });
  }
  let value;
  try { value = await response.json(); } catch { value = null; }
  if (!response.ok) throw new Error(value?.message || value?.msg || value?.error_description || value?.error || `Error HTTP ${response.status}`);
  return value;
}
function saveSession(value) {
  if (!value?.access_token || !value?.refresh_token) throw new Error('Sesión de Supabase incompleta.');
  state.session = {
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    token_type: 'bearer',
    user_id: value.user?.id || value.user_id || state.session?.user_id || null,
    expires_at: Date.now() + Math.max(0, (Number(value.expires_in) || 3600) - 30) * 1000,
  };
  // Nunca conservar la contraseña. Únicamente tokens de sesión de Supabase.
  const destination = sessionPersistence === 'local' ? localStorage : sessionStorage;
  const other = sessionPersistence === 'local' ? sessionStorage : localStorage;
  destination.setItem(STORAGE_SESSION, JSON.stringify(state.session));
  other.removeItem(STORAGE_SESSION);
}
function clearSession() {
  localStorage.removeItem(STORAGE_SESSION);
  sessionStorage.removeItem(STORAGE_SESSION);
  localStorage.removeItem(LEGACY_SESSION);
  state.session = null; state.user = null; state.canDelete = false; imageCache.clear();
}
function restoreStoredSession() {
  // Las sesiones de versiones anteriores (Google / persistencia obligatoria) no se migran.
  localStorage.removeItem(LEGACY_SESSION);
  for (const [storage, mode] of [[localStorage, 'local'], [sessionStorage, 'session']]) {
    try {
      const saved = JSON.parse(storage.getItem(STORAGE_SESSION) || 'null');
      if (saved?.refresh_token && saved?.access_token) {
        state.session = saved;
        sessionPersistence = mode;
        $('#rememberSession').checked = mode === 'local';
        return true;
      }
    } catch { /* Ignorar datos corruptos. */ }
    storage.removeItem(STORAGE_SESSION);
  }
  return false;
}
async function refreshSession() {
  if (!state.session?.refresh_token) throw new Error('La sesión ha caducado. Vuelve a entrar.');
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const fresh = await fetchJSON('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: state.session.refresh_token }, authenticated: false,
      });
      saveSession({ ...state.session, ...fresh });
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}
async function ensureToken() {
  if (!state.session) throw new Error('Inicia sesión para continuar.');
  if (Date.now() >= (state.session.expires_at || 0)) await refreshSession();
}
function setAuthMessage(message = '', type = 'error') {
  els.loginError.textContent = type === 'error' ? message : '';
  $('#authNotice').textContent = type === 'success' ? message : '';
}
function setAuthMode(mode) {
  authMode = mode === 'register' ? 'register' : 'login';
  const registering = authMode === 'register';
  $('#loginTitle').innerHTML = registering
    ? 'Crea tu cuenta.<br /><span>Organiza tu colección.</span>'
    : 'Todo lo que has capturado.<br /><span>En un solo lugar.</span>';
  $('#authIntro').textContent = registering
    ? 'Regístrate con tu correo y contraseña para solicitar acceso al inventario.'
    : 'Tus Pokémon, sus variantes y las cuentas en las que están. Sin complicaciones.';
  $('#registerPrompt').textContent = registering ? '¿Ya tienes una cuenta?' : '¿No tienes cuenta?';
  $('#toggleRegister').textContent = registering ? 'Iniciar sesión' : 'Registrarse';
  $('#confirmPasswordGroup').hidden = !registering;
  $('#confirmPassword').required = registering;
  $('#loginPassword').autocomplete = registering ? 'new-password' : 'current-password';
  els.loginButton.textContent = registering ? 'Crear cuenta' : 'Entrar';
  setAuthMessage();
}
function extractEmailConfirmation() {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const returnedError = fragment.get('error_description') || query.get('error_description') ||
    fragment.get('error') || query.get('error');
  if (returnedError) {
    window.history.replaceState(null, '', window.location.pathname);
    throw new Error(`No se ha podido confirmar el correo: ${returnedError}`);
  }
  const access_token = fragment.get('access_token');
  const refresh_token = fragment.get('refresh_token');
  if (!access_token && !refresh_token) return false;
  // Quitar los tokens del URL inmediatamente tras la confirmación por email.
  window.history.replaceState(null, '', window.location.pathname);
  sessionPersistence = 'session'; // El checkbox únicamente se selecciona en el login explícito.
  $('#rememberSession').checked = false;
  saveSession({ access_token, refresh_token, expires_in: fragment.get('expires_in') });
  return true;
}
async function register(email, password) {
  // email_redirect_to debe existir en la lista de Redirect URLs de Supabase.
  const redirect = encodeURIComponent(`${window.location.origin}${window.location.pathname}`);
  const result = await fetchJSON(`/auth/v1/signup?redirect_to=${redirect}`, {
    method: 'POST', authenticated: false, body: { email, password }
  });
  $('#loginPassword').value = '';
  $('#confirmPassword').value = '';
  if (result?.access_token && result?.refresh_token) {
    // Cuando no se exige confirmar correo, el alta puede devolver sesión.
    sessionPersistence = $('#rememberSession').checked ? 'local' : 'session';
    saveSession(result);
    try {
      await authorize();
      showApp(); await loadAll();
      return;
    } catch (error) {
      clearSession();
      if (error.code !== 'PENDING_ACCESS') throw error;
    }
  }
  setAuthMode('login');
  setAuthMessage('Solicitud de registro recibida. Si Supabase te envía un correo, confírmalo. El acceso al inventario necesitará autorización.', 'success');
}
async function login(email, password) {
  const session = await fetchJSON('/auth/v1/token?grant_type=password', {
    method: 'POST', authenticated: false, body: { email, password }
  });
  saveSession(session);
  try { await authorize(); } catch (e) { clearSession(); throw e; }
  $('#loginPassword').value = '';
  showApp();
  await loadAll();
}
async function authorize() {
  state.user = await fetchJSON('/auth/v1/user');
  if (!state.user?.id) throw new Error('No se pudo verificar el usuario de Supabase.');
  const allowed = await rest('sr_web_access', { select: 'user_id,can_delete', user_id: `eq.${state.user.id}`, limit: '1' });
  if (!Array.isArray(allowed) || !allowed.length) {
    const error = new Error(`Cuenta ${state.user.email || ''} registrada, pero pendiente de autorización. Usa sql/02_authorize_user.sql para darle acceso al inventario.`);
    error.code = 'PENDING_ACCESS';
    throw error;
  }
  state.canDelete = allowed[0].can_delete === true;
}
async function logout() {
  try { if (state.session) await fetchJSON('/auth/v1/logout', { method: 'POST' }); } catch { /* Cerrar también sin conexión. */ }
  clearSession(); state.accounts = []; state.variants = []; hideDrawer();
  els.app.hidden = true; els.login.hidden = false; $('#loginPassword').value = '';
  $('#confirmPassword').value = ''; $('#rememberSession').checked = false; setAuthMode('login');
}
function rest(name, params = {}) {
  const query = new URLSearchParams(params);
  return fetchJSON(`/rest/v1/${encodeURIComponent(name)}?${query.toString()}`);
}
async function allRows(view, order) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await rest(view, { select: '*', order, limit: String(PAGE_SIZE), offset: String(offset) });
    if (!Array.isArray(page)) throw new Error(`Respuesta inesperada al consultar ${view}.`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}
function showApp() {
  els.login.hidden = true;
  els.app.hidden = false;
  els.sidebarUser.textContent = state.user?.email || '';
}
function statCard(label,value,note,featured=false){
  return `<div class="stat-card${featured?' featured':''}"><div class="stat-label">${escapeHTML(label)}<svg class="icon stat-icon"><use href="#i-layers"></use></svg></div><div class="stat-number">${format(value)}</div><div class="stat-note">${escapeHTML(note)}</div></div>`;
}
function emptyState(title,body){return `<div class="empty-state"><h3>${escapeHTML(title)}</h3><p>${escapeHTML(body)}</p></div>`;}
function showLoading(){els.grid.className='content-grid';els.grid.innerHTML='<div class="loading-grid">'+Array.from({length:4},()=>'<div class="skeleton"></div>').join('')+'</div>';els.footer.innerHTML='';}
function showError(message){els.grid.className='content-grid';els.grid.innerHTML=`<div class="error-panel">${escapeHTML(message)}</div>`;els.footer.innerHTML='';}
async function loadAll(){
  const generation=++loadGeneration;
  showLoading(); $('#refreshButton').disabled=true;
  try{
    const [accounts,captures] = await Promise.all([
      allRows('sr_web_accounts_summary','total_captures.desc,username.asc'),
      allRows('sr_web_captures','captured_at.desc'),
    ]);
    if(generation!==loadGeneration)return;
    state.accounts=accounts;
    state.captures=captures;
    state.selectedAccount=null;
    state.visibleCount=DISPLAY_STEP;
    els.navAccountCount.textContent=format(accounts.filter(a=>a.account_id!=='unassigned').length);
    render();
  }catch(error){if(generation===loadGeneration)showError(error.message);}
  finally{$('#refreshButton').disabled=false;}
}
function displayName(account){
  if (!account||account.account_id==='unassigned')return 'Sin asignar';
  if (account.username)return account.username;
  if (account.trainer_name)return account.trainer_name;
  const key=account.account_key||'';
  return key.startsWith('username:')||key.startsWith('trainer:')?key.split(':').slice(1).join(':'):'Cuenta sin nombre';
}
function accountAvatar(account){const name=displayName(account);return `<span class="account-avatar">${escapeHTML(name.slice(0,1).toUpperCase())}</span>`;}
function tags(item){
  const labels=[];
  if(item.shiny)labels.push('<span class="property-tag shiny">✦ Shiny</span>');
  if(item.background)labels.push(`<span class="property-tag bg">${escapeHTML(item.background_name||'Fondo')}</span>`);
  if(item.gigantamax)labels.push('<span class="property-tag dmax">Gigamax</span>');
  else if(item.dynamax)labels.push('<span class="property-tag dmax">Dinamax</span>');
  if(item.shadow)labels.push('<span class="property-tag">Oscuro</span>');
  if(item.purified)labels.push('<span class="property-tag">Purificado</span>');
  return labels.join('') || '<span class="property-tag">Normal</span>';
}
function renderStats(){
  const captures=state.captures;
  const accounts=state.accounts.filter(a=>a.account_id!=='unassigned');
  const species=new Set(captures.filter(c=>c.pokemon_name).map(c=>norm(c.pokemon_name)));
  const pending=captures.filter(c=>c.status==='needs_review').length;
  els.stats.innerHTML=[
    statCard('Capturas',captures.length,'Ejemplares registrados',true),
    statCard('Pokémon',species.size,'Una ficha por nombre'),
    statCard('Cuentas',accounts.length,'Cuentas identificadas'),
    statCard('Pendientes',pending,pending?'Capturas para revisar':'Todo revisado'),
  ].join('');
}
function updateNav(){document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===state.view;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});}
function setView(view){
  if(!['inventario','cuentas'].includes(view))return;
  hideDrawer();state.view=view;state.search='';state.filters.clear();
  state.selectedAccount=null;state.visibleCount=DISPLAY_STEP;els.search.value='';render();window.scrollTo({top:0,behavior:'smooth'});
}
function matchesFilters(c){
  const f=state.filters;
  return (!f.has('shiny')||c.shiny===true)
    && (!f.has('fondo')||c.background===true)
    && (!f.has('dinamax')||c.dynamax===true||c.gigantamax===true)
    && (!f.has('gigamax')||c.gigantamax===true);
}
function filteredCaptures(){
  const q=norm(state.search.trim());
  return state.captures.filter(c=>{
    if(state.selectedAccount && (c.account_id||'unassigned')!==state.selectedAccount.account_id)return false;
    return matchesFilters(c) && (!q||norm([c.pokemon_name,c.form,c.costume,c.background_name].filter(Boolean).join(' ')).includes(q));
  });
}
function groupPokemon(rows){
  const items=new Map();
  for(const c of rows){
    const name=c.pokemon_name||'Sin identificar';
    const key=norm(name);
    if(!items.has(key))items.set(key,{name,captures:[],image_path:null,accounts:new Set(),shiny:false,background:false,dynamax:false,gigantamax:false});
    const group=items.get(key);group.captures.push(c);group.accounts.add(c.account_id||'unassigned');
    if(!group.image_path && c.image_path)group.image_path=c.image_path;
    if(!group.fallback_image_path && c.card_image_path)group.fallback_image_path=c.card_image_path;
    for(const flag of ['shiny','background','dynamax','gigantamax'])group[flag] ||= c[flag]===true;
  }
  return [...items.values()].sort((a,b)=>a.name.localeCompare(b.name,'es'));
}
function setupToolbar(){
  const showFilters=state.view==='inventario'||Boolean(state.selectedAccount);
  els.filters.hidden=!showFilters;els.switcher.hidden=true;
  els.toolbar.hidden=false;
  els.search.placeholder=state.view==='cuentas'&&!state.selectedAccount?'Buscar cuenta...':'Buscar Pokémon...';
  els.filters.innerHTML=[['shiny','Shiny'],['fondo','Con fondo'],['dinamax','Dinamax'],['gigamax','Gigamax']]
    .map(([id,label])=>`<button type="button" class="filter-chip ${state.filters.has(id)?'active':''}" data-filter="${id}" aria-pressed="${state.filters.has(id)}">${label}</button>`).join('')
    +(state.filters.size?'<button class="filter-chip filter-clear" type="button" data-clear-filters="true">Limpiar</button>':'');
}
function pokemonCard(item,index){
  const count=item.captures.length;
  const path=safeImagePath(item.image_path);
  const backup=safeImagePath(item.fallback_image_path);
  const img=`<img alt="" loading="lazy" src="${FALLBACK}"${path?` data-image-path="${escapeHTML(path)}"`:''}${backup&&backup!==path?` data-fallback-image-path="${escapeHTML(backup)}"`:''}>`;
  const filtered=state.filters.size>0;
  return `<button type="button" class="inventory-card" data-item-index="${index}" aria-label="Ver ${escapeHTML(item.name)}, ${format(count)} ejemplares">
    <div class="pokemon-art">${img}${item.shiny?'<span class="art-corner shiny">✦ SHINY</span>':''}</div>
    <div class="card-body"><div class="card-title-row"><h3 class="card-title">${escapeHTML(item.name)}</h3><span class="card-quantity">${format(count)}<small>uds.</small></span></div>
    <p class="card-subtitle">${filtered?'Coinciden con los filtros':'Todos los ejemplares'}</p>
    <div class="property-tags">${tags(item)}</div>
    <div class="card-footer"><span>${format(item.accounts.size)} ${item.accounts.size===1?'cuenta':'cuentas'}</span><span>Ver detalle <svg class="icon"><use href="#i-arrow"></use></svg></span></div></div></button>`;
}
function renderInventory(){
  const items=groupPokemon(filteredCaptures());state.visibleItems=items.slice(0,state.visibleCount);
  els.sectionTitle.textContent='Todos los Pokémon';
  els.sectionCount.textContent=`${format(items.length)} Pokémon únicos · ${format(items.reduce((s,x)=>s+x.captures.length,0))} ejemplares`;
  els.grid.className='content-grid';
  els.grid.innerHTML=state.visibleItems.length?state.visibleItems.map(pokemonCard).join(''):emptyState('Sin resultados','Prueba a desactivar algún filtro.');
  els.footer.innerHTML=items.length>state.visibleCount?`<button class="button button-outline" data-load-more type="button">Mostrar más (${format(items.length-state.visibleCount)})</button>`:'';
  hydrateImages();
}
function renderAccountList(){
  const q=norm(state.search.trim());
  const matched=state.accounts.filter(a=>a.account_id!=='unassigned'||amount(a.total_captures)>0).filter(a=>!q||norm([displayName(a),a.trainer_name,a.account_key].join(' ')).includes(q));
  els.sectionTitle.textContent='Todas las cuentas';els.sectionCount.textContent=`${format(matched.length)} cuentas`;
  els.grid.className='content-grid account-grid';
  els.grid.innerHTML=matched.length?matched.slice(0,state.visibleCount).map(a=>{
    const count=state.captures.filter(c=>(c.account_id||'unassigned')===a.account_id);
    const n=new Set(count.filter(c=>c.pokemon_name).map(c=>norm(c.pokemon_name))).size;
    return `<button type="button" class="account-card" data-account-id="${escapeHTML(a.account_id)}">${accountAvatar(a)}<div class="account-card-info"><h3>${escapeHTML(displayName(a))}</h3><p><strong>${format(count.length)}</strong> capturas · ${format(n)} Pokémon</p></div><svg class="icon"><use href="#i-arrow"></use></svg></button>`;
  }).join(''):emptyState('No hay cuentas','Las capturas aparecerán cuando el bot las registre.');
  els.footer.innerHTML=matched.length>state.visibleCount?`<button class="button button-outline" data-load-more type="button">Mostrar más</button>`:'';
}
function selectAccount(id){
  const account=state.accounts.find(a=>a.account_id===id);if(!account)return;
  state.selectedAccount=account;state.visibleCount=DISPLAY_STEP;state.search='';state.filters.clear();els.search.value='';render();
}
function renderAccountDetail(){
  const account=state.selectedAccount;
  const items=groupPokemon(filteredCaptures());state.visibleItems=items.slice(0,state.visibleCount);
  els.sectionTitle.textContent='Pokémon de esta cuenta';
  els.sectionCount.textContent=`${format(items.length)} Pokémon · ${format(items.reduce((n,x)=>n+x.captures.length,0))} ejemplares`;
  els.grid.className='content-grid';
  const total=state.captures.filter(c=>(c.account_id||'unassigned')===account.account_id).length;
  els.grid.innerHTML=`<div class="account-detail"><button class="back-link" data-back-accounts type="button"><svg class="icon icon-sm"><use href="#i-back"></use></svg> Volver a cuentas</button><div class="account-hero">${accountAvatar(account)}<div><h2>${escapeHTML(displayName(account))}</h2><p>Inventario de esta cuenta</p></div><div class="hero-count">${format(total)}<small>capturas</small></div></div></div>`
    +(state.visibleItems.length?state.visibleItems.map(pokemonCard).join(''):emptyState('Sin resultados','No hay Pokémon que coincidan con esos filtros.'));
  els.footer.innerHTML=items.length>state.visibleCount?`<button class="button button-outline" data-load-more type="button">Mostrar más</button>`:'';
  hydrateImages();
}
function render(){
  updateNav();renderStats();setupToolbar();
  const accountView=state.view==='cuentas';
  els.title.textContent=accountView?'Cuentas':'Inventario';
  els.description.textContent=accountView?'Qué Pokémon tiene cada cuenta.':'Un Pokémon, una ficha. Todas sus capturas dentro.';
  els.breadcrumb.innerHTML=`Tu colección <svg class="icon icon-xs"><use href="#i-arrow"></use></svg> ${accountView?'Cuentas':'Inventario'}`;
  if(accountView&&state.selectedAccount)renderAccountDetail();else if(accountView)renderAccountList();else renderInventory();
}
async function signImages(paths){
  const unique=[...new Set(paths.filter(safeImagePath))].filter(p=>!imageCache.get(p)||imageCache.get(p).expires<Date.now());
  for(let i=0;i<unique.length;i+=35){
    const batch=unique.slice(i,i+35);
    try{
      const response=await fetchJSON(`/storage/v1/object/sign/${encodeURIComponent(BUCKET)}`,{method:'POST',body:{expiresIn:3600,paths:batch}});
      if(!Array.isArray(response))continue;
      for(const item of response){
        const path=item.path,signed=item.signedURL||item.signedUrl;
        if(!path||!signed||item.error)continue;
        let url;
        if(signed.startsWith('https://'))url=signed;
        else if(signed.startsWith('/storage/v1/'))url=BASE+signed;
        else if(signed.startsWith('/object/'))url=BASE+'/storage/v1'+signed;
        else continue;
        const parsed=new URL(url);if(parsed.origin!==new URL(BASE).origin)continue;
        imageCache.set(path,{url:parsed.href,expires:Date.now()+45*60*1000});
      }
    }catch(error){console.warn('Error al firmar imágenes:',error.message);}
  }
}
async function hydrateImages(){
  const nodes=[...document.querySelectorAll('img[data-image-path],img[data-fallback-image-path]')];
  const paths=[];
  for(const img of nodes){
    if(img.dataset.imagePath)paths.push(img.dataset.imagePath);
    if(img.dataset.fallbackImagePath)paths.push(img.dataset.fallbackImagePath);
  }
  await signImages(paths);
  for(const img of nodes){
    if(!img.isConnected)continue;
    const primary=imageCache.get(img.dataset.imagePath);
    const backup=imageCache.get(img.dataset.fallbackImagePath);
    const primaryUrl=primary&&primary.expires>Date.now()?primary.url:null;
    const backupUrl=backup&&backup.expires>Date.now()?backup.url:null;
    img.addEventListener('error',()=>{
      if(backupUrl&&img.src!==backupUrl){img.src=backupUrl;return;}
      img.src=FALLBACK;
    });
    img.src=primaryUrl||backupUrl||FALLBACK;
  }
}

function openDrawer(content){els.drawerContent.innerHTML=content;els.drawer.hidden=false;els.backdrop.hidden=false;document.body.style.overflow='hidden';hydrateImages();}
function hideDrawer(){++state.drawerRequest;els.drawer.hidden=true;els.backdrop.hidden=true;document.body.style.overflow='';}
function drawerHeader(){return `<button type="button" class="icon-button drawer-close" data-close-drawer aria-label="Cerrar detalles"><svg class="icon"><use href="#i-close"></use></svg></button>`;}
function drawerArt(item){const path=safeImagePath(item.image_path),backup=safeImagePath(item.fallback_image_path);return `<div class="drawer-art"><img alt="${escapeHTML(item.name)}" src="${FALLBACK}"${path?` data-image-path="${escapeHTML(path)}"`:''}${backup&&backup!==path?` data-fallback-image-path="${escapeHTML(backup)}"`:''}></div>`;}
function drawerNum(label,num){return `<div class="drawer-number"><strong>${format(num)}</strong><span>${escapeHTML(label)}</span></div>`;}
function captureTags(c){return [c.form?`Forma: ${c.form}`:null,c.shiny?'Shiny':null,c.background?`Fondo${c.background_name?' '+c.background_name:''}`:'Sin fondo',c.gigantamax?'Gigamax':c.dynamax?'Dinamax':null,c.size?`Tamaño ${c.size}`:null].filter(Boolean).join(' · ');}
function captureRow(c){
  const account=state.accounts.find(a=>a.account_id===(c.account_id||'unassigned'));
  const name=displayName(account);
  const pc=c.cp===null?'PC —':`PC ${format(c.cp)}`;
  const iv=c.iv_percent===null?'IV —':`IV ${format(c.iv_percent)}%`;
  const indiv=[c.iv_attack,c.iv_defense,c.iv_stamina].every(v=>v!==null) ? ` (${c.iv_attack}/${c.iv_defense}/${c.iv_stamina})` : '';
  const level=c.pokemon_level===null?'Nivel —':`Nivel ${c.pokemon_level}`;
  const link=safeDiscordLink(c.discord_jump_url);
  return `<div class="capture-row inventory-capture"><div class="capture-row-main"><strong>${escapeHTML(name)} · ${escapeHTML(dateLabel(c.captured_at))}</strong><span>${escapeHTML(pc+' · '+iv+indiv+' · '+level)}</span><span class="capture-properties">${escapeHTML(captureTags(c))}</span></div><div class="capture-actions">${link?`<a title="Ver mensaje en Discord" target="_blank" rel="noopener noreferrer" href="${escapeHTML(link)}"><svg class="icon"><use href="#i-external"></use></svg></a>`:''}${state.canDelete?`<button type="button" class="capture-delete" data-delete-capture="${escapeHTML(c.discord_message_id)}" aria-label="Eliminar captura de ${escapeHTML(c.pokemon_name||'desconocido')}" title="Eliminar esta captura"><svg class="icon"><use href="#i-trash"></use></svg></button>`:''}</div></div>`;
}
function openPokemon(item){state.drawerLimit=50;state.drawerPokemon=item.name;renderDrawerPokemon();}
function renderDrawerPokemon(){
  const name=state.drawerPokemon;
  // Aquí se muestran TODOS los ejemplares del Pokémon de la cuenta seleccionada,
  // aunque en el listado hubiera filtros activos. El contador no se duplica.
  const all=state.captures.filter(c=>(c.pokemon_name||'Sin identificar')===name&&(!state.selectedAccount||(c.account_id||'unassigned')===state.selectedAccount.account_id));
  const items=groupPokemon(all),item=items[0];if(!item){hideDrawer();return;}
  const locations=new Map();for(const c of all){const k=c.account_id||'unassigned';locations.set(k,(locations.get(k)||0)+1);}
  const list=[...locations].sort((a,b)=>b[1]-a[1]).map(([id,count])=>{
    const acct=state.accounts.find(a=>a.account_id===id)||{account_id:'unassigned'};
    return `<div class="drawer-account">${accountAvatar(acct)}<span class="drawer-account-name">${escapeHTML(displayName(acct))}</span><strong class="drawer-account-count">×${format(count)}</strong></div>`;
  }).join('');
  const visible=all.slice(0,state.drawerLimit);
  openDrawer(drawerHeader()+drawerArt(item)+`<div class="drawer-body"><p class="drawer-eyebrow">FICHA DEL POKÉMON</p><h2 class="drawer-title">${escapeHTML(name)}</h2><p class="drawer-subtitle">Un solo Pokémon, cada captura con sus propios atributos.</p><div class="drawer-numbers">${drawerNum('Ejemplares totales',all.length)}${drawerNum('Cuentas',locations.size)}</div><section class="drawer-section"><div class="drawer-heading"><h3>¿Dónde lo tengo?</h3></div>${list}</section><section class="drawer-section"><div class="drawer-heading"><h3>Capturas individuales</h3><small>${format(all.length)}</small></div>${visible.map(captureRow).join('')}${all.length>visible.length?`<button class="button button-outline capture-more" data-drawer-more type="button">Mostrar más (${format(all.length-visible.length)})</button>`:''}</section></div>`);
}
async function deleteCapture(id){
  if(!state.canDelete)return;
  const capture=state.captures.find(c=>c.discord_message_id===id);if(!capture)return;
  const account=state.accounts.find(a=>a.account_id===(capture.account_id||'unassigned'));
  if(!window.confirm(`¿Eliminar esta captura de ${capture.pokemon_name||'Pokémon desconocido'} de la cuenta ${displayName(account)}?\n\nSe eliminará del inventario y no se volverá a importar desde Discord.`))return;
  const button=els.drawerContent.querySelector(`[data-delete-capture="${id}"]`);
  if(button)button.disabled=true;
  try{
    const removed=await fetchJSON('/rest/v1/rpc/sr_delete_capture',{method:'POST',body:{message_id:id}});
    if(removed!==true)throw new Error('La captura ya no estaba disponible.');
    hideDrawer();await loadAll();
  }catch(error){window.alert(`No se ha podido borrar la captura: ${error.message}`);if(button&&button.isConnected)button.disabled=false;}
}

$('#toggleRegister').addEventListener('click',()=>setAuthMode(authMode==='register'?'login':'register'));
els.loginForm.addEventListener('submit',async(event)=>{
  event.preventDefault();setAuthMessage();if(!els.loginForm.reportValidity())return;
  const email=$('#loginEmail').value.trim(),password=$('#loginPassword').value,registering=authMode==='register';
  els.loginButton.disabled=true;els.loginButton.textContent=registering?'Creando cuenta...':'Entrando...';
  try{
    if(!configIsValid())throw new Error('Falta configurar Supabase.');
    if(registering){if(password.length<8)throw new Error('Mínimo 8 caracteres.');if(password!==$('#confirmPassword').value)throw new Error('Las contraseñas no coinciden.');await register(email,password);}
    else{sessionPersistence=$('#rememberSession').checked?'local':'session';await login(email,password);}
  }catch(error){setAuthMessage(error.message);}finally{els.loginButton.disabled=false;els.loginButton.textContent=authMode==='register'?'Crear cuenta':'Entrar';}
});
document.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>setView(btn.dataset.view)));
$('#logoutButton').addEventListener('click',logout);
$('#refreshButton').addEventListener('click',loadAll);
els.search.addEventListener('input',()=>{state.search=els.search.value;state.visibleCount=DISPLAY_STEP;render();});
els.filters.addEventListener('click',event=>{
  if(event.target.closest('[data-clear-filters]'))state.filters.clear();
  else{const btn=event.target.closest('[data-filter]');if(!btn)return;const id=btn.dataset.filter;if(state.filters.has(id))state.filters.delete(id);else state.filters.add(id);}
  state.visibleCount=DISPLAY_STEP;render();
});
els.grid.addEventListener('click',event=>{
  const account=event.target.closest('[data-account-id]');if(account){selectAccount(account.dataset.accountId);return;}
  if(event.target.closest('[data-back-accounts]')){state.selectedAccount=null;state.search='';state.filters.clear();els.search.value='';render();return;}
  const btn=event.target.closest('[data-item-index]');if(btn){const item=state.visibleItems[Number(btn.dataset.itemIndex)];if(item)openPokemon(item);}
});
els.footer.addEventListener('click',event=>{if(event.target.closest('[data-load-more]')){state.visibleCount+=DISPLAY_STEP;render();}});
els.drawerContent.addEventListener('click',event=>{
  if(event.target.closest('[data-close-drawer]')){hideDrawer();return;}
  if(event.target.closest('[data-drawer-more]')){state.drawerLimit+=50;renderDrawerPokemon();return;}
  const btn=event.target.closest('[data-delete-capture]');if(btn)deleteCapture(btn.dataset.deleteCapture);
});
els.backdrop.addEventListener('click',hideDrawer);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!els.drawer.hidden)hideDrawer();});
(async()=>{
  if(!configIsValid()){setAuthMessage('Configura .env y vuelve a generar la web.');return;}
  try{
    const confirmed=extractEmailConfirmation();if(!confirmed&&!restoreStoredSession())return;
    await authorize();showApp();await loadAll();
  }catch(error){clearSession();els.app.hidden=true;els.login.hidden=false;setAuthMessage(error.code==='PENDING_ACCESS'?error.message:`No se pudo iniciar sesión. ${error.message}`);}
})();
