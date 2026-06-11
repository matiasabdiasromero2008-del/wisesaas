// ─────────────────────────────────────────────────────────────────────────────
// WISE ERP – app.js v3.0 Multi-Tenant
// ─────────────────────────────────────────────────────────────────────────────
const API_URL = '';
let currentUser = null;
let allProviders = [], allIngredients = [], allClients = [], allStockProducts = [];
let currentCtr = 0, currentTotalIngresos = 0, currentTotalGtr = 0, currentTotalEgresos = 0, currentRna = 0;

// ─── Theme Toggle ─────────────────────────────────────────────────────────────
function toggleTheme() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    document.documentElement.setAttribute('data-theme', isLight ? '' : 'light');
    localStorage.setItem('wise_theme', isLight ? 'dark' : 'light');
}
(function() {
    const saved = localStorage.getItem('wise_theme');
    if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
})();

// ─── JWT Token Helpers ────────────────────────────────────────────────────────
function getToken() { return localStorage.getItem('wise_token'); }
function setToken(t) { localStorage.setItem('wise_token', t); }
function clearToken() { localStorage.removeItem('wise_token'); }

function authHeaders() {
    const t = getToken();
    return t ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` } : { 'Content-Type': 'application/json' };
}

async function apiFetch(path, options = {}) {
    const headers = { ...authHeaders(), ...(options.headers || {}) };
    const res = await fetch(`${API_URL}${path}`, { ...options, headers });
    if (res.status === 401) {
        clearToken();
        currentUser = null;
        showView('login-view');
        document.getElementById('login-error').textContent = 'Sesión expirada. Por favor iniciá sesión nuevamente.';
        throw new Error('Unauthorized');
    }
    return res;
}

// ─── View / Section Helpers ───────────────────────────────────────────────────
function showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}

function setNow(id) {
    const el = document.getElementById(id);
    if (el && !el.value) { const n = new Date(); n.setMinutes(n.getMinutes() - n.getTimezoneOffset()); el.value = n.toISOString().slice(0, 16); }
}

function switchSection(secId, title) {
    document.querySelectorAll('#dashboard-view .section').forEach(s => s.classList.remove('active'));
    const t = document.getElementById(secId); if (t) t.classList.add('active');
    document.getElementById('view-title').textContent = title.toUpperCase();
    if (secId === 'sec-performance') loadMetrics();
    if (secId === 'sec-ventas') { loadClientsDropdown(); loadStockDropdown(); loadSalesHistory(); setNow('sale-date'); }
    if (secId === 'sec-gastos') { loadCategories(); loadProvidersDropdown(); loadExpensesHistory(); setNow('exp-date'); if (expCont && expCont.children.length === 0) addExpRow(); }
    if (secId === 'sec-ingresos') { loadProductsDropdown('prodrun-product'); loadProductionHistory(); setNow('prodrun-date'); }
    if (secId === 'sec-clientes') loadClients();
    if (secId === 'sec-proveedores') { loadCategories(); loadProviders(); }
    if (secId === 'sec-escandallos') { loadIngredientsCache().then(() => { loadEscandalloTable(); if (escCont && escCont.children.length === 0) addEscRow(); }); }
    if (secId === 'sec-usuarios') loadUsers();
}

function showSASection(secId) {
    document.querySelectorAll('#superadmin-view .section').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(secId); if (el) el.classList.add('active');
    document.querySelectorAll('#superadmin-view .nav-link').forEach(l => l.classList.remove('sa-active'));
    const titles = { 'sa-tenants': 'GESTIÓN DE CUENTAS', 'sa-users': 'TODOS LOS USUARIOS' };
    document.getElementById('sa-view-title').textContent = titles[secId] || '';
    if (secId === 'sa-tenants') loadTenants();
    if (secId === 'sa-users') loadAllUsers();
}

// ─── Odómetro Premium ─────────────────────────────────────────────────────────
function animateNumberValue(id, start, end, duration = 800, prefix = '', suffix = '') {
    const obj = document.getElementById(id); if (!obj) return;
    const startNum = parseFloat(start), endNum = parseFloat(end);
    if (isNaN(startNum) || isNaN(endNum)) { obj.textContent = prefix + end + suffix; return; }
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const currentVal = progress * (endNum - startNum) + startNum;
        obj.textContent = prefix + currentVal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + suffix;
        if (progress < 1) window.requestAnimationFrame(step);
        else obj.textContent = prefix + endNum.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + suffix;
    };
    window.requestAnimationFrame(step);
}

// ─── Forgot / Reset Password ──────────────────────────────────────────────────
function showForgotPassword() { showView('forgot-view'); }

document.getElementById('forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value;
    const m = document.getElementById('forgot-msg');
    m.textContent = 'Enviando...'; m.className = '';
    const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    const data = await res.json();
    m.textContent = data.message || 'Enlace enviado. Revisá tu correo.';
    m.className = 'success-msg';
});

document.getElementById('reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = window.RESET_TOKEN;
    const newPassword = document.getElementById('reset-new-password').value;
    const confirm = document.getElementById('reset-confirm-password').value;
    const m = document.getElementById('reset-msg');
    if (newPassword !== confirm) { m.textContent = 'Las contraseñas no coinciden'; m.className = 'error-msg'; return; }
    const res = await fetch(`${API_URL}/auth/reset-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: newPassword })
    });
    if (res.ok) {
        m.textContent = '¡Contraseña cambiada! Redirigiendo...'; m.className = 'success-msg';
        setTimeout(() => { window.history.replaceState({}, '', '/'); showView('login-view'); }, 2000);
    } else {
        const d = await res.json(); m.textContent = d.detail || 'Error al resetear'; m.className = 'error-msg';
    }
});

