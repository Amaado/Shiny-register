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
const STORAGE_SESSION = 'shiny-register-web-session-v1';
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
  view: 'inventario', filter: 'todos', group: 'variantes', search: '',
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
  // Guardar solo tokens de SUPABASE, nunca tokens de la cuenta Google.
  state.session = {
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    token_type: 'bearer',
    user_id: value.user?.id || value.user_id || state.session?.user_id || null,
    expires_at: Date.now() + Math.max(0, (Number(value.expires_in) || 3600) - 30) * 1000,
  };
  localStorage.setItem(STORAGE_SESSION, JSON.stringify(state.session));
}
function clearSession() {
  localStorage.removeItem(STORAGE_SESSION);
  state.session = null; state.user = null; imageCache.clear();
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
function setAuthMode(mode) {
  authMode = mode === 'register' ? 'register' : 'login';
  const registering = authMode === 'register';
  $('#loginTitle').innerHTML = registering
    ? 'Crea tu cuenta.<br /><span>Empieza con Google.</span>'
    : 'Todo lo que has capturado.<br /><span>En un solo lugar.</span>';
  $('#authIntro').textContent = registering
    ? 'Regístrate sin crear una contraseña nueva. Tu acceso al inventario deberá ser autorizado.'
    : 'Tus Pokémon, sus variantes y las cuentas en las que están. Sin complicaciones.';
  $('#googleButtonLabel').textContent = registering ? 'Registrarme con Google' : 'Continuar con Google';
  $('#googleHelp').textContent = registering ? 'Google confirma tu identidad; después autorizas el acceso.' : 'Accede o regístrate con tu cuenta de Google.';
  $('#registerPrompt').textContent = registering ? '¿Ya tienes una cuenta?' : '¿No tienes cuenta?';
  $('#toggleRegister').textContent = registering ? 'Iniciar sesión' : 'Registrarme con Google';
  $('#loginForm').hidden = registering;
  $('#authDivider').hidden = registering;
  els.loginError.textContent = '';
}
function startGoogleAuth() {
  if (!configIsValid()) throw new Error('Falta la configuración pública. Genera la web con scripts/build.py y revisa tu .env.');
  // Google redirige al callback HTTPS de Supabase; Supabase vuelve a la URL autorizada de esta web.
  // La ubicación actual debe figurar en Supabase > Authentication > URL Configuration > Redirect URLs.
  const target = new URL('/auth/v1/authorize', BASE);
  target.searchParams.set('provider', 'google');
  target.searchParams.set('redirect_to', `${window.location.origin}${window.location.pathname}`);
  window.location.assign(target.toString());
}
function extractOAuthResult() {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const oauthError = fragment.get('error_description') || query.get('error_description') ||
    fragment.get('error') || query.get('error');
  if (oauthError) {
    window.history.replaceState(null, '', window.location.pathname);
    throw new Error(`No se ha completado el acceso con Google: ${oauthError}`);
  }
  const access_token = fragment.get('access_token');
  const refresh_token = fragment.get('refresh_token');
  if (!access_token && !refresh_token) return false;
  // Eliminar los tokens de la barra de direcciones antes de cualquier solicitud o renderizado.
  window.history.replaceState(null, '', window.location.pathname);
  if (!access_token || !refresh_token) throw new Error('Google ha devuelto una sesión incompleta. Vuelve a intentarlo.');
  saveSession({ access_token, refresh_token, expires_in: fragment.get('expires_in') });
  return true;
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
  const allowed = await rest('sr_web_access', { select: 'user_id', user_id: `eq.${state.user.id}`, limit: '1' });
  if (!Array.isArray(allowed) || !allowed.length) {
    const error = new Error(`Cuenta ${state.user.email || ''} registrada, pero pendiente de autorización. Usa sql/02_authorize_user.sql para darle acceso al inventario.`);
    error.code = 'PENDING_ACCESS';
    throw error;
  }
}
async function logout() {
  try { if (state.session) await fetchJSON('/auth/v1/logout', { method: 'POST' }); } catch { /* Cerrar también sin conexión. */ }
  clearSession(); state.accounts = []; state.variants = []; hideDrawer();
  els.app.hidden = true; els.login.hidden = false; $('#loginPassword').value = '';
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
  els.login.hidden = true; els.app.hidden = false;
  els.sidebarUser.textContent = state.user?.email || '';
}
function statCard(label, value, note, featured = false) {
  return `<div class="stat-card${featured ? ' featured' : ''}"><div class="stat-label">${escapeHTML(label)}<svg class="icon stat-icon"><use href="#i-layers"></use></svg></div><div class="stat-number">${format(value)}</div><div class="stat-note">${escapeHTML(note)}</div></div>`;
}
function emptyState(title, body) {
  return `<div class="empty-state"><svg class="icon"><use href="#i-search"></use></svg><h3>${escapeHTML(title)}</h3><p>${escapeHTML(body)}</p></div>`;
}
function showLoading() {
  els.grid.className = 'content-grid';
  els.grid.innerHTML = `<div class="loading-grid">${Array.from({length:4},()=>'<div class="skeleton"></div>').join('')}</div>`;
  els.footer.innerHTML = '';
}
function showError(message) {
  els.grid.className = 'content-grid';
  els.grid.innerHTML = `<div class="error-panel">${escapeHTML(message)}<br /><br />Comprueba el SQL de permisos, el acceso a Supabase y tu conexión.</div>`;
  els.footer.innerHTML = '';
}
async function loadAll() {
  const generation = ++loadGeneration;
  showLoading();
  $('#refreshButton').disabled = true;
  try {
    const [accounts, variants] = await Promise.all([
      allRows('sr_web_accounts_summary', 'total_captures.desc,username.asc'),
      allRows('sr_web_variants_summary', 'species.asc,form.asc'),
    ]);
    if (generation !== loadGeneration) return;
    state.accounts = accounts; state.variants = variants;
    els.navAccountCount.textContent = format(accounts.filter(a=>a.account_id!=='unassigned').length);
    state.selectedAccount = null; state.accountItems = [];
    render();
  } catch (error) { if (generation === loadGeneration) showError(error.message); }
  finally { $('#refreshButton').disabled = false; }
}
function renderStats() {
  const accounts = state.accounts.filter(a=>a.account_id!=='unassigned');
  const total = state.accounts.reduce((sum,a) => sum+amount(a.total_captures),0);
  const variants = state.variants.filter(v=>amount(v.total_captures)>0);
  const species = new Set(variants.map(v=>norm(v.species))).size;
  const pending = state.accounts.reduce((sum,a)=>sum+amount(a.needs_review),0);
  els.stats.innerHTML = [
    statCard('Capturas totales',total,'Entre todas tus cuentas',true),
    statCard('Especies',species,'Pokémon diferentes'),
    statCard('Variantes',variants.length,'Formas, fondos y especiales'),
    statCard('Cuentas',accounts.length,pending?`${format(pending)} capturas por revisar`:'Inventario sincronizado'),
  ].join('');
}
function updateNav() {
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === state.view;
    button.classList.toggle('active',active);
    if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
}
function setView(view) {
  if (!['inventario','cuentas'].includes(view)) return;
  hideDrawer(); state.view = view; state.search = ''; state.filter = 'todos';
  state.selectedAccount = null; state.accountItems = []; state.visibleCount = DISPLAY_STEP;
  els.search.value = '';
  render(); window.scrollTo({ top: 0, behavior:'smooth' });
}
function tags(item) {
  const tags = [];
  if (item.shiny) tags.push('<span class="property-tag shiny">✦ Shiny</span>');
  if (item.background) tags.push(`<span class="property-tag bg">${escapeHTML(item.background_name || 'Fondo')}</span>`);
  if (item.gigantamax) tags.push('<span class="property-tag dmax">Gigamax</span>');
  else if (item.dynamax) tags.push('<span class="property-tag dmax">Dinamax</span>');
  if (item.shadow) tags.push('<span class="property-tag">Oscuro</span>');
  if (item.purified) tags.push('<span class="property-tag">Purificado</span>');
  if (item.costume) tags.push(`<span class="property-tag">${escapeHTML(item.costume)}</span>`);
  return tags.join('') || '<span class="property-tag">Normal</span>';
}
function displayName(account) {
  if (!account) return 'Sin identificar';
  if (account.account_id === 'unassigned') return 'Sin asignar';
  if (account.username) return account.username;
  if (account.trainer_name) return account.trainer_name;
  const key = account.account_key || '';
  return key.startsWith('username:') || key.startsWith('trainer:') ? key.split(':').slice(1).join(':') : 'Cuenta sin nombre';
}
function accountAvatar(account) {
  const name = displayName(account);
  const orphan = account?.account_id === 'unassigned';
  return `<span class="account-avatar${orphan?' orphan':''}">${orphan?'?':escapeHTML(name.slice(0,1).toUpperCase())}</span>`;
}
function variantSubtitle(v) {
  return [v.form, v.gender, v.background_name && v.background ? `Fondo ${v.background_name}` : ''].filter(Boolean).join(' · ') || 'Forma base';
}
function variantCard(item,index) {
  const isSpecies = item._kind === 'species';
  const count = amount(item.quantity ?? item.total_captures);
  const image = safeImagePath(item.image_path);
  const img = `<img alt="" loading="lazy" src="${FALLBACK}"${image ? ` data-image-path="${escapeHTML(image)}"` : ''}>`;
  return `<button type="button" class="inventory-card" data-item-index="${index}" aria-label="Ver ${escapeHTML(item.species)}: ${format(count)} ejemplares">
    <div class="pokemon-art">${img}${item.shiny && !isSpecies ? '<span class="art-corner shiny">✦ SHINY</span>' : ''}</div>
    <div class="card-body"><div class="card-title-row"><h3 class="card-title">${escapeHTML(item.species || 'Sin identificar')}</h3><span class="card-quantity">${format(count)}<small>uds.</small></span></div>
    <p class="card-subtitle">${escapeHTML(isSpecies ? `${format(item.variants.length)} variantes` : variantSubtitle(item))}</p>
    <div class="property-tags">${isSpecies ? '<span class="property-tag">Todas las variantes</span>' : tags(item)}</div>
    <div class="card-footer"><span>${isSpecies ? `${format(item.variants.length)} variantes` : `${format(item.account_count ?? 0)} ${amount(item.account_count)===1?'cuenta':'cuentas'}`}</span><span>Ver detalle <svg class="icon"><use href="#i-arrow"></use></svg></span></div></div>
  </button>`;
}
function groupedSpecies(variants) {
  const groups = new Map();
  for (const v of variants) {
    const key = norm(v.species);
    if (!groups.has(key)) groups.set(key,{ _kind:'species', species:v.species, variants:[], total_captures:0, image_path:null });
    const group=groups.get(key); group.variants.push(v); group.total_captures+=amount(v.total_captures);
    if (!group.image_path && v.image_path) group.image_path=v.image_path;
  }
  return [...groups.values()].sort((a,b)=> a.species.localeCompare(b.species,'es'));
}
function filterVariants() {
  const query = norm(state.search.trim());
  return state.variants.filter(v => {
    if (amount(v.total_captures) === 0) return false;
    if (state.filter === 'shiny' && !v.shiny) return false;
    if (state.filter === 'fondo' && !v.background) return false;
    if (state.filter === 'dinamax' && !(v.dynamax || v.gigantamax)) return false;
    if (state.filter === 'gigamax' && !v.gigantamax) return false;
    return !query || norm([v.species,v.form,v.background_name,v.costume].filter(Boolean).join(' ')).includes(query);
  });
}
function setupToolbar() {
  els.filters.hidden = state.view !== 'inventario' || Boolean(state.selectedAccount);
  els.switcher.hidden = state.view !== 'inventario';
  els.toolbar.hidden = false;
  els.search.placeholder = state.view === 'cuentas' && !state.selectedAccount ? 'Buscar cuenta...' : 'Buscar Pokémon...';
  els.filters.innerHTML = [ ['todos','Todos'],['shiny','Shiny'],['fondo','Con fondo'],['dinamax','Dinamax'],['gigamax','Gigamax'] ].map(([id,label])=>
    `<button type="button" class="filter-chip ${state.filter===id?'active':''}" data-filter="${id}" aria-pressed="${state.filter===id}">${label}</button>`).join('');
  els.switcher.innerHTML = [['variantes','Variantes'],['especies','Especies']].map(([id,label])=>
    `<button type="button" class="${state.group===id?'active':''}" data-group="${id}" aria-pressed="${state.group===id}">${label}</button>`).join('');
}
function renderInventory() {
  const matched = filterVariants();
  const items = state.group==='especies' ? groupedSpecies(matched) : matched;
  state.visibleItems = items.slice(0,state.visibleCount);
  els.sectionTitle.textContent = state.group==='especies' ? 'Por especie' : 'Todos los Pokémon';
  els.sectionCount.textContent = `${format(items.length)} ${state.group==='especies'?'especies':'variantes'} encontradas`;
  els.grid.className='content-grid';
  els.grid.innerHTML = state.visibleItems.length ? state.visibleItems.map(variantCard).join('') : emptyState('Sin resultados','Prueba otra búsqueda o cambia el filtro.');
  els.footer.innerHTML = items.length>state.visibleCount ? `<button type="button" class="button button-outline" data-load-more>Mostrar más (${format(items.length-state.visibleCount)})</button>` : '';
  hydrateImages();
}
function renderAccountList() {
  const q=norm(state.search.trim());
  const matched=state.accounts.filter(a=>amount(a.total_captures)>0 || a.account_id!=='unassigned').filter(a=>!q || norm([displayName(a),a.trainer_name,a.account_key].join(' ')).includes(q));
  els.sectionTitle.textContent='Todas las cuentas';
  els.sectionCount.textContent=`${format(matched.length)} cuentas encontradas`;
  els.grid.className='content-grid account-grid';
  els.grid.innerHTML=matched.length?matched.slice(0,state.visibleCount).map(a=>`<button class="account-card" type="button" data-account-id="${escapeHTML(a.account_id)}">${accountAvatar(a)}<div class="account-card-info"><h3>${escapeHTML(displayName(a))}</h3><p><strong>${format(a.total_captures)}</strong> Pokémon · ${format(a.distinct_variants)} variantes</p></div><svg class="icon"><use href="#i-arrow"></use></svg></button>`).join('') : emptyState('No hay cuentas','Cuando el bot registre capturas, aparecerán aquí.');
  els.footer.innerHTML=matched.length>state.visibleCount?`<button class="button button-outline" type="button" data-load-more>Mostrar más (${format(matched.length-state.visibleCount)})</button>`:'';
}
async function selectAccount(accountId) {
  const account=state.accounts.find(a=>a.account_id===accountId);
  if (!account) return;
  state.selectedAccount=account; state.visibleCount=DISPLAY_STEP; state.search='';els.search.value='';
  render(); showLoading();
  try {
    const rows=await allRowsForAccount(accountId);
    if (state.selectedAccount?.account_id !== accountId) return;
    state.accountItems=rows;
    render();
  } catch (error) { showError(error.message); }
}
async function allRowsForAccount(accountId) {
  const query = accountId==='unassigned' ? 'eq.unassigned' : `eq.${accountId}`;
  const data=[];
  for (let offset=0;;offset+=PAGE_SIZE){
    const page=await rest('sr_web_item_locations',{select:'*',account_id:query,order:'quantity.desc',limit:String(PAGE_SIZE),offset:String(offset)});
    data.push(...page); if(page.length<PAGE_SIZE) return data;
  }
}
function renderAccountDetail() {
  const account=state.selectedAccount;
  const search=norm(state.search.trim());
  const lookup=new Map(state.variants.map(v=>[v.variant_key,v]));
  const items=state.accountItems.map(row=>({ ...(lookup.get(row.variant_key)||{species:'Sin identificar',form:null,shiny:false,background:false}),quantity:row.quantity,variant_key:row.variant_key,account_count:1 }))
    .filter(item=>!search || norm([item.species,item.form,item.costume].filter(Boolean).join(' ')).includes(search));
  state.visibleItems=items.slice(0,state.visibleCount);
  els.sectionTitle.textContent='Pokémon de esta cuenta';
  els.sectionCount.textContent=`${format(items.length)} variantes en esta cuenta`;
  els.grid.className='content-grid';
  els.grid.innerHTML=`<div class="account-detail"><button class="back-link" data-back-accounts type="button"><svg class="icon icon-sm"><use href="#i-back"></use></svg> Volver a cuentas</button><div class="account-hero">${accountAvatar(account)}<div><h2>${escapeHTML(displayName(account))}</h2><p>${escapeHTML(account.trainer_name&&account.username ? `Entrenador: ${account.trainer_name}`:'Tu colección de esta cuenta')}</p></div><div class="hero-count">${format(account.total_captures)}<small>capturas</small></div></div></div>${state.visibleItems.length?state.visibleItems.map(variantCard).join(''):emptyState('No hay Pokémon','Esta cuenta no tiene variantes registradas con ese filtro.')}`;
  els.footer.innerHTML=items.length>state.visibleCount?`<button class="button button-outline" type="button" data-load-more>Mostrar más (${format(items.length-state.visibleCount)})</button>`:'';
  hydrateImages();
}
function render() {
  updateNav();renderStats();setupToolbar();
  const accountView=state.view==='cuentas';
  els.title.textContent=accountView?'Cuentas':'Inventario';
  els.description.textContent=accountView?'Descubre qué contiene cada una de tus cuentas.':'Cada captura, cada forma, cada fondo. Todo en un lugar.';
  els.breadcrumb.innerHTML=`Tu colección <svg class="icon icon-xs"><use href="#i-arrow"></use></svg> ${accountView?'Cuentas':'Inventario'}`;
  if(accountView && state.selectedAccount){els.filters.hidden=true;els.switcher.hidden=true;renderAccountDetail();}
  else if(accountView) renderAccountList(); else renderInventory();
}
async function signImages(paths) {
  const unique=[...new Set(paths.filter(safeImagePath))].filter(p=> !imageCache.get(p) || imageCache.get(p).expires < Date.now());
  for(let i=0;i<unique.length;i+=35){
    const batch=unique.slice(i,i+35);
    try {
      const response=await fetchJSON(`/storage/v1/object/sign/${encodeURIComponent(BUCKET)}`,{method:'POST',body:{expiresIn:3600,paths:batch}});
      if(!Array.isArray(response)) continue;
      for(const item of response){
        const path=item.path;
        const signed=item.signedURL || item.signedUrl;
        if(!path || !signed || item.error) continue;
        let url;
        if (signed.startsWith('https://')) url=signed;
        else if (signed.startsWith('/storage/v1/')) url=BASE+signed;
        else if(signed.startsWith('/object/')) url=BASE+'/storage/v1'+signed;
        else continue;
        const parsed = new URL(url);
        if(parsed.origin!==new URL(BASE).origin) continue;
        imageCache.set(path,{url:parsed.href,expires:Date.now()+45*60*1000});
      }
    }catch(error){ console.warn('No se han podido firmar algunas imágenes:',error.message); }
  }
}
async function hydrateImages() {
  const nodes=[...document.querySelectorAll('img[data-image-path]')];
  const missing=[];
  for(const img of nodes){const path=img.dataset.imagePath;const cached=imageCache.get(path);
    if(cached && cached.expires>Date.now()) img.src=cached.url;else missing.push(path);
  }
  if(!missing.length)return;
  await signImages(missing);
  for(const img of nodes){if(!img.isConnected)return;const cached=imageCache.get(img.dataset.imagePath);
    if(cached && cached.expires>Date.now()){
      img.addEventListener('error',()=>{img.removeAttribute('data-image-path');img.src=FALLBACK;},{once:true});
      img.src=cached.url;
    }
  }
}
function openDrawer(content) {
  els.drawerContent.innerHTML=content;
  els.drawer.hidden=false;els.backdrop.hidden=false;
  document.body.style.overflow='hidden';
  hydrateImages();
}
function hideDrawer() {
  ++state.drawerRequest;
  els.drawer.hidden=true;els.backdrop.hidden=true;
  document.body.style.overflow='';
}
function drawerHeader() {
  return `<button type="button" class="icon-button drawer-close" data-close-drawer aria-label="Cerrar detalles"><svg class="icon"><use href="#i-close"></use></svg></button>`;
}
function drawerArt(variant) {
  const path=safeImagePath(variant.image_path);
  return `<div class="drawer-art"><img alt="${escapeHTML(variant.species)}" loading="eager" src="${FALLBACK}"${path?` data-image-path="${escapeHTML(path)}"`:''}></div>`;
}
function drawerNum(label,num){return `<div class="drawer-number"><strong>${format(num)}</strong><span>${escapeHTML(label)}</span></div>`;}
async function openVariant(variant) {
  if(!variant?.variant_key){
    openDrawer(drawerHeader()+`<div class="drawer-body"><h2 class="drawer-title">Sin identificar</h2><p class="muted">El bot no ha reconocido todavía qué Pokémon es. Comprueba el registro pendiente en Supabase.</p></div>`);
    return;
  }
  const request=++state.drawerRequest;
  openDrawer(drawerHeader()+drawerArt(variant)+`<div class="drawer-body"><p class="drawer-eyebrow">FICHA DEL POKÉMON</p><h2 class="drawer-title">${escapeHTML(variant.species)}</h2><p class="drawer-subtitle">${escapeHTML(variantSubtitle(variant))}</p><div class="drawer-tags">${tags(variant)}</div><div class="drawer-numbers">${drawerNum('Ejemplares totales',variant.total_captures)}${drawerNum('Cuentas',variant.account_count)}</div><div class="drawer-section"><div class="drawer-heading"><h3>¿Dónde lo tengo?</h3></div><div class="drawer-loading">Buscando las cuentas...</div></div></div>`);
  const locationsPromise=rest('sr_web_item_locations',{select:'*',variant_key:`eq.${variant.variant_key}`,order:'quantity.desc',limit:'500'});
  const capturesPromise=rest('sr_captures',{select:'discord_jump_url,captured_at,account_id,cp,iv_percent,pokemon_level,status',variant_key:`eq.${variant.variant_key}`,order:'captured_at.desc',limit:'8'});
  try {
    const [locations,captures]=await Promise.all([locationsPromise,capturesPromise]);
    if(request!==state.drawerRequest) return;
    const accounts=new Map(state.accounts.map(a=>[a.account_id,a]));
    const locationHTML=locations.length ? locations.map(loc=>{
      const account=accounts.get(loc.account_id)||{account_id:'unassigned'};
      return `<div class="drawer-account">${accountAvatar(account)}<span class="drawer-account-name">${escapeHTML(displayName(account))}</span><strong class="drawer-account-count">×${format(loc.quantity)}</strong></div>`;
    }).join('') : '<p class="muted">Todavía no hay cuentas asociadas.</p>';
    const capturesHTML=captures.length ? captures.map(c=>{
      const account=state.accounts.find(a=>a.account_id===c.account_id);
      const name=displayName(account);
      const iv=c.iv_percent===null?'IV sin dato':`IV ${format(c.iv_percent)}%`;
      const pc=c.cp===null?'PC sin dato':`PC ${format(c.cp)}`;
      const link=safeDiscordLink(c.discord_jump_url);
      return `<div class="capture-row"><div class="capture-row-main"><strong>${escapeHTML(name)} · ${escapeHTML(dateLabel(c.captured_at))}</strong><span>${escapeHTML(pc)} · ${escapeHTML(iv)}${c.pokemon_level!==null?` · Niv. ${escapeHTML(c.pokemon_level)}`:''}</span></div>${link?`<a title="Abrir en Discord" target="_blank" rel="noopener noreferrer" href="${escapeHTML(link)}"><svg class="icon"><use href="#i-external"></use></svg></a>`:''}</div>`;
    }).join(''):'<p class="muted">Sin capturas recientes.</p>';
    openDrawer(drawerHeader()+drawerArt(variant)+`<div class="drawer-body"><p class="drawer-eyebrow">FICHA DEL POKÉMON</p><h2 class="drawer-title">${escapeHTML(variant.species)}</h2><p class="drawer-subtitle">${escapeHTML(variantSubtitle(variant))}</p><div class="drawer-tags">${tags(variant)}</div><div class="drawer-numbers">${drawerNum('Ejemplares totales',variant.total_captures)}${drawerNum('Cuentas',variant.account_count)}</div><section class="drawer-section"><div class="drawer-heading"><h3>¿Dónde lo tengo?</h3><small>${format(locations.length)} cuentas</small></div>${locationHTML}</section><section class="drawer-section"><div class="drawer-heading"><h3>Últimas capturas</h3><small>Máximo 8</small></div>${capturesHTML}</section></div>`);
  }catch(error){if(request===state.drawerRequest)openDrawer(drawerHeader()+`<div class="drawer-body"><h2 class="drawer-title">${escapeHTML(variant.species)}</h2><div class="error-panel">${escapeHTML(error.message)}</div></div>`);}
}
function openSpecies(item) {
  state.drawerVariants=item.variants;
  const list=item.variants.map((v,i)=>`<button type="button" data-drawer-variant="${i}" class="drawer-account" style="width:100%;background:transparent;border-top:0;border-left:0;border-right:0;color:inherit;text-align:left;cursor:pointer"><span class="account-avatar">${v.shiny?'✦':'•'}</span><span class="drawer-account-name">${escapeHTML(variantSubtitle(v))}<br><span class="muted">${escapeHTML(v.shiny?'Shiny':'Normal')}</span></span><strong class="drawer-account-count">×${format(v.total_captures)}</strong><svg class="icon icon-sm"><use href="#i-arrow"></use></svg></button>`).join('');
  openDrawer(drawerHeader()+drawerArt(item)+`<div class="drawer-body"><p class="drawer-eyebrow">ESPECIE</p><h2 class="drawer-title">${escapeHTML(item.species)}</h2><p class="drawer-subtitle">Todas las variantes de este Pokémon.</p><div class="drawer-numbers">${drawerNum('Ejemplares',item.total_captures)}${drawerNum('Variantes',item.variants.length)}</div><section class="drawer-section"><div class="drawer-heading"><h3>Variantes registradas</h3></div>${list}</section></div>`);
}

$('#toggleRegister').addEventListener('click', () => setAuthMode(authMode === 'register' ? 'login' : 'register'));
$('#googleButton').addEventListener('click', () => {
  try { els.loginError.textContent = ''; startGoogleAuth(); }
  catch (error) { els.loginError.textContent = error.message; }
});
els.loginForm.addEventListener('submit',async(event)=>{
  event.preventDefault();els.loginError.textContent='';els.loginButton.disabled=true;
  els.loginButton.textContent='Comprobando acceso...';
  try {
    if(!configIsValid()) throw new Error('Falta configurar Supabase. Revisa el .env y vuelve a generar la web.');
    await login($('#loginEmail').value.trim(),$('#loginPassword').value);
  }catch(error){els.loginError.textContent=error.message;}
  finally{els.loginButton.disabled=false;els.loginButton.innerHTML='Entrar <svg class="icon icon-sm"><use href="#i-arrow"></use></svg>';}
});
document.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>setView(btn.dataset.view)));
$('#logoutButton').addEventListener('click',logout);
$('#refreshButton').addEventListener('click',loadAll);
els.search.addEventListener('input',()=>{state.search=els.search.value;state.visibleCount=DISPLAY_STEP;render();});
els.filters.addEventListener('click',(event)=>{const btn=event.target.closest('[data-filter]');if(!btn)return;state.filter=btn.dataset.filter;state.visibleCount=DISPLAY_STEP;render();});
els.switcher.addEventListener('click',(event)=>{const btn=event.target.closest('[data-group]');if(!btn)return;state.group=btn.dataset.group;state.visibleCount=DISPLAY_STEP;render();});
els.grid.addEventListener('click',(event)=>{
  const accountButton=event.target.closest('[data-account-id]');
  if(accountButton){selectAccount(accountButton.dataset.accountId);return;}
  const back=event.target.closest('[data-back-accounts]');
  if(back){state.selectedAccount=null;state.accountItems=[];state.search='';els.search.value='';state.visibleCount=DISPLAY_STEP;render();return;}
  const itemButton=event.target.closest('[data-item-index]');
  if(itemButton){const item=state.visibleItems[Number(itemButton.dataset.itemIndex)];
    if(item?._kind==='species') openSpecies(item);else if(item)openVariant(item);
  }
});
els.footer.addEventListener('click',(event)=>{if(event.target.closest('[data-load-more]')){state.visibleCount+=DISPLAY_STEP;render();}});
els.drawerContent.addEventListener('click',(event)=>{if(event.target.closest('[data-close-drawer]'))hideDrawer();const btn=event.target.closest('[data-drawer-variant]');if(btn){const item=state.drawerVariants[Number(btn.dataset.drawerVariant)];if(item)openVariant(item);}});
els.backdrop.addEventListener('click',hideDrawer);
document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&!els.drawer.hidden)hideDrawer();});

(async()=>{
  if(!configIsValid()) {els.loginError.textContent='Configura el archivo .env y ejecuta python3 scripts/build.py.';return;}
  try {
    const returnedFromGoogle = extractOAuthResult();
    if (!returnedFromGoogle) {
      const saved = JSON.parse(localStorage.getItem(STORAGE_SESSION) || 'null');
      if (!saved?.refresh_token) return;
      state.session = saved;
    }
    await authorize();showApp();await loadAll();
  }catch(error){
    clearSession();els.app.hidden=true;els.login.hidden=false;
    els.loginError.textContent = error.code === 'PENDING_ACCESS'
      ? error.message : `No se pudo iniciar sesión. ${error.message}`;
  }
})();