// ─── Login ────────────────────────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';
    const res = await fetch(`${API_URL}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: document.getElementById('username').value, password: document.getElementById('password').value })
    });
    if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        currentUser = data;
        if (data.role === 'SuperAdmin') setupSuperAdmin();
        else setupDashboard();
    } else {
        errEl.textContent = 'ERROR DE ACCESO – Usuario o contraseña incorrectos';
    }
});

// ─── Logout ───────────────────────────────────────────────────────────────────
function doLogout() { clearToken(); currentUser = null; showView('login-view'); }
document.getElementById('logout-btn').addEventListener('click', doLogout);
document.getElementById('sa-logout-btn').addEventListener('click', doLogout);

// ─── Restore Session ──────────────────────────────────────────────────────────
(function restoreSession() {
    const token = getToken();
    if (!token) return;
    // Parse JWT payload (no verification, just restore UI state)
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp && Date.now() / 1000 > payload.exp) { clearToken(); return; }
        currentUser = { token, username: payload.username, role: payload.role, tenant_id: payload.tenant_id };
        if (payload.role === 'SuperAdmin') setupSuperAdmin();
        else setupDashboard();
    } catch (e) { clearToken(); }
})();

// ─── SuperAdmin Setup ─────────────────────────────────────────────────────────
function setupSuperAdmin() {
    document.getElementById('sa-user-display').textContent = currentUser.username.toUpperCase();
    showView('superadmin-view');
    showSASection('sa-tenants');
}

// ─── Tenant Management (SuperAdmin) ──────────────────────────────────────────
async function loadTenants() {
    const res = await apiFetch('/superadmin/tenants');
    const tenants = await res.json();
    const list = document.getElementById('tenants-list');
    if (!tenants.length) { list.innerHTML = '<p style="color:var(--text-muted);text-align:center;">No hay cuentas creadas todavía.</p>'; return; }
    list.innerHTML = tenants.map(t => `
        <div class="tenant-card">
            <div class="tenant-info">
                <h4>${t.name} <span class="tag ${t.is_active ? 'tag-green' : 'tag-red'}">${t.is_active ? 'ACTIVA' : 'PAUSADA'}</span></h4>
                <p>Usuarios: ${t.user_count} · Creada: ${t.created_at}</p>
            </div>
            <div class="tenant-actions">
                <button class="btn secondary outline btn-icon" onclick="toggleTenant(${t.id}, ${t.is_active}, '${t.name}')" title="${t.is_active ? 'Pausar Acceso' : 'Despausar Acceso'}">
                    <span class="material-symbols-outlined">${t.is_active ? 'pause_circle' : 'play_circle'}</span>
                </button>
                <button class="btn secondary outline btn-icon" onclick="changeTenantPassword(${t.id}, '${t.name}')" title="Cambiar Contraseña">
                    <span class="material-symbols-outlined">key</span>
                </button>
                <button class="btn secondary outline btn-icon" onclick="deleteTenant(${t.id}, '${t.name}')" title="Eliminar">
                    <span class="material-symbols-outlined">delete</span>
                </button>
            </div>
        </div>
    `).join('');
}

async function toggleTenant(id, currentActive, name) {
    const action = currentActive ? "PAUSAR" : "DESPAUSAR";
    if (!confirm(`¿Estás seguro que deseas ${action} el acceso a la cuenta "${name}"?`)) return;
    await apiFetch(`/superadmin/tenants/${id}`, { method: 'PUT', body: JSON.stringify({ is_active: !currentActive }) });
    loadTenants();
}

async function changeTenantPassword(id, name) {
    const newPass = prompt(`Ingresá la nueva contraseña para la cuenta "${name}":`);
    if (!newPass) return;
    if (newPass.length < 6) { alert("La contraseña debe tener al menos 6 caracteres"); return; }
    
    const res = await apiFetch(`/superadmin/tenants/${id}/password`, { 
        method: 'PUT', 
        body: JSON.stringify({ new_password: newPass }) 
    });
    if (res.ok) {
        alert("¡Contraseña cambiada exitosamente!");
    } else {
        const d = await res.json();
        alert(d.detail || 'Error al cambiar contraseña');
    }
}

async function deleteTenant(id, name) {
    if (!confirm(`¿Estás seguro que deseas ELIMINAR la cuenta "${name}" permanentemente? Esto borrará todas sus ventas, gastos e inventario.`)) return;
    
    const saPass = prompt(`Por seguridad, ingresá tu contraseña de SuperAdmin para confirmar la eliminación de "${name}":`);
    if (!saPass) return;

    const res = await apiFetch(`/superadmin/tenants/${id}/delete`, { 
        method: 'POST',
        body: JSON.stringify({ superadmin_password: saPass })
    });
    
    if (res.ok) {
        alert("Cuenta eliminada exitosamente.");
        loadTenants();
    } else {
        const d = await res.json();
        alert(d.detail || 'Error al eliminar la cuenta (Contraseña incorrecta u otro error)');
    }
}

document.getElementById('create-tenant-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = document.getElementById('create-tenant-msg');
    try {
        const payload = {
            username: document.getElementById('tenant-username').value.trim(),
            password: document.getElementById('tenant-password').value.trim()
        };
        m.textContent = 'Creando cuenta...'; m.className = '';
        const res = await apiFetch('/superadmin/tenants', { method: 'POST', body: JSON.stringify(payload) });
        
        let data;
        try { data = await res.json(); } catch(err) { data = { detail: "Error del servidor (no retornó JSON)" }; }
        
        if (res.ok) {
            m.textContent = data.message || "Cuenta creada exitosamente"; m.className = 'success-msg';
            e.target.reset(); loadTenants();
        } else {
            m.textContent = data.detail || 'Error al crear la cuenta'; m.className = 'error-msg';
        }
    } catch (error) {
        m.textContent = "Error de red o conexión: " + error.message; m.className = 'error-msg';
    }
});

async function loadAllUsers() {
    const res = await apiFetch('/superadmin/users');
    const users = await res.json();
    const roleColors = { SuperAdmin: 'tag-purple', Admin: 'tag-blue', Operator: 'tag-green' };
    document.getElementById('all-users-tbody').innerHTML = users.map(u => `
        <tr>
            <td><strong>${u.username}</strong></td>
            <td><span class="tag ${roleColors[u.role] || 'tag-green'}">${u.role}</span></td>
            <td>${u.tenant || '<em style="color:var(--text-muted)">Global</em>'}</td>
            <td>${u.email || '—'}</td>
        </tr>
    `).join('');
}

// ─── Dashboard Setup ──────────────────────────────────────────────────────────
function setupDashboard() {
    document.getElementById('user-display').textContent = `${currentUser.username.toUpperCase()} (${currentUser.role.toUpperCase()})`;
    const nav = document.getElementById('nav-links'); nav.innerHTML = '';
    if (currentUser.role === 'Admin') {
        addNav('donut_small', 'PERFORMANCE', 'sec-performance', true);
        addNav('point_of_sale', 'VENTAS', 'sec-ventas');
        addNav('receipt_long', 'GASTOS', 'sec-gastos');
        addNav('conveyor_belt', 'INGRESOS', 'sec-ingresos');
        addNav('person', 'CLIENTES', 'sec-clientes');
        addNav('local_shipping', 'PROVEEDORES', 'sec-proveedores');
        addNav('inventory_2', 'ARTÍCULOS', 'sec-escandallos');
        addNav('manage_accounts', 'USUARIOS', 'sec-usuarios');
        switchSection('sec-performance', 'PERFORMANCE');
    } else {
        addNav('point_of_sale', 'VENTAS', 'sec-ventas', true);
        switchSection('sec-ventas', 'VENTAS');
    }
    showView('dashboard-view');
}

function addNav(icon, text, secId, active = false) {
    const li = document.createElement('li');
    const a = document.createElement('a'); a.href = '#';
    a.innerHTML = `<span class="material-symbols-outlined">${icon}</span> ${text}`;
    if (active) a.classList.add('active');
    a.addEventListener('click', (e) => { e.preventDefault(); document.querySelectorAll('#nav-links a').forEach(l => l.classList.remove('active')); a.classList.add('active'); switchSection(secId, text); });
    li.appendChild(a); document.getElementById('nav-links').appendChild(li);
}

// ─── User Management (Admin de instancia) ─────────────────────────────────────
async function loadUsers() {
    const res = await apiFetch('/users');
    const users = await res.json();
    const roleColors = { Admin: 'tag-blue', Operator: 'tag-green' };
    document.getElementById('users-tbody').innerHTML = users.map(u => `
        <tr>
            <td><strong>${u.username}</strong></td>
            <td><span class="tag ${roleColors[u.role] || 'tag-green'}">${u.role}</span></td>
            <td>${u.email || '—'}</td>
            <td>
                <button class="btn secondary outline btn-icon" onclick="deleteUser(${u.id}, '${u.username}')" title="Eliminar">
                    <span class="material-symbols-outlined">delete</span>
                </button>
            </td>
        </tr>
    `).join('');
}

document.getElementById('create-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalHtml = submitBtn.innerHTML;
    const m = document.getElementById('create-user-msg');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="material-symbols-outlined animate-spin" style="font-size:1.1rem;vertical-align:middle;">sync</span> CREANDO...';
    const payload = {
        username: document.getElementById('new-user-username').value.trim(),
        email: document.getElementById('new-user-email').value.trim(),
        role: document.getElementById('new-user-role').value,
    };
    try {
        const res = await apiFetch('/users', { method: 'POST', body: JSON.stringify(payload) });
        if (res.ok) {
            const data = await res.json();
            submitBtn.style.background = 'var(--positive)'; submitBtn.style.color = 'white';
            submitBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1.1rem;vertical-align:middle;">check</span> ¡USUARIO CREADO!';
            m.textContent = data.message; m.className = 'success-msg';
            setTimeout(() => {
                submitBtn.disabled = false; submitBtn.style.background = ''; submitBtn.style.color = ''; submitBtn.innerHTML = originalHtml;
                e.target.reset(); loadUsers(); setTimeout(() => m.textContent = '', 5000);
            }, 1500);
        } else {
            const d = await res.json(); m.textContent = d.detail || 'Error al crear'; m.className = 'error-msg';
            submitBtn.disabled = false; submitBtn.innerHTML = originalHtml;
        }
    } catch(err) {
        m.textContent = 'Error de conexión. Intentá de nuevo.'; m.className = 'error-msg';
        submitBtn.disabled = false; submitBtn.innerHTML = originalHtml;
    }
});

async function deleteUser(id, username) {
    if (!confirm(`¿ELIMINAR el usuario "${username}"?`)) return;
    await apiFetch(`/users/${id}`, { method: 'DELETE' });
    loadUsers();
}

// ─── PRODUCTOS Y RECETAS ───────────────────────────────────────────────────────
async function loadIngredientsCache() {
    const res = await apiFetch('/ingredients');
    allIngredients = await res.json();
    const dl = document.getElementById('ingredients-list');
    if (dl) dl.innerHTML = allIngredients.map(i => `<option value="${i.name}">`).join('');
}

async function loadEscandalloTable() {
    const tbody = document.getElementById('escandallo-tbody');
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:20px;"><span class="material-symbols-outlined animate-spin" style="vertical-align:middle;">sync</span> Cargando artículos...</td></tr>`;
    try {
        const res = await apiFetch('/products');
        if (!res.ok) throw new Error('Error al cargar artículos');
        const products = await res.json();
        tbody.innerHTML = '';
        if (products.length === 0) { tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:20px;">No hay artículos creados todavía.</td></tr>`; return; }
        for (const prod of products) {
            const isSimple = (prod.article_type === 'SIMPLE');
            let ingredients = [];
            if (!isSimple) {
                try { const ingRes = await apiFetch(`/recipes/${prod.id}`); if (ingRes.ok) ingredients = await ingRes.json(); } catch(_) {}
            }
            const ingHtml = ingredients.map(ing => `<tr class="ingredient-row row-prod-${prod.id}"><td></td><td></td><td style="padding-left:30px;color:var(--text-muted);"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">subdirectory_arrow_right</span> ${ing.name}</td><td colspan="3" class="text-muted">Cant: ${ing.quantity}</td><td colspan="2" class="text-muted">$${(ing.quantity * ing.cost).toFixed(2)}</td></tr>`).join('');
            const minStockText = (prod.min_stock && prod.min_stock > 0) ? `${prod.min_stock} u.` : '-';
            const typeTag = isSimple
                ? `<span class="tag tag-blue" style="font-size:0.7rem;">SIMPLE</span>`
                : `<span class="tag tag-green" style="font-size:0.7rem;">FÓRMULA</span>`;
            const cogsLabel = isSimple
                ? `<strong style="color:var(--primary);">$${prod.gpu.toFixed(2)}</strong><span style="font-size:0.7rem;color:var(--text-muted);display:block;">desde gastos</span>`
                : `<strong style="color:var(--primary);">$${prod.gpu.toFixed(2)}</strong>`;
            tbody.innerHTML += `<tr class="group-header"><td style="text-align:center;">${ingredients.length > 0 ? `<span class="material-symbols-outlined toggle-btn" onclick="toggleIng(${prod.id},this)">expand_more</span>` : ''}</td><td><strong>${prod.name}</strong></td><td>${typeTag}</td><td>${isSimple ? '-' : (prod.yield || 1)}</td><td style="text-align:center; font-weight: 600;">${minStockText}</td><td>$${prod.price.toFixed(2)}</td><td>${cogsLabel}</td><td style="white-space:nowrap;"><button class="btn secondary outline btn-icon" onclick="viewProduct(${prod.id},'${(prod.name||'').replace(/'/g,'')}',${prod.price},${prod.yield||1},${prod.min_stock||0},'${prod.article_type||'FORMULA'}')" title="Ver"><span class="material-symbols-outlined">visibility</span></button></td></tr>${ingHtml}`;
        }
    } catch(err) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--negative);padding:20px;">Error al cargar la tabla. Recargá la página.</td></tr>`;
    }
}

function toggleIng(id, el) { document.querySelectorAll(`.row-prod-${id}`).forEach(r => r.classList.toggle('show')); el.textContent = el.textContent === 'expand_more' ? 'expand_less' : 'expand_more'; }

const escCont = document.getElementById('esc-items-container');
function addEscRow(name = '', qty = '') {
    const row = document.createElement('div'); row.className = 'esc-row';
    row.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr 40px;gap:10px;margin-bottom:10px;';
    const ing = allIngredients.find(i => i.name.toLowerCase() === name.toLowerCase());
    row.innerHTML = `<input type="text" class="esc-item-name" placeholder="Insumo" list="ingredients-list" value="${name}"><input type="number" step="0.01" class="esc-item-qty" placeholder="Cant." value="${qty}"><input type="text" class="esc-item-cost" readonly disabled style="background:rgba(0,0,0,0.2);" value="${ing ? (ing.cost * (parseFloat(qty) || 0)).toFixed(2) : '0.00'}"><button type="button" class="btn secondary outline remove-esc-item btn-icon"><span class="material-symbols-outlined">close</span></button>`;
    escCont.appendChild(row);
}
if (document.getElementById('esc-add-item-btn')) document.getElementById('esc-add-item-btn').addEventListener('click', () => addEscRow());
if (escCont) {
    escCont.addEventListener('click', e => { const b = e.target.closest('.remove-esc-item'); if (b) { b.closest('.esc-row').remove(); updateEscTotals(); } });
    escCont.addEventListener('input', e => {
        if (e.target.classList.contains('esc-item-name') || e.target.classList.contains('esc-item-qty')) {
            const row = e.target.closest('.esc-row');
            const ing = allIngredients.find(i => i.name.toLowerCase() === row.querySelector('.esc-item-name').value.toLowerCase());
            row.querySelector('.esc-item-cost').value = ((parseFloat(row.querySelector('.esc-item-qty').value) || 0) * (ing ? ing.cost : 0)).toFixed(2);
            updateEscTotals();
        }
    });
}
function updateEscTotals() {
    let t = 0; document.querySelectorAll('.esc-item-cost').forEach(el => t += parseFloat(el.value) || 0);
    const y = parseFloat(document.getElementById('esc-yield').value) || 1;
    document.getElementById('esc-total-batch-cost').textContent = `$${t.toFixed(2)}`;
    document.getElementById('esc-gpu-display').textContent = `$${(t / y).toFixed(2)}`;
}
if (document.getElementById('esc-yield')) document.getElementById('esc-yield').addEventListener('input', updateEscTotals);

let editingProductId = null;
function setArticleType(type) {
    const isSimple = (type === 'SIMPLE');
    document.getElementById('esc-type-formula').checked = !isSimple;
    document.getElementById('esc-type-simple').checked = isSimple;
    document.getElementById('article-type-formula-btn').style.borderColor = isSimple ? 'var(--surface-border)' : 'var(--primary)';
    document.getElementById('article-type-simple-btn').style.borderColor = isSimple ? 'var(--primary)' : 'var(--surface-border)';
    document.getElementById('esc-yield-group').style.display = isSimple ? 'none' : '';
    document.getElementById('esc-formula-section').style.display = isSimple ? 'none' : '';
    document.getElementById('esc-simple-note').style.display = isSimple ? '' : 'none';
    document.getElementById('esc-cogs-section').style.display = isSimple ? 'none' : '';
}
document.getElementById('article-type-formula-btn').addEventListener('click', () => setArticleType('FORMULA'));
document.getElementById('article-type-simple-btn').addEventListener('click', () => setArticleType('SIMPLE'));
setArticleType('FORMULA');

function editProduct(id, name, price, yld, minStock, articleType) {
    editingProductId = id;
    document.getElementById('esc-sabor').value = name;
    document.getElementById('esc-sale-price').value = price;
    document.getElementById('esc-yield').value = yld;
    document.getElementById('esc-min-stock').value = minStock || 0;
    setArticleType(articleType || 'FORMULA');
    escCont.innerHTML = ''; document.getElementById('cancel-edit-product-btn').style.display = 'inline-flex';
    if ((articleType || 'FORMULA') !== 'SIMPLE') {
        apiFetch(`/recipes/${id}`).then(r => r.json()).then(items => { items.forEach(i => addEscRow(i.name, i.quantity)); if (!items.length) addEscRow(); updateEscTotals(); });
    } else {
        escCont.innerHTML = ''; updateEscTotals();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.getElementById('cancel-edit-product-btn').addEventListener('click', () => { editingProductId = null; document.getElementById('escandallo-form').reset(); document.getElementById('esc-min-stock').value = 0; escCont.innerHTML = ''; addEscRow(); updateEscTotals(); setArticleType('FORMULA'); document.getElementById('cancel-edit-product-btn').style.display = 'none'; });
document.getElementById('escandallo-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="material-symbols-outlined animate-spin" style="font-size:1.1rem;vertical-align:middle;">sync</span> GUARDANDO...';
    const sabor = document.getElementById('esc-sabor').value.trim().toUpperCase();
    const price = parseFloat(document.getElementById('esc-sale-price').value);
    const yld = parseFloat(document.getElementById('esc-yield').value) || 1;
    const minStock = parseInt(document.getElementById('esc-min-stock').value) || 0;
    const articleType = document.getElementById('esc-type-simple').checked ? 'SIMPLE' : 'FORMULA';
    const isSimple = (articleType === 'SIMPLE');
    let productId = editingProductId;
    try {
        if (!productId) {
            const createRes = await apiFetch('/products', { method: 'POST', body: JSON.stringify({ flavor_name: sabor, sale_price: price, yield_per_batch: yld, min_stock: minStock, article_type: articleType }) });
            if (!createRes.ok) {
                let errMsg = 'Error al crear el artículo';
                try { const errData = await createRes.json(); errMsg = errData.detail || errMsg; } catch(_) {}
                throw new Error(errMsg);
            }
            const createData = await createRes.json();
            productId = createData.id;
            if (!productId) throw new Error('No se pudo obtener el ID del artículo creado');
        } else {
            const updRes = await apiFetch(`/products/${productId}`, { method: 'PUT', body: JSON.stringify({ flavor_name: sabor, sale_price: price, yield_per_batch: yld, min_stock: minStock, article_type: articleType }) });
            if (!updRes.ok) {
                let errMsg = 'Error al actualizar el artículo';
                try { const errData = await updRes.json(); errMsg = errData.detail || errMsg; } catch(_) {}
                throw new Error(errMsg);
            }
        }
        let recipeOk = true;
        if (!isSimple) {
            const items = [];
            for (const row of document.querySelectorAll('.esc-row')) {
                const name = row.querySelector('.esc-item-name').value.trim(); const qty = parseFloat(row.querySelector('.esc-item-qty').value);
                if (!name || isNaN(qty)) continue;
                let ing = allIngredients.find(i => i.name.toLowerCase() === name.toLowerCase());
                if (!ing) {
                    const ingRes = await apiFetch('/ingredients', { method: 'POST', body: JSON.stringify({ name: name.toUpperCase() }) });
                    if (!ingRes.ok) { console.warn('Error creando ingrediente:', name); continue; }
                    await loadIngredientsCache(); ing = allIngredients.find(i => i.name.toLowerCase() === name.toLowerCase());
                }
                if (ing) items.push({ ingredient_id: ing.id, quantity: qty });
            }
            const res = await apiFetch('/recipes', { method: 'POST', body: JSON.stringify({ product_id: productId, yield_per_batch: yld, items }) });
            recipeOk = res.ok;
            if (!recipeOk) {
                let errMsg = 'Error al guardar la receta';
                try { const errData = await res.json(); errMsg = errData.detail || errMsg; } catch(_) {}
                const m = document.getElementById('esc-msg'); m.textContent = errMsg; m.className = 'error-msg'; setTimeout(() => m.textContent = '', 5000);
                submitBtn.disabled = false; submitBtn.innerHTML = originalHtml;
                return;
            }
        }
        if (recipeOk) {
            submitBtn.style.background = 'var(--positive)'; submitBtn.style.color = 'white';
            submitBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1.1rem;vertical-align:middle;">check</span> ¡ARTÍCULO GUARDADO!';
            setTimeout(() => {
                submitBtn.disabled = false; submitBtn.style.background = ''; submitBtn.style.color = ''; submitBtn.innerHTML = originalHtml;
                e.target.reset(); escCont.innerHTML = ''; addEscRow(); editingProductId = null; setArticleType('FORMULA'); document.getElementById('cancel-edit-product-btn').style.display = 'none'; loadEscandalloTable();
                const m = document.getElementById('esc-msg'); m.textContent = 'ARTÍCULO GUARDADO'; m.className = 'success-msg'; setTimeout(() => m.textContent = '', 3000);
            }, 1500);
        }
    } catch (err) {
        const m = document.getElementById('esc-msg'); m.textContent = err.message || 'Error inesperado'; m.className = 'error-msg'; setTimeout(() => m.textContent = '', 5000);
        submitBtn.disabled = false; submitBtn.innerHTML = originalHtml;
    }
});
function viewProduct(id, name, price, yld, minStock, articleType) {
    const typeLabel = articleType === 'SIMPLE' ? 'SIMPLE (reventa)' : 'FÓRMULA (fabricado)';
    document.getElementById('modal-title').textContent = name;
    document.getElementById('modal-body').innerHTML = `
        <table class="data-table"><tbody>
            <tr><td style="color:var(--text-muted);width:40%;">TIPO</td><td>${typeLabel}</td></tr>
            <tr><td style="color:var(--text-muted);">PRECIO DE VENTA</td><td><strong>$${parseFloat(price).toFixed(2)}</strong></td></tr>
            <tr><td style="color:var(--text-muted);">RENDIMIENTO</td><td>${articleType === 'SIMPLE' ? '-' : yld + ' u.'}</td></tr>
            <tr><td style="color:var(--text-muted);">STOCK MÍNIMO</td><td>${minStock > 0 ? minStock + ' u.' : '-'}</td></tr>
        </tbody></table>
        <div style="display:flex;gap:10px;margin-top:20px;border-top:1px solid var(--surface-border);padding-top:16px;">
            <button class="btn secondary outline" style="flex:1;" onclick="closeModal();editProduct(${id},'${name}',${price},${yld},${minStock},'${articleType}')"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">edit</span> EDITAR</button>
            <button class="btn" style="flex:1;background:var(--negative);color:white;" onclick="deleteProduct(${id})"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">delete</span> ELIMINAR</button>
        </div>`;
    document.getElementById('detail-modal').style.display = 'block';
}
async function deleteProduct(id) {
    if (confirm('¿ELIMINAR ESTE ARTÍCULO?')) {
        const r = await apiFetch(`/products/${id}`, { method: 'DELETE' });
        if (!r.ok) { const d = await r.json(); alert(d.detail || 'Error'); } else { closeModal(); loadEscandalloTable(); if (editingProductId === id) document.getElementById('cancel-edit-product-btn').click(); }
    }
}

// ─── VENTAS ───────────────────────────────────────────────────────────────────
async function loadClientsDropdown() {
    const res = await apiFetch('/clients');
    const data = await res.json();
    const el = document.getElementById('sale-client');
    if (el) el.innerHTML = '<option value="">SELECCIONAR CLIENTE...</option>' + data.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
}
async function loadStockDropdown() {
    const res = await apiFetch('/stock');
    allStockProducts = await res.json();
    if (document.querySelectorAll('.sale-row').length === 0) addSaleRow();
}
const saleCont = document.getElementById('sale-items-container');
function addSaleRow(prodId = '', qty = '') {
    const row = document.createElement('div'); row.className = 'sale-row';
    row.style.cssText = 'display:grid;grid-template-columns:3fr 1fr 40px;gap:10px;margin-bottom:10px;';
    row.innerHTML = `<select class="sale-item-prod" required><option value="">SABOR...</option>${allStockProducts.map(p => `<option value="${p.id}" ${p.id == prodId ? 'selected' : ''}>${p.name}</option>`).join('')}</select><input type="number" class="sale-item-qty" placeholder="CANT." required value="${qty}"><button type="button" class="btn secondary outline remove-sale-item btn-icon"><span class="material-symbols-outlined">close</span></button>`;
    saleCont.appendChild(row); updateSaleTotals();
}
if (document.getElementById('add-sale-item-btn')) document.getElementById('add-sale-item-btn').addEventListener('click', () => addSaleRow());
if (saleCont) {
    saleCont.addEventListener('click', e => { const b = e.target.closest('.remove-sale-item'); if (b) { b.closest('.sale-row').remove(); updateSaleTotals(); } });
    saleCont.addEventListener('input', updateSaleTotals);
}
function getDiscountValueToSend() {
    const val = parseFloat(document.getElementById('sale-discount').value) || 0;
    const type = document.getElementById('sale-discount-type').value;
    if (val === 0) return 0;
    return type === 'percent' ? val : -val;
}
function updateSaleTotals() {
    let total = 0;
    document.querySelectorAll('.sale-row').forEach(row => {
        const pId = row.querySelector('.sale-item-prod').value; const qty = parseFloat(row.querySelector('.sale-item-qty').value) || 0;
        const prod = allStockProducts.find(p => p.id == pId); if (prod) total += (prod.price * qty);
    });
    const discVal = getDiscountValueToSend();
    let finalTotal = total;
    if (discVal > 0) finalTotal = total * (1 - (discVal / 100));
    else if (discVal < 0) finalTotal = total - Math.abs(discVal);
    if (finalTotal < 0) finalTotal = 0;
    document.getElementById('sale-total-display').textContent = finalTotal.toFixed(2);
}
if (document.getElementById('sale-discount')) document.getElementById('sale-discount').addEventListener('input', updateSaleTotals);
if (document.getElementById('sale-discount-type')) document.getElementById('sale-discount-type').addEventListener('change', updateSaleTotals);
document.getElementById('sale-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]'); const originalHtml = submitBtn.innerHTML;
    submitBtn.disabled = true; submitBtn.innerHTML = '<span class="material-symbols-outlined animate-spin" style="font-size:1.1rem;vertical-align:middle;">sync</span> GUARDANDO...';
    const items = [];
    document.querySelectorAll('.sale-row').forEach(row => { const pId = row.querySelector('.sale-item-prod').value; const qty = parseInt(row.querySelector('.sale-item-qty').value); if (pId && qty) items.push({ product_id: parseInt(pId), quantity: qty }); });
    const payload = { client_name: document.getElementById('sale-client').value, items, discount: getDiscountValueToSend(), date: document.getElementById('sale-date').value };
    try {
        const res = await apiFetch('/sales', { method: 'POST', body: JSON.stringify(payload) });
        if (res.ok) {
            submitBtn.style.background = 'var(--positive)'; submitBtn.style.color = 'white';
            submitBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1.1rem;vertical-align:middle;">check</span> ¡VENTA REGISTRADA!';
            setTimeout(() => { submitBtn.disabled = false; submitBtn.style.background = ''; submitBtn.style.color = ''; submitBtn.innerHTML = originalHtml; e.target.reset(); saleCont.innerHTML = ''; addSaleRow(); setNow('sale-date'); loadSalesHistory(); const m = document.getElementById('sale-msg'); m.textContent = 'VENTA REGISTRADA'; m.className = 'success-msg'; setTimeout(() => m.textContent = '', 3000); }, 1500);
        } else { submitBtn.disabled = false; submitBtn.innerHTML = originalHtml; }
    } catch (err) { submitBtn.disabled = false; submitBtn.innerHTML = originalHtml; }
});
async function loadSalesHistory() {
    const res = await apiFetch('/sales'); const data = await res.json();
    document.getElementById('sales-history-tbody').innerHTML = data.map(s => `<tr><td>${s.date.replace('T', ' ')}</td><td><strong>${s.client}</strong></td><td>${s.discount}</td><td><strong>$${s.total.toFixed(2)}</strong></td><td><span class="tag tag-red">$${s.gpu ? s.gpu.toFixed(2) : '0.00'}</span></td><td><button class="btn secondary outline btn-icon" onclick="viewSaleDetails(${s.id},'${(s.client||'').replace(/'/g,'')}',${ s.total},${s.discount})" title="Ver"><span class="material-symbols-outlined">visibility</span></button></td></tr>`).join('');
}
let _editingSaleId = null;
async function viewSaleDetails(id, client, total, discount) {
    const res = await apiFetch(`/sales/${id}/items`); const items = await res.json();
    document.getElementById('modal-title').textContent = `VENTA #${id}`;
    document.getElementById('modal-body').innerHTML = `
        <table class="data-table"><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>COGS (Unit)</th><th>COGS (Total)</th></tr></thead>
        <tbody>${items.map(i => `<tr><td>${i.product}</td><td>${i.quantity}</td><td>$${i.unit_price.toFixed(2)}</td><td>$${i.gpu.toFixed(2)}</td><td>$${(i.gpu * i.quantity).toFixed(2)}</td></tr>`).join('')}</tbody></table>
        <div id="sale-edit-form" style="display:none;margin-top:16px;border-top:1px solid var(--surface-border);padding-top:16px;">
            <div class="form-row"><div class="input-group"><label>CLIENTE</label><input id="modal-sale-client" type="text" value="${client}"></div><div class="input-group"><label>DESCUENTO ($)</label><input id="modal-sale-discount" type="number" step="0.01" value="0"></div></div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:10px;"><button class="btn secondary outline" onclick="document.getElementById('sale-edit-form').style.display='none'">CANCELAR</button><button class="btn primary" onclick="saveSaleEdit(${id})">GUARDAR CAMBIOS</button></div>
        </div>
        <div style="display:flex;gap:10px;margin-top:20px;border-top:1px solid var(--surface-border);padding-top:16px;">
            <button class="btn secondary outline" style="flex:1;" onclick="document.getElementById('sale-edit-form').style.display=document.getElementById('sale-edit-form').style.display==='none'?'block':'none'"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">edit</span> EDITAR</button>
            <button class="btn" style="flex:1;background:var(--negative);color:white;" onclick="deleteSale(${id})"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">delete</span> ELIMINAR</button>
        </div>`;
    document.getElementById('detail-modal').style.display = 'block';
}
async function saveSaleEdit(id) {
    const client = document.getElementById('modal-sale-client').value.trim();
    const discount = parseFloat(document.getElementById('modal-sale-discount').value) || 0;
    const res = await apiFetch(`/sales/${id}`, { method: 'PUT', body: JSON.stringify({ client_name: client, discount }) });
    if (res.ok) { closeModal(); loadSalesHistory(); } else { alert('Error al guardar'); }
}
async function deleteSale(id) { if (confirm('¿ELIMINAR ESTA VENTA? EL STOCK SERÁ DEVUELTO.')) { await apiFetch(`/sales/${id}`, { method: 'DELETE' }); closeModal(); loadSalesHistory(); } }

// ─── GASTOS ───────────────────────────────────────────────────────────────────
async function loadCategories() {
    const res = await apiFetch('/categories'); const data = await res.json();
    const el = document.getElementById('exp-cat'); if (el) el.innerHTML = data.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    const provCat = document.getElementById('prov-cat'); if (provCat) provCat.innerHTML = data.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
}
async function loadProvidersDropdown() {
    const res = await apiFetch('/providers'); allProviders = await res.json();
    const el = document.getElementById('exp-prov');
    if (el) {
        el.innerHTML = '<option value="">SELECCIONAR PROVEEDOR...</option>' + allProviders.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        el.addEventListener('change', () => { const p = allProviders.find(x => x.id == el.value); if (p) document.getElementById('exp-cat').value = p.category; });
    }
}
const expCont = document.getElementById('expense-items-container');
function addExpRow(desc = '', qty = 1, price = '', priceType = 'unit') {
    const row = document.createElement('div'); row.className = 'exp-row';
    row.style.cssText = 'display:grid;grid-template-columns:3fr 1fr 1.3fr 40px;gap:10px;margin-bottom:10px;align-items:center;';
    const isTotal = priceType === 'total';
    row.innerHTML = `<input type="text" class="exp-item-desc" placeholder="Descripción" value="${desc}" required>
        <input type="number" step="0.01" class="exp-item-qty" placeholder="Cant." value="${qty}" required>
        <div style="position:relative;">
            <input type="number" step="0.01" class="exp-item-price" placeholder="${isTotal ? 'Precio total' : 'P. unitario'}" value="${price}" required style="width:100%;padding-right:52px;">
            <button type="button" class="price-type-toggle" data-mode="${priceType}" title="${isTotal ? 'Modo: precio total ÷ cantidad' : 'Modo: precio por unidad'}" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);background:${isTotal ? 'var(--primary)' : 'rgba(255,255,255,0.07)'};border:1px solid var(--surface-border);border-radius:4px;cursor:pointer;color:${isTotal ? 'white' : 'var(--text-muted)'};padding:2px 5px;font-size:0.6rem;font-weight:700;line-height:1.4;white-space:nowrap;">
                ${isTotal ? 'TOTAL' : 'UNIT'}
            </button>
        </div>
        <button type="button" class="btn secondary outline remove-exp-item btn-icon"><span class="material-symbols-outlined">close</span></button>`;
    expCont.appendChild(row);
}
if (document.getElementById('add-item-btn')) document.getElementById('add-item-btn').addEventListener('click', () => addExpRow());
if (expCont) {
    expCont.addEventListener('click', e => {
        const b = e.target.closest('.remove-exp-item'); if (b) { b.closest('.exp-row').remove(); updateExpTotal(); return; }
        const t = e.target.closest('.price-type-toggle');
        if (t) {
            const newMode = t.dataset.mode === 'unit' ? 'total' : 'unit';
            t.dataset.mode = newMode;
            const isTotal = newMode === 'total';
            t.textContent = isTotal ? 'TOTAL' : 'UNIT';
            t.style.background = isTotal ? 'var(--primary)' : 'rgba(255,255,255,0.07)';
            t.style.color = isTotal ? 'white' : 'var(--text-muted)';
            t.title = isTotal ? 'Modo: precio total ÷ cantidad' : 'Modo: precio por unidad';
            t.closest('div').querySelector('.exp-item-price').placeholder = isTotal ? 'Precio total' : 'P. unitario';
            updateExpTotal();
        }
    });
    expCont.addEventListener('input', updateExpTotal);
}
function updateExpTotal() {
    let t = 0;
    document.querySelectorAll('.exp-row').forEach(row => {
        const q = parseFloat(row.querySelector('.exp-item-qty').value) || 0;
        const rawP = parseFloat(row.querySelector('.exp-item-price').value) || 0;
        const toggle = row.querySelector('.price-type-toggle');
        const isTotal = toggle && toggle.dataset.mode === 'total';
        t += isTotal ? rawP : (q * rawP);
    });
    document.getElementById('exp-total-display').textContent = t.toFixed(2);
}
let editingExpenseId = null;
document.getElementById('expense-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]'); const originalHtml = submitBtn.innerHTML;
    submitBtn.disabled = true; submitBtn.innerHTML = '<span class="material-symbols-outlined animate-spin" style="font-size:1.1rem;vertical-align:middle;">sync</span> GUARDANDO...';
    const items = [];
    document.querySelectorAll('.exp-row').forEach(row => {
        const desc = row.querySelector('.exp-item-desc').value.trim();
        const qty = parseFloat(row.querySelector('.exp-item-qty').value) || 0;
        const rawPrice = parseFloat(row.querySelector('.exp-item-price').value) || 0;
        const toggle = row.querySelector('.price-type-toggle');
        const isTotal = toggle && toggle.dataset.mode === 'total';
        const unit_price = isTotal ? (qty > 0 ? rawPrice / qty : 0) : rawPrice;
        if (desc && qty && rawPrice) items.push({ description: desc, quantity: qty, unit_price });
    });
    const payload = { provider_id: parseInt(document.getElementById('exp-prov').value), category_name: document.getElementById('exp-cat').value, date: document.getElementById('exp-date').value, items };
    let url = '/expenses', method = 'POST';
    if (editingExpenseId) { url = `/expenses/${editingExpenseId}`; method = 'PUT'; }
    try {
        const res = await apiFetch(url, { method, body: JSON.stringify(payload) });
        if (res.ok) {
            submitBtn.style.background = 'var(--positive)'; submitBtn.style.color = 'white';
            submitBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1.1rem;vertical-align:middle;">check</span> ¡GASTO GUARDADO!';
            setTimeout(() => { submitBtn.disabled = false; submitBtn.style.background = ''; submitBtn.style.color = ''; submitBtn.innerHTML = originalHtml; e.target.reset(); expCont.innerHTML = ''; addExpRow(); setNow('exp-date'); loadExpensesHistory(); editingExpenseId = null; document.getElementById('cancel-edit-expense-btn').style.display = 'none'; const m = document.getElementById('exp-msg'); m.textContent = 'GASTO GUARDADO'; m.className = 'success-msg'; setTimeout(() => m.textContent = '', 3000); }, 1500);
        } else {
            let errMsg = 'Error al guardar el gasto';
            try { const errData = await res.json(); errMsg = errData.detail || errMsg; } catch(_) {}
            const m = document.getElementById('exp-msg'); m.textContent = errMsg; m.className = 'error-msg'; setTimeout(() => m.textContent = '', 5000);
            submitBtn.disabled = false; submitBtn.innerHTML = originalHtml;
        }
    } catch (err) {
        const m = document.getElementById('exp-msg'); m.textContent = err.message || 'Error inesperado'; m.className = 'error-msg'; setTimeout(() => m.textContent = '', 5000);
        submitBtn.disabled = false; submitBtn.innerHTML = originalHtml;
    }
});
async function loadExpensesHistory() {
    const res = await apiFetch('/expenses'); const data = await res.json();
    document.getElementById('expenses-history-tbody').innerHTML = data.map(e => `<tr><td>${e.date.replace('T', ' ')}</td><td>${e.provider_name}</td><td>${e.category_name}</td><td><strong>$${e.total.toFixed(2)}</strong></td><td style="white-space:nowrap;"><button class="btn secondary outline btn-icon" onclick="viewExpenseDetails(${e.id})" title="Ver"><span class="material-symbols-outlined">visibility</span></button></td></tr>`).join('');
}
async function editExpense(id) {
    const res = await apiFetch('/expenses'); const all = await res.json(); const exp = all.find(x => x.id === id); if (!exp) return;
    editingExpenseId = id;
    document.getElementById('exp-prov').value = exp.provider_id;
    document.getElementById('exp-cat').value = exp.category_name;
    document.getElementById('exp-date').value = exp.date;
    expCont.innerHTML = '';
    const itemsRes = await apiFetch(`/expenses/${id}/items`); const items = await itemsRes.json();
    items.forEach(i => addExpRow(i.description, i.quantity, i.unit_price)); updateExpTotal();
    document.getElementById('cancel-edit-expense-btn').style.display = 'inline-flex';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.getElementById('cancel-edit-expense-btn').addEventListener('click', () => { editingExpenseId = null; document.getElementById('expense-form').reset(); expCont.innerHTML = ''; addExpRow(); updateExpTotal(); document.getElementById('cancel-edit-expense-btn').style.display = 'none'; });
async function deleteExpense(id) { if (confirm('¿ELIMINAR ESTE GASTO?')) { await apiFetch(`/expenses/${id}`, { method: 'DELETE' }); loadExpensesHistory(); } }
async function viewExpenseDetails(id) {
    const res = await apiFetch(`/expenses/${id}/items`); const items = await res.json();
    document.getElementById('modal-title').textContent = `GASTO #${id}`;
    document.getElementById('modal-body').innerHTML = `
        <table class="data-table"><thead><tr><th>Descripción</th><th>Cant.</th><th>Precio Unit.</th><th>Subtotal</th></tr></thead>
        <tbody>${items.map(i => `<tr><td>${i.description}</td><td>${i.quantity}</td><td>$${i.unit_price.toFixed(2)}</td><td>$${(i.quantity * i.unit_price).toFixed(2)}</td></tr>`).join('')}</tbody></table>
        <div style="display:flex;gap:10px;margin-top:20px;border-top:1px solid var(--surface-border);padding-top:16px;">
            <button class="btn secondary outline" style="flex:1;" onclick="closeModal();editExpense(${id})"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">edit</span> EDITAR</button>
            <button class="btn" style="flex:1;background:var(--negative);color:white;" onclick="deleteExpense(${id})"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">delete</span> ELIMINAR</button>
        </div>`;
    document.getElementById('detail-modal').style.display = 'block';
}

// ─── INGRESOS (PRODUCCIÓN) ────────────────────────────────────────────────────
let editingProdRunId = null;
async function loadProductionHistory() {
    const res = await apiFetch('/production'); const data = await res.json();
    document.getElementById('prodrun-tbody').innerHTML = data.map(pr => `<tr><td>${pr.date.replace('T', ' ')}</td><td><strong>${pr.product_name}</strong></td><td>${pr.quantity}</td><td style="white-space:nowrap;"><button class="btn secondary outline btn-icon" onclick="viewProdRun(${pr.id},'${(pr.product_name||'').replace(/'/g,'')}',${pr.quantity})" title="Ver"><span class="material-symbols-outlined">visibility</span></button></td></tr>`).join('');
}
async function loadProductsDropdown(id) {
    const res = await apiFetch('/products'); const data = await res.json();
    const el = document.getElementById(id); if (el) el.innerHTML = data.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}
document.getElementById('prodrun-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]'); const originalHtml = submitBtn.innerHTML;
    submitBtn.disabled = true; submitBtn.innerHTML = '<span class="material-symbols-outlined animate-spin" style="font-size:1.1rem;vertical-align:middle;">sync</span> GUARDANDO...';
    const payload = { product_id: parseInt(document.getElementById('prodrun-product').value), quantity: parseInt(document.getElementById('prodrun-qty').value), date: document.getElementById('prodrun-date').value };
    let url = '/production', method = 'POST';
    if (editingProdRunId) { url = `/production/${editingProdRunId}`; method = 'PUT'; }
    try {
        const res = await apiFetch(url, { method, body: JSON.stringify(payload) });
        if (res.ok) {
            submitBtn.style.background = 'var(--positive)'; submitBtn.style.color = 'white';
            submitBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1.1rem;vertical-align:middle;">check</span> ¡INGRESO GUARDADO!';
            setTimeout(() => { submitBtn.disabled = false; submitBtn.style.background = ''; submitBtn.style.color = ''; submitBtn.innerHTML = originalHtml; e.target.reset(); setNow('prodrun-date'); loadProductionHistory(); editingProdRunId = null; document.getElementById('cancel-edit-prodrun-btn').style.display = 'none'; }, 1500);
        } else {
            let errMsg = 'Error al guardar el ingreso';
            try { const errData = await res.json(); errMsg = errData.detail || errMsg; } catch(_) {}
            const m = document.getElementById('prodrun-msg'); m.textContent = errMsg; m.className = 'error-msg'; setTimeout(() => m.textContent = '', 5000);
            submitBtn.disabled = false; submitBtn.innerHTML = originalHtml;
        }
    } catch (err) {
        const m = document.getElementById('prodrun-msg'); m.textContent = err.message || 'Error inesperado'; m.className = 'error-msg'; setTimeout(() => m.textContent = '', 5000);
        submitBtn.disabled = false; submitBtn.innerHTML = originalHtml;
    }
});
async function editProdRun(id) {
    const res = await apiFetch('/production'); const all = await res.json(); const pr = all.find(x => x.id === id); if (!pr) return;
    editingProdRunId = id;
    document.getElementById('prodrun-product').value = pr.product_id;
    document.getElementById('prodrun-qty').value = pr.quantity;
    document.getElementById('prodrun-date').value = pr.date;
    document.getElementById('cancel-edit-prodrun-btn').style.display = 'inline-flex';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.getElementById('cancel-edit-prodrun-btn').addEventListener('click', () => { editingProdRunId = null; document.getElementById('prodrun-form').reset(); setNow('prodrun-date'); document.getElementById('cancel-edit-prodrun-btn').style.display = 'none'; });
function viewProdRun(id, product, qty) {
    document.getElementById('modal-title').textContent = `PRODUCCIÓN #${id}`;
    document.getElementById('modal-body').innerHTML = `
        <table class="data-table"><tbody><tr><td style="color:var(--text-muted);width:40%;">ARTÍCULO</td><td><strong>${product}</strong></td></tr><tr><td style="color:var(--text-muted);">UNIDADES</td><td><strong>${qty}</strong></td></tr></tbody></table>
        <div style="display:flex;gap:10px;margin-top:20px;border-top:1px solid var(--surface-border);padding-top:16px;">
            <button class="btn secondary outline" style="flex:1;" onclick="closeModal();editProdRun(${id})"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">edit</span> EDITAR</button>
            <button class="btn" style="flex:1;background:var(--negative);color:white;" onclick="deleteProdRun(${id})"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">delete</span> ELIMINAR</button>
        </div>`;
    document.getElementById('detail-modal').style.display = 'block';
}
async function deleteProdRun(id) { if (confirm('¿ELIMINAR ESTE INGRESO?')) { await apiFetch(`/production/${id}`, { method: 'DELETE' }); closeModal(); loadProductionHistory(); } }

// ─── CLIENTES ─────────────────────────────────────────────────────────────────
async function loadClients() {
    const res = await apiFetch('/clients'); allClients = await res.json();
    document.getElementById('clients-tbody').innerHTML = allClients.map(c => `<tr><td><strong>${c.name}</strong></td><td>${c.phone || '---'}</td><td style="white-space:nowrap;"><button class="btn secondary outline btn-icon" onclick="viewClient(${c.id},'${(c.name||'').replace(/'/g,'')}','${(c.phone||'').replace(/'/g,'')}')" title="Ver"><span class="material-symbols-outlined">visibility</span></button></td></tr>`).join('');
}
document.getElementById('client-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="material-symbols-outlined animate-spin" style="font-size:1.1rem;vertical-align:middle;">sync</span> GUARDANDO...';
    const payload = { name: document.getElementById('client-name').value.trim(), phone: document.getElementById('client-phone').value.trim() || null };
    let url = '/clients', method = 'POST';
    if (editingClientId) { url = `/clients/${editingClientId}`; method = 'PUT'; }
    try {
        const res = await apiFetch(url, { method, body: JSON.stringify(payload) });
        if (res.ok) {
            submitBtn.style.background = 'var(--positive)'; submitBtn.style.color = 'white';
            submitBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1.1rem;vertical-align:middle;">check</span> ¡GUARDADO!';
            setTimeout(() => {
                submitBtn.disabled = false; submitBtn.style.background = ''; submitBtn.style.color = ''; submitBtn.innerHTML = originalHtml;
                e.target.reset(); editingClientId = null; document.getElementById('cancel-edit-client-btn').style.display = 'none'; loadClients();
            }, 1500);
        } else {
            const d = await res.json();
            alert(d.detail || 'Error al guardar el cliente');
            submitBtn.disabled = false; submitBtn.innerHTML = originalHtml;
        }
    } catch(err) {
        alert('Error de conexión. Intentá de nuevo.');
        submitBtn.disabled = false; submitBtn.innerHTML = originalHtml;
    }
});
let editingClientId = null;
function editClient(id, name, phone) { editingClientId = id; document.getElementById('client-name').value = name; document.getElementById('client-phone').value = phone || ''; document.getElementById('cancel-edit-client-btn').style.display = 'inline-flex'; window.scrollTo({ top: 0, behavior: 'smooth' }); }
document.getElementById('cancel-edit-client-btn').addEventListener('click', () => { editingClientId = null; document.getElementById('client-form').reset(); document.getElementById('cancel-edit-client-btn').style.display = 'none'; });
function viewClient(id, name, phone) {
    document.getElementById('modal-title').textContent = `CLIENTE`;
    document.getElementById('modal-body').innerHTML = `
        <table class="data-table"><tbody><tr><td style="color:var(--text-muted);width:35%;">NOMBRE</td><td><strong>${name}</strong></td></tr><tr><td style="color:var(--text-muted);">TELÉFONO</td><td>${phone || '---'}</td></tr></tbody></table>
        <div style="display:flex;gap:10px;margin-top:20px;border-top:1px solid var(--surface-border);padding-top:16px;">
            <button class="btn secondary outline" style="flex:1;" onclick="closeModal();editClient(${id},'${name}','${phone}')"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">edit</span> EDITAR</button>
            <button class="btn" style="flex:1;background:var(--negative);color:white;" onclick="deleteClient(${id})"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">delete</span> ELIMINAR</button>
        </div>`;
    document.getElementById('detail-modal').style.display = 'block';
}
async function deleteClient(id) { if (confirm('¿ELIMINAR ESTE CLIENTE?')) { await apiFetch(`/clients/${id}`, { method: 'DELETE' }); closeModal(); loadClients(); } }

// ─── PROVEEDORES ──────────────────────────────────────────────────────────────
async function loadProviders() {
    const tbody = document.getElementById('providers-tbody');
    try {
        const res = await apiFetch('/providers');
        if (!res.ok) throw new Error('Error al cargar proveedores');
        allProviders = await res.json();
        tbody.innerHTML = allProviders.length === 0
            ? `<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:20px;">No hay proveedores cargados todavía.</td></tr>`
            : allProviders.map(p => `<tr><td>${p.name}</td><td>${p.category}</td><td style="white-space:nowrap;"><button class="btn secondary outline btn-icon" onclick="viewProvider(${p.id},'${(p.name||'').replace(/'/g,'')}','${(p.category||'').replace(/'/g,'')}')" title="Ver"><span class="material-symbols-outlined">visibility</span></button></td></tr>`).join('');
    } catch(err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--negative);padding:20px;">Error al cargar. Recargá la página.</td></tr>`;
    }
}
document.getElementById('provider-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="material-symbols-outlined animate-spin" style="font-size:1.1rem;vertical-align:middle;">sync</span> GUARDANDO...';
    const payload = { name: document.getElementById('prov-name').value.trim(), category_name: document.getElementById('prov-cat').value };
    try {
        const res = await apiFetch('/providers', { method: 'POST', body: JSON.stringify(payload) });
        if (res.ok) {
            submitBtn.style.background = 'var(--positive)'; submitBtn.style.color = 'white';
            submitBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1.1rem;vertical-align:middle;">check</span> ¡PROVEEDOR GUARDADO!';
            setTimeout(() => {
                submitBtn.disabled = false; submitBtn.style.background = ''; submitBtn.style.color = ''; submitBtn.innerHTML = originalHtml;
                e.target.reset(); loadProviders();
                const m = document.getElementById('prov-msg'); m.textContent = 'PROVEEDOR GUARDADO'; m.className = 'success-msg'; setTimeout(() => m.textContent = '', 3000);
            }, 1500);
        } else {
            let errMsg = 'Error al guardar el proveedor';
            try { const errData = await res.json(); errMsg = errData.detail || errMsg; } catch(_) {}
            const m = document.getElementById('prov-msg'); m.textContent = errMsg; m.className = 'error-msg'; setTimeout(() => m.textContent = '', 5000);
            submitBtn.disabled = false; submitBtn.innerHTML = originalHtml;
        }
    } catch (err) {
        const m = document.getElementById('prov-msg'); m.textContent = err.message || 'Error inesperado'; m.className = 'error-msg'; setTimeout(() => m.textContent = '', 5000);
        submitBtn.disabled = false; submitBtn.innerHTML = originalHtml;
    }
});
let _editingProviderId = null;
function viewProvider(id, name, category) {
    _editingProviderId = id;
    document.getElementById('modal-title').textContent = `PROVEEDOR`;
    document.getElementById('modal-body').innerHTML = `
        <table class="data-table"><tbody><tr><td style="color:var(--text-muted);width:35%;">NOMBRE</td><td><strong>${name}</strong></td></tr><tr><td style="color:var(--text-muted);">CATEGORÍA</td><td>${category}</td></tr></tbody></table>
        <div id="prov-edit-form" style="display:none;margin-top:16px;border-top:1px solid var(--surface-border);padding-top:16px;">
            <div class="form-row"><div class="input-group"><label>NOMBRE</label><input id="modal-prov-name" type="text" value="${name}"></div><div class="input-group"><label>CATEGORÍA</label><select id="modal-prov-cat"></select></div></div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:10px;"><button class="btn secondary outline" onclick="document.getElementById('prov-edit-form').style.display='none'">CANCELAR</button><button class="btn primary" onclick="saveProviderEdit(${id})">GUARDAR</button></div>
        </div>
        <div style="display:flex;gap:10px;margin-top:20px;border-top:1px solid var(--surface-border);padding-top:16px;">
            <button class="btn secondary outline" style="flex:1;" onclick="toggleProviderEditForm('${category}')"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">edit</span> EDITAR</button>
            <button class="btn" style="flex:1;background:var(--negative);color:white;" onclick="deleteProvider(${id})"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">delete</span> ELIMINAR</button>
        </div>`;
    document.getElementById('detail-modal').style.display = 'block';
}
async function toggleProviderEditForm(currentCat) {
    const form = document.getElementById('prov-edit-form');
    if (form.style.display === 'none') {
        const catSel = document.getElementById('modal-prov-cat');
        const catRes = await apiFetch('/categories'); const cats = await catRes.json();
        catSel.innerHTML = cats.map(c => `<option value="${c.name}" ${c.name === currentCat ? 'selected' : ''}>${c.name}</option>`).join('');
        form.style.display = 'block';
    } else { form.style.display = 'none'; }
}
async function saveProviderEdit(id) {
    const name = document.getElementById('modal-prov-name').value.trim();
    const category_name = document.getElementById('modal-prov-cat').value;
    const res = await apiFetch(`/providers/${id}`, { method: 'PUT', body: JSON.stringify({ name, category_name }) });
    if (res.ok) { closeModal(); loadProviders(); } else { const d = await res.json(); alert(d.detail || 'Error'); }
}
async function deleteProvider(id) { if (confirm('¿ELIMINAR ESTE PROVEEDOR?')) { await apiFetch(`/providers/${id}`, { method: 'DELETE' }); closeModal(); loadProviders(); } }

// ─── MÉTRICAS / PERFORMANCE ───────────────────────────────────────────────────
async function loadMetrics() {
    const loaderEl = document.getElementById('perf-loader');
    const blockedMsgEl = document.getElementById('perf-blocked-msg');
    const dataContainerEl = document.getElementById('perf-data-container');
    const stockTbody = document.getElementById('perf-stock-tbody');
    const ingresosTbody = document.getElementById('perf-ingresos-productos-tbody');
    const egresosTbody = document.getElementById('perf-egresos-categorias-tbody');

    if (loaderEl) loaderEl.style.display = 'block';
    if (blockedMsgEl) blockedMsgEl.style.display = 'none';
    if (dataContainerEl) dataContainerEl.style.display = 'none';

    const skeletonHtml4 = `<tr class="skeleton-row"><td><div class="skeleton-bar"></div></td><td><div class="skeleton-bar"></div></td><td><div class="skeleton-bar"></div></td><td><div class="skeleton-bar"></div></td></tr>`.repeat(3);
    const skeletonHtml3 = `<tr class="skeleton-row"><td><div class="skeleton-bar"></div></td><td><div class="skeleton-bar"></div></td><td><div class="skeleton-bar"></div></td></tr>`.repeat(3);
    const skeletonHtml2 = `<tr class="skeleton-row"><td><div class="skeleton-bar"></div></td><td><div class="skeleton-bar"></div></td></tr>`.repeat(3);
    if (stockTbody) stockTbody.innerHTML = skeletonHtml4;
    if (ingresosTbody) ingresosTbody.innerHTML = skeletonHtml3;
    if (egresosTbody) egresosTbody.innerHTML = skeletonHtml2;

    let allSales = [], allExpenses = [], allProducts = [], stockData = [];
    try {
        const [salesRes, expensesRes, productsRes] = await Promise.all([
            apiFetch('/sales').catch(() => ({ ok: false })),
            apiFetch('/expenses').catch(() => ({ ok: false })),
            apiFetch('/products').catch(() => ({ ok: false })),
        ]);
        allSales = salesRes.ok ? await salesRes.json().catch(() => []) : [];
        allExpenses = expensesRes.ok ? await expensesRes.json().catch(() => []) : [];
        allProducts = productsRes.ok ? await productsRes.json().catch(() => []) : [];
    } catch (err) { console.error(err); }

    if (loaderEl) loaderEl.style.display = 'none';

    // CTR
    try {
        const stockRes = await apiFetch('/stock').catch(() => ({ ok: false }));
        stockData = stockRes.ok ? await stockRes.json().catch(() => []) : [];
        const metricsRes = await apiFetch('/metrics').catch(() => ({ ok: false }));
        if (metricsRes.ok) {
            const metrics = await metricsRes.json();
            const ctr = metrics.ctr || 0;
            const ctrEl = document.getElementById('perf-ctr-valor');
            if (ctrEl) { ctrEl.className = ctr >= 0 ? 'value positive' : 'value negative'; animateNumberValue('perf-ctr-valor', currentCtr, ctr, 800, ctr >= 0 ? '$' : '-$'); currentCtr = ctr; }
        }
    } catch (e) { console.error(e); }

    // Stock
    if (stockTbody && Array.isArray(stockData)) {
        const activeStock = stockData.filter(item => item.stock > 0);
        if (activeStock.length === 0) { stockTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Sin stock disponible en almacén</td></tr>`; }
        else {
            stockTbody.innerHTML = activeStock.map(item => {
                const minStockThreshold = item.min_stock || 0;
                const isLow = item.stock <= minStockThreshold;
                return `<tr><td><strong>${item.name || item.flavor || 'PRODUCTO'}</strong></td><td style="text-align: center; font-weight: 700; color: ${isLow ? '#f43f5e' : 'var(--text-main)'};">${item.stock} u.</td><td style="text-align: center; color: var(--text-muted);">${minStockThreshold} u.</td><td style="text-align: right;"><span class="tag ${isLow ? 'tag-red' : 'tag-green'}">${isLow ? 'BAJO STOCK' : 'OK'}</span></td></tr>`;
            }).join('');
        }
    }

    // Months selector
    const monthsSet = new Set();
    if (Array.isArray(allSales)) allSales.forEach(s => { if (s.date && s.date.length >= 7) monthsSet.add(s.date.slice(0, 7)); });
    if (Array.isArray(allExpenses)) allExpenses.forEach(e => { if (e.date && e.date.length >= 7) monthsSet.add(e.date.slice(0, 7)); });
    const sortedMonths = Array.from(monthsSet).sort().reverse();
    const selector = document.getElementById('performance-month-select');
    if (selector) {
        const currentValue = selector.value;
        selector.innerHTML = '<option value="">Seleccionar mes...</option>' + sortedMonths.map(m => {
            const [year, month] = m.split('-');
            const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
            return `<option value="${m}">${monthNames[parseInt(month) - 1] || 'Mes'} ${year}</option>`;
        }).join('');
        if (currentValue && sortedMonths.includes(currentValue)) selector.value = currentValue;
        const newSelector = selector.cloneNode(true);
        selector.parentNode.replaceChild(newSelector, selector);
        newSelector.addEventListener('change', () => {
            const selectedMonth = newSelector.value;
            if (!selectedMonth) { if (blockedMsgEl) blockedMsgEl.style.display = 'block'; if (dataContainerEl) dataContainerEl.style.display = 'none'; }
            else { if (blockedMsgEl) blockedMsgEl.style.display = 'none'; if (dataContainerEl) dataContainerEl.style.display = 'block'; calculateAndRenderMetrics(selectedMonth, allSales, allExpenses, allProducts); }
        });
        if (newSelector.value) { if (blockedMsgEl) blockedMsgEl.style.display = 'none'; if (dataContainerEl) dataContainerEl.style.display = 'block'; calculateAndRenderMetrics(newSelector.value, allSales, allExpenses, allProducts); }
        else { if (blockedMsgEl) blockedMsgEl.style.display = 'block'; if (dataContainerEl) dataContainerEl.style.display = 'none'; }
    }
}

async function calculateAndRenderMetrics(targetMonth, sales, expenses, products) {
    const monthlySales = sales.filter(s => s.date && s.date.slice(0, 7) === targetMonth);
    const monthlyExpenses = expenses.filter(e => e.date && e.date.slice(0, 7) === targetMonth);
    const productSalesMap = {};
    let totalIngresosBrutos = 0, totalGTR = 0;
    const saleDetailsPromises = monthlySales.map(s => apiFetch(`/sales/${s.id}/items`).then(res => res.json()).catch(() => []));
    const allMonthlySaleItems = await Promise.all(saleDetailsPromises);
    allMonthlySaleItems.forEach(items => {
        items.forEach(item => {
            const flavor = item.product || 'PRODUCTO DESCONOCIDO'; const qty = item.quantity || 0; const subtotal = item.subtotal || 0; const itemCost = (item.gpu || 0) * qty;
            if (!productSalesMap[flavor]) productSalesMap[flavor] = { qty: 0, revenue: 0 };
            productSalesMap[flavor].qty += qty; productSalesMap[flavor].revenue += subtotal; totalGTR += itemCost; totalIngresosBrutos += subtotal;
        });
    });
    const ingresosTbody = document.getElementById('perf-ingresos-productos-tbody');
    if (ingresosTbody) {
        const sortedProducts = Object.keys(productSalesMap).sort();
        ingresosTbody.innerHTML = sortedProducts.length === 0 ? `<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">Sin ventas en este período</td></tr>` : sortedProducts.map(prod => { const data = productSalesMap[prod]; return `<tr><td><strong>${prod}</strong></td><td style="text-align: center; font-weight: 600;">${data.qty} u.</td><td style="text-align: right; font-weight: 700; color: var(--positive);">$${data.revenue.toFixed(2)}</td></tr>`; }).join('');
    }
    const officialCategories = ["SUELDOS", "INSUMOS", "UTENSILIOS", "PROGRAMAS", "SITIO WEB", "DISEÑADOR", "PACKAGING", "MARKETING"];
    const categoryExpensesMap = {}; officialCategories.forEach(cat => categoryExpensesMap[cat] = 0);
    let totalEgresos = 0;
    monthlyExpenses.forEach(exp => { const category = (exp.category || '').toUpperCase(); const total = parseFloat(exp.total) || 0; totalEgresos += total; if (categoryExpensesMap.hasOwnProperty(category)) categoryExpensesMap[category] += total; else { if (!categoryExpensesMap['OTROS']) categoryExpensesMap['OTROS'] = 0; categoryExpensesMap['OTROS'] += total; } });
    const egresosTbody = document.getElementById('perf-egresos-categorias-tbody');
    if (egresosTbody) egresosTbody.innerHTML = Object.keys(categoryExpensesMap).map(cat => { const amount = categoryExpensesMap[cat]; return `<tr><td><strong>${cat}</strong></td><td style="text-align: right; font-weight: 700; color: ${amount > 0 ? '#f472b6' : 'var(--text-muted)'};">$${amount.toFixed(2)}</td></tr>`; }).join('');
    const rna = totalIngresosBrutos > 0 ? ((totalIngresosBrutos - totalGTR) / totalIngresosBrutos * 100) : 0;
    const rendimientoEl = document.getElementById('perf-rendimiento-real');
    if (rendimientoEl) { rendimientoEl.className = rna >= 0 ? 'value positive' : 'value negative'; animateNumberValue('perf-rendimiento-real', currentRna, rna, 850, '', '%'); currentRna = rna; }
    const rentabilidadPorcentajeEl = document.getElementById('perf-rentabilidad-porcentaje');
    if (rentabilidadPorcentajeEl) { const margenPesos = totalIngresosBrutos - totalGTR; rentabilidadPorcentajeEl.innerHTML = `Ganancia Estimada: <strong style="color: ${margenPesos >= 0 ? 'var(--positive)' : 'var(--negative)'};">${margenPesos >= 0 ? '' : '-'}$${margenPesos.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> (descontando GTR de $${totalGTR.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`; }
    animateNumberValue('perf-total-ingresos', currentTotalIngresos, totalIngresosBrutos, 800, '$');
    animateNumberValue('perf-total-gtr', currentTotalGtr, totalGTR, 800, '$');
    animateNumberValue('perf-total-egresos', currentTotalEgresos, totalEgresos, 800, '$');
    currentTotalIngresos = totalIngresosBrutos; currentTotalGtr = totalGTR; currentTotalEgresos = totalEgresos;
}
