// ─────────────────────────────────────────────────────────────────────────────
// WISE ERP – app.js v3.0 Multi-Tenant
// ─────────────────────────────────────────────────────────────────────────────
const API_URL = '';
let currentUser = null;
let tenantSettings = {};
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

// ─── Combobox con búsqueda (convierte <select> en buscador) ──────────────────
function _comboNorm(s) { return (s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function _comboScore(query, text) {
    const q = _comboNorm(query), t = _comboNorm(text);
    if (!q) return 1;
    if (t.includes(q)) return 3;              // contiene la combinación exacta → primero
    let i = 0;                                 // tiene las letras en orden (subsecuencia) → después
    for (const ch of t) { if (ch === q[i]) i++; if (i === q.length) return 1; }
    return 0;
}
function makeSearchable(sel) {
    if (!sel || sel.dataset.searchable) return;
    sel.dataset.searchable = '1';
    const wrap = document.createElement('div'); wrap.className = 'combo-wrap';
    sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel);
    sel.classList.add('combo-native');
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'combo-input'; inp.autocomplete = 'off';
    inp.placeholder = 'Escribí para buscar...';
    const list = document.createElement('div'); list.className = 'combo-list';
    wrap.appendChild(inp); wrap.appendChild(list);
    function render() {
        const opts = [...sel.options].filter(o => o.value !== '');
        const scored = opts.map(o => ({ o, s: _comboScore(inp.value, o.textContent) }))
            .filter(x => x.s > 0).sort((a, b) => b.s - a.s);
        list.innerHTML = scored.length
            ? scored.map(x => `<div class="combo-item" data-v="${x.o.value}">${x.o.textContent}</div>`).join('')
            : `<div class="combo-empty">Sin resultados</div>`;
    }
    inp.addEventListener('input', () => { sel.value = ''; list.style.display = 'block'; render(); });
    inp.addEventListener('focus', () => { list.style.display = 'block'; render(); });
    inp.addEventListener('blur', () => setTimeout(() => list.style.display = 'none', 150));
    list.addEventListener('mousedown', e => {
        const it = e.target.closest('.combo-item'); if (!it) return;
        sel.value = it.dataset.v; inp.value = it.textContent; list.style.display = 'none';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sel.dispatchEvent(new Event('input', { bubbles: true }));
    });
    sel.addEventListener('change', () => {
        const o = sel.options[sel.selectedIndex];
        if (document.activeElement !== inp) inp.value = (o && o.value) ? o.textContent : '';
    });
    const form = sel.closest('form');
    if (form) form.addEventListener('reset', () => setTimeout(() => { inp.value = ''; }, 0));
}

// ─── Buscador para tablas de historial ────────────────────────────────────────
function addTableSearch(tbodyId, placeholder = 'Buscar por cualquier dato...') {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const container = tbody.closest('.table-container');
    if (!container) return;
    if (container.previousElementSibling && container.previousElementSibling.classList && container.previousElementSibling.classList.contains('table-search-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'table-search-bar';
    bar.innerHTML = `<span class="material-symbols-outlined">search</span><input type="text" placeholder="${placeholder}" autocomplete="off">`;
    container.parentNode.insertBefore(bar, container);
    const inp = bar.querySelector('input');
    inp.addEventListener('input', () => {
        const q = _comboNorm(inp.value);
        tbody.querySelectorAll('tr').forEach(tr => {
            if (tr.classList.contains('ingredient-row')) return; // siguen a su fila padre
            const match = !q || _comboNorm(tr.textContent).includes(q);
            tr.style.display = match ? '' : 'none';
            let next = tr.nextElementSibling;
            while (next && next.classList.contains('ingredient-row')) {
                if (!match) { next.style.display = 'none'; next.classList.remove('show'); }
                next = next.nextElementSibling;
            }
        });
    });
}

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
    ensureTabs(secId);
    applyFieldParams(secId);
    applyRolePerms(secId);
    if (secId === 'sec-performance') loadMetrics();
    if (secId === 'sec-ventas') { loadClientsDropdown(); loadStockDropdown(); loadSalesHistory(); setNow('sale-date'); }
    if (secId === 'sec-gastos') { loadCategories(); loadProvidersDropdown(); loadExpensesHistory(); setNow('exp-date'); if (expCont && expCont.children.length === 0) addExpRow(); }
    if (secId === 'sec-ingresos') { loadProductsDropdown('prodrun-product'); loadProductionHistory(); setNow('prodrun-date'); }
    if (secId === 'sec-clientes') loadClients();
    if (secId === 'sec-proveedores') { loadCategories(); loadProviders(); }
    if (secId === 'sec-escandallos') { loadIngredientsCache().then(() => { loadEscandalloTable(); if (escCont && escCont.children.length === 0) addEscRow(); }); }
    if (secId === 'sec-usuarios') loadUsers();
    if (secId === 'sec-almacen') loadWarehouse();
    // Buscadores en historiales (se crean una sola vez por tabla)
    const searchTargets = {
        'sec-ventas': ['sales-history-tbody', 'Buscar por fecha, cliente, monto...'],
        'sec-gastos': ['expenses-history-tbody', 'Buscar por fecha, proveedor, categoría...'],
        'sec-ingresos': ['prodrun-tbody', 'Buscar por fecha o artículo...'],
        'sec-clientes': ['clients-tbody', 'Buscar por nombre o teléfono...'],
        'sec-proveedores': ['providers-tbody', 'Buscar por nombre, categoría, tipo...'],
        'sec-escandallos': ['escandallo-tbody', 'Buscar por artículo, tipo, precio...'],
        'sec-almacen': ['warehouse-tbody', 'Buscar insumo...'],
    };
    if (searchTargets[secId]) addTableSearch(searchTargets[secId][0], searchTargets[secId][1]);
}

async function loadWarehouse() {
    const tbody = document.getElementById('warehouse-tbody');
    tbody.innerHTML = `<tr class="skeleton-row"><td colspan="5"><div class="skeleton-bar"></div></td></tr><tr class="skeleton-row"><td colspan="5"><div class="skeleton-bar"></div></td></tr>`;
    try {
        const res = await apiFetch('/warehouse');
        const data = await res.json();
        tbody.innerHTML = data.length === 0
            ? `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px;">Todavía no hay insumos. Cargá gastos con la categoría INSUMOS y van a aparecer acá.</td></tr>`
            : data.map(w => {
                const low = w.stock <= 0;
                const stockTag = low ? `<span class="tag tag-red">${w.stock}</span>` : `<span class="tag tag-green">${w.stock}</span>`;
                return `<tr><td><strong>${w.name}</strong></td><td style="text-align:center;">${w.purchased}</td><td style="text-align:center;">${w.consumed}</td><td style="text-align:center;">${stockTag}</td><td style="text-align:right;">$${(w.last_cost || 0).toFixed(2)}</td></tr>`;
            }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--negative);padding:20px;">Error al cargar el almacén.</td></tr>`;
    }
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
        if (data.custom_role) localStorage.setItem('wise_custom_role', data.custom_role);
        else localStorage.removeItem('wise_custom_role');
        if (data.role === 'SuperAdmin') setupSuperAdmin();
        else bootAndShowDashboard();
    } else {
        errEl.textContent = 'ERROR DE ACCESO – Usuario o contraseña incorrectos';
    }
});

// ─── Pantalla de carga inicial (precarga de datos) ────────────────────────────
const BOOT_QUOTES = [
    ["El trabajo diario pone el 49% del esfuerzo, pero es el favor de Dios el 51% que inclina la balanza hacia el éxito.", "Máxima del Emprendedor"],
    ["Los planes bien pensados pura ganancia traen; los que se hacen a las apuradas, van directo al fracaso.", "Rey Salomón (Proverbios 21:5)"],
    ["Puedes obtener todo lo que deseas en los negocios si primero ayudas a suficientes personas a obtener lo que ellas necesitan.", "Zig Ziglar"],
    ["Una meta de negocio sin un plan financiero ordenado es solamente un deseo en el aire.", "Dave Ramsey"],
    ["Trata a tus clientes y proveedores como te gustaría ser tratado a ti; esa regla nunca pasa de moda.", "Mary Kay Ash (Fundadora de Mary Kay Cosmetics)"],
    ["La integridad en los negocios es hacer lo correcto con tus números y tus cuentas, incluso cuando nadie te está mirando.", "C.S. Lewis"],
    ["Los proyectos fracasan por falta de consejo, pero prosperan cuando escuchas las métricas correctas y las opiniones sabias.", "Libro de la Sabiduría (Proverbios 15:22)"],
    ["No te canses de hacer las cosas bien en lo pequeño hoy; a su debido tiempo cosecharás los frutos de tu constancia.", "Apóstol Pablo (Gálatas 6:9)"],
    ["Si nos enfocamos obsesivamente en ser mejores en lo que hacemos, el crecimiento del negocio se cuidará solo.", "S. Truett Cathy (Fundador de Chick-fil-A)"],
    ["Los recursos y los talentos no se hicieron para enterrarse por miedo al mercado, sino para multiplicarse con buena administración.", "Principio de la Mayordomía"],
];
function _bootSetProgress(done, total) {
    const pct = total ? Math.round(done / total * 100) : 100;
    const arc = document.getElementById('boot-pie-arc');
    const circ = 314.16;
    if (arc) arc.style.strokeDashoffset = String(circ * (1 - pct / 100));
    const t = document.getElementById('boot-pie-pct');
    if (t) t.textContent = pct + '%';
}
async function bootAndShowDashboard() {
    const loader = document.getElementById('boot-loader');
    const [quote, author] = BOOT_QUOTES[Math.floor(Math.random() * BOOT_QUOTES.length)];
    document.getElementById('boot-quote').textContent = `"${quote}"`;
    document.getElementById('boot-quote-author').textContent = `— ${author}`;
    _bootSetProgress(0, 1);
    loader.style.display = 'flex';
    // Precarga en paralelo de todos los datos de las planillas
    const tasks = [
        loadSettings(),
        loadClientsDropdown(), loadStockDropdown(), loadSalesHistory(),
        loadCategories(), loadProvidersDropdown(), loadExpensesHistory(),
        loadProductsDropdown('prodrun-product'), loadProductionHistory(),
        loadClients(), loadProviders(),
        loadIngredientsCache().then(() => loadEscandalloTable()),
        loadWarehouse(),
    ];
    let done = 0;
    const total = tasks.length;
    await Promise.allSettled(tasks.map(p => Promise.resolve(p).catch(() => {}).then(() => { done++; _bootSetProgress(done, total); })));
    _bootSetProgress(total, total);
    populateRoleSelect();
    setTimeout(() => {
        loader.classList.add('boot-hide');
        setTimeout(() => { loader.style.display = 'none'; loader.classList.remove('boot-hide'); }, 450);
        setupDashboard();
        // Tutorial de bienvenida la primera vez que el usuario entra
        if (currentUser && currentUser.username && !localStorage.getItem('wise_tuto_seen_' + currentUser.username)) {
            setTimeout(() => startTutorial(), 600);
        }
    }, 350);
}

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
        currentUser = { token, username: payload.username, role: payload.role, tenant_id: payload.tenant_id, custom_role: localStorage.getItem('wise_custom_role') || null };
        if (payload.role === 'SuperAdmin') setupSuperAdmin();
        else bootAndShowDashboard();
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
        addNavGroup('payments', 'CASHFLOW', [
            { icon: 'point_of_sale', text: 'VENTAS', secId: 'sec-ventas' },
            { icon: 'receipt_long', text: 'GASTOS', secId: 'sec-gastos' },
        ]);
        addNavGroup('contacts', 'DIRECTORIO', [
            { icon: 'person', text: 'CLIENTES', secId: 'sec-clientes' },
            { icon: 'local_shipping', text: 'PROVEEDORES', secId: 'sec-proveedores' },
        ]);
        addNavGroup('inventory', 'INVENTARIO', [
            { icon: 'conveyor_belt', text: 'INGRESOS', secId: 'sec-ingresos' },
            { icon: 'inventory_2', text: 'ARTÍCULOS', secId: 'sec-escandallos' },
            { icon: 'warehouse', text: 'ALMACÉN', secId: 'sec-almacen' },
        ]);
        addNav('manage_accounts', 'USUARIOS', 'sec-usuarios');
        switchSection('sec-performance', 'PERFORMANCE');
    } else {
        // Operator: si tiene rol personalizado, mostrar solo las planillas habilitadas
        const roleDef = currentUser.custom_role ? getRoles().find(r => r.name === currentUser.custom_role) : null;
        if (roleDef && roleDef.perms && Object.keys(roleDef.perms).length) {
            let first = null;
            PERM_TREE.forEach(pl => {
                if (roleDef.perms[pl.sec] && roleDef.perms[pl.sec].on) {
                    addNav(pl.icon, pl.label, pl.sec, !first);
                    if (!first) first = { sec: pl.sec, label: pl.label };
                }
            });
            if (first) switchSection(first.sec, first.label);
            else { addNav('point_of_sale', 'VENTAS', 'sec-ventas', true); switchSection('sec-ventas', 'VENTAS'); }
        } else {
            addNav('point_of_sale', 'VENTAS', 'sec-ventas', true);
            switchSection('sec-ventas', 'VENTAS');
        }
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

function addNavGroup(icon, text, children) {
    const li = document.createElement('li');
    li.className = 'nav-group';
    const a = document.createElement('a'); a.href = '#';
    a.innerHTML = `<span class="material-symbols-outlined">${icon}</span> ${text} <span class="material-symbols-outlined nav-group-arrow" style="margin-left:auto;font-size:1.1rem;">expand_more</span>`;
    a.addEventListener('click', e => e.preventDefault());
    const sub = document.createElement('ul');
    sub.className = 'nav-submenu';
    children.forEach(ch => {
        const subLi = document.createElement('li');
        const subA = document.createElement('a'); subA.href = '#';
        subA.innerHTML = `<span class="material-symbols-outlined">${ch.icon}</span> ${ch.text}`;
        subA.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('#nav-links a').forEach(l => l.classList.remove('active'));
            subA.classList.add('active'); a.classList.add('active');
            switchSection(ch.secId, ch.text);
        });
        subLi.appendChild(subA); sub.appendChild(subLi);
    });
    li.appendChild(a); li.appendChild(sub);
    document.getElementById('nav-links').appendChild(li);
}

// ─── User Management (Admin de instancia) ─────────────────────────────────────
async function loadUsers() {
    const res = await apiFetch('/users');
    const users = await res.json();
    const roleColors = { Admin: 'tag-blue', Operator: 'tag-green' };
    document.getElementById('users-tbody').innerHTML = users.map(u => `
        <tr>
            <td><strong>${u.username}</strong></td>
            <td><span class="tag ${u.custom_role ? 'tag-purple' : (roleColors[u.role] || 'tag-green')}">${u.custom_role || u.role}</span></td>
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
    const roleVal = document.getElementById('new-user-role').value;
    const isCustomRole = roleVal !== 'Admin' && roleVal !== 'Operator';
    const passMode = document.getElementById('new-user-pass-mode').value;
    const payload = {
        username: document.getElementById('new-user-username').value.trim(),
        email: document.getElementById('new-user-email').value.trim() || null,
        role: isCustomRole ? 'Operator' : roleVal,
        custom_role: isCustomRole ? roleVal : null,
        phone: document.getElementById('new-user-phone').value.trim() || null,
        password: passMode === 'manual' ? document.getElementById('new-user-password').value : null,
    };
    if (passMode === 'manual' && (!payload.password || payload.password.length < 6)) {
        m.textContent = 'La contraseña manual debe tener al menos 6 caracteres'; m.className = 'error-msg';
        submitBtn.disabled = false; submitBtn.innerHTML = originalHtml; return;
    }
    if (passMode === 'auto' && !payload.email) {
        m.textContent = 'Con contraseña automática necesitás indicar un correo'; m.className = 'error-msg';
        submitBtn.disabled = false; submitBtn.innerHTML = originalHtml; return;
    }
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
        allProductsCache = products;
        tbody.innerHTML = '';
        if (products.length === 0) { tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:20px;">No hay artículos creados todavía.</td></tr>`; return; }
        // Artículos subcategorizados: en la planilla se previsualiza solo el nombre del
        // grupo; las variantes se ven con el desplegable.
        const groupsMap = new Map();
        const singles = [];
        for (const prod of products) {
            if (prod.subcat_group) {
                if (!groupsMap.has(prod.subcat_group)) groupsMap.set(prod.subcat_group, []);
                groupsMap.get(prod.subcat_group).push(prod);
            } else singles.push(prod);
        }
        let gi = 0;
        for (const [grp, items] of groupsMap) {
            const variantRows = items.map(p => `<tr class="ingredient-row row-sgrp-${gi}"><td></td><td style="padding-left:30px;color:var(--text-muted);"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">subdirectory_arrow_right</span> ${p.name}</td><td></td><td>-</td><td style="text-align:center;">${(p.min_stock && p.min_stock > 0) ? p.min_stock + ' u.' : '-'}</td><td>$${p.price.toFixed(2)}</td><td>$${(p.gpu || 0).toFixed(2)}</td><td style="white-space:nowrap;"><button class="btn secondary outline btn-icon" onclick="viewProduct(${p.id},'${(p.name||'').replace(/'/g,'')}',${p.price},${p.yield||1},${p.min_stock||0},'SIMPLE')" title="Ver"><span class="material-symbols-outlined">visibility</span></button></td></tr>`).join('');
            tbody.innerHTML += `<tr class="group-header"><td style="text-align:center;"><span class="material-symbols-outlined toggle-btn" onclick="toggleGrp(${gi},this)">expand_more</span></td><td><strong>${grp}</strong> <span class="tag tag-purple" style="font-size:0.7rem;">SUBCATEGORIZADO · ${items.length}</span></td><td><span class="tag tag-blue" style="font-size:0.7rem;">SIMPLE</span></td><td>-</td><td style="text-align:center;">-</td><td>-</td><td>-</td><td></td></tr>${variantRows}`;
            gi++;
        }
        for (const prod of singles) {
            const isSimple = (prod.article_type === 'SIMPLE');
            let ingredients = [];
            if (!isSimple) {
                try { const ingRes = await apiFetch(`/recipes/${prod.id}`); if (ingRes.ok) ingredients = await ingRes.json(); } catch(_) {}
            }
            const ingHtml = ingredients.map(ing => `<tr class="ingredient-row row-prod-${prod.id}"><td></td><td></td><td style="padding-left:30px;color:var(--text-muted);"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">subdirectory_arrow_right</span> ${ing.name}</td><td colspan="3" class="text-muted">Cant: ${ing.quantity}</td><td colspan="2" class="text-muted">$${(ing.quantity * ing.cost).toFixed(2)}</td></tr>`).join('');
            const minStockText = (prod.min_stock && prod.min_stock > 0) ? `${prod.min_stock} u.` : '-';
            const typeTag = isSimple
                ? `<span class="tag tag-blue" style="font-size:0.7rem;">SIMPLE</span>`
                : `<span class="tag tag-green" style="font-size:0.7rem;">COMPUESTO</span>`;
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
function toggleGrp(gi, el) { document.querySelectorAll(`.row-sgrp-${gi}`).forEach(r => r.classList.toggle('show')); el.textContent = el.textContent === 'expand_more' ? 'expand_less' : 'expand_more'; }
let allProductsCache = [];

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
    updateSubcatVisibility();
}
document.getElementById('article-type-formula-btn').addEventListener('click', () => setArticleType('FORMULA'));
document.getElementById('article-type-simple-btn').addEventListener('click', () => setArticleType('SIMPLE'));
setArticleType('FORMULA');

let editingProductSubcat = null;
function editProduct(id, name, price, yld, minStock, articleType) {
    editingProductId = id;
    editingProductSubcat = ((allProductsCache.find(p => p.id === id) || {}).subcat_group) || null;
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
document.getElementById('cancel-edit-product-btn').addEventListener('click', () => { editingProductId = null; editingProductSubcat = null; document.getElementById('escandallo-form').reset(); document.getElementById('esc-min-stock').value = 0; escCont.innerHTML = ''; addEscRow(); updateEscTotals(); setArticleType('FORMULA'); document.getElementById('cancel-edit-product-btn').style.display = 'none'; });
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
    // SUBCATEGORIZACIÓN: si está activa, se crea un artículo por cada combinación de variables
    if (!editingProductId && isSimple && subcatFormActive()) {
        await handleSubcatSubmit(sabor, price, minStock, submitBtn, originalHtml, e.target);
        return;
    }
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
            const updRes = await apiFetch(`/products/${productId}`, { method: 'PUT', body: JSON.stringify({ flavor_name: sabor, sale_price: price, yield_per_batch: yld, min_stock: minStock, article_type: articleType, subcat_group: editingProductSubcat }) });
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
                e.target.reset(); escCont.innerHTML = ''; addEscRow(); editingProductId = null; editingProductSubcat = null; setArticleType('FORMULA'); document.getElementById('cancel-edit-product-btn').style.display = 'none'; loadEscandalloTable();
                const m = document.getElementById('esc-msg'); m.textContent = 'ARTÍCULO GUARDADO'; m.className = 'success-msg'; setTimeout(() => m.textContent = '', 3000);
            }, 1500);
        }
    } catch (err) {
        const m = document.getElementById('esc-msg'); m.textContent = err.message || 'Error inesperado'; m.className = 'error-msg'; setTimeout(() => m.textContent = '', 5000);
        submitBtn.disabled = false; submitBtn.innerHTML = originalHtml;
    }
});
let _pendingProductEdit = null;
function viewProduct(id, name, price, yld, minStock, articleType) {
    _pendingProductEdit = { id, name, price, yld, minStock, articleType };
    const typeLabel = articleType === 'SIMPLE' ? 'SIMPLE (reventa)' : 'COMPUESTO (fabricado)';
    document.getElementById('modal-title').textContent = name;
    document.getElementById('modal-body').innerHTML = `
        <table class="data-table"><tbody>
            <tr><td style="color:var(--text-muted);width:40%;">TIPO</td><td>${typeLabel}</td></tr>
            <tr><td style="color:var(--text-muted);">PRECIO DE VENTA</td><td><strong>$${parseFloat(price).toFixed(2)}</strong></td></tr>
            <tr><td style="color:var(--text-muted);">RENDIMIENTO</td><td>${articleType === 'SIMPLE' ? '-' : yld + ' u.'}</td></tr>
            <tr><td style="color:var(--text-muted);">STOCK MÍNIMO</td><td>${minStock > 0 ? minStock + ' u.' : '-'}</td></tr>
        </tbody></table>
        <div style="display:flex;gap:10px;margin-top:20px;border-top:1px solid var(--surface-border);padding-top:16px;">
            <button class="btn secondary outline" style="flex:1;" onclick="closeModal();if(_pendingProductEdit){const p=_pendingProductEdit;editProduct(p.id,p.name,p.price,p.yld,p.minStock,p.articleType);}"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">edit</span> EDITAR</button>
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
    if (el) { el.innerHTML = '<option value="">SELECCIONAR CLIENTE...</option>' + data.map(c => `<option value="${c.name}">${c.name}</option>`).join(''); makeSearchable(el); }
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
    // Solo se pueden vender artículos que existen en el stock disponible (stock > 0)
    const sellable = allStockProducts.filter(p => (p.stock || 0) > 0 || p.id == prodId);
    row.innerHTML = `<select class="sale-item-prod" required><option value="">SABOR...</option>${sellable.map(p => `<option value="${p.id}" ${p.id == prodId ? 'selected' : ''}>${p.name} (${p.stock} u.)</option>`).join('')}</select><input type="number" class="sale-item-qty" placeholder="CANT." required value="${qty}"><button type="button" class="btn secondary outline remove-sale-item btn-icon"><span class="material-symbols-outlined">close</span></button>`;
    saleCont.appendChild(row);
    makeSearchable(row.querySelector('.sale-item-prod'));
    updateSaleTotals();
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
    document.getElementById('sales-history-tbody').innerHTML = data.map(s => `<tr><td>${s.date.replace('T', ' ')}</td><td><strong>${s.client}</strong></td><td>${s.discount}</td><td><strong>$${s.total.toFixed(2)}</strong></td><td><span class="tag tag-red">$${s.gpu ? s.gpu.toFixed(2) : '0.00'}</span></td><td><button class="btn secondary outline btn-icon" onclick="viewSaleDetails(${s.id})" title="Ver"><span class="material-symbols-outlined">visibility</span></button></td></tr>`).join('');
}
async function viewSaleDetails(id) {
    const [salesRes, itemsRes] = await Promise.all([apiFetch('/sales'), apiFetch(`/sales/${id}/items`)]);
    const allSales = await salesRes.json(); const items = await itemsRes.json();
    const sale = allSales.find(s => s.id === id) || {};
    const clientName = (sale.client || '').replace(/"/g, '&quot;');
    document.getElementById('modal-title').textContent = `VENTA #${id}`;
    document.getElementById('modal-body').innerHTML = `
        <table class="data-table"><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>COGS (Unit)</th><th>COGS (Total)</th></tr></thead>
        <tbody>${items.map(i => `<tr><td>${i.product}</td><td>${i.quantity}</td><td>$${i.unit_price.toFixed(2)}</td><td>$${i.gpu.toFixed(2)}</td><td>$${(i.gpu * i.quantity).toFixed(2)}</td></tr>`).join('')}</tbody></table>
        <div id="sale-edit-form" style="display:none;margin-top:16px;border-top:1px solid var(--surface-border);padding-top:16px;">
            <div class="form-row"><div class="input-group"><label>CLIENTE</label><input id="modal-sale-client" type="text" value="${clientName}"></div><div class="input-group"><label>DESCUENTO ($)</label><input id="modal-sale-discount" type="number" step="0.01" value="0"></div></div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:10px;"><button class="btn secondary outline" onclick="document.getElementById('sale-edit-form').style.display='none'">CANCELAR</button><button class="btn primary" onclick="saveSaleEdit(${id})">GUARDAR CAMBIOS</button></div>
        </div>
        <div style="display:flex;gap:10px;margin-top:20px;border-top:1px solid var(--surface-border);padding-top:16px;">
            <button class="btn secondary outline" style="flex:1;" onclick="document.getElementById('sale-edit-form').style.display==='none'?document.getElementById('sale-edit-form').style.display='block':document.getElementById('sale-edit-form').style.display='none'"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">edit</span> EDITAR</button>
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
        makeSearchable(el);
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
    const el = document.getElementById(id);
    if (el) { el.innerHTML = '<option value="">SELECCIONAR ARTÍCULO...</option>' + data.map(p => `<option value="${p.id}">${p.name}</option>`).join(''); makeSearchable(el); }
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
            ? `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px;">No hay proveedores cargados todavía.</td></tr>`
            : allProviders.map(p => `<tr><td>${p.name}</td><td>${p.category}</td><td>${p.is_resale ? '<span class="tag tag-purple" style="font-size:0.7rem;">COMPRA/VENTA</span>' : '<span class="tag tag-blue" style="font-size:0.7rem;">GENERAL</span>'}</td><td style="white-space:nowrap;"><button class="btn secondary outline btn-icon" onclick="viewProvider(${p.id})" title="Ver"><span class="material-symbols-outlined">visibility</span></button></td></tr>`).join('');
    } catch(err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--negative);padding:20px;">Error al cargar. Recargá la página.</td></tr>`;
    }
}
document.getElementById('provider-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="material-symbols-outlined animate-spin" style="font-size:1.1rem;vertical-align:middle;">sync</span> GUARDANDO...';
    const payload = {
        name: document.getElementById('prov-name').value.trim(),
        category_name: document.getElementById('prov-cat').value,
        is_resale: document.getElementById('prov-is-resale').checked,
        phone: (document.getElementById('prov-phone') || {}).value || null,
        location: (document.getElementById('prov-location') || {}).value || null,
        delivery_time: (document.getElementById('prov-delivery') || {}).value || null,
        observations: (document.getElementById('prov-obs') || {}).value || null,
    };
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
function viewProvider(id) {
    const p = (allProviders || []).find(x => x.id === id) || {};
    _editingProviderId = id;
    const name = p.name || '', category = p.category || '';
    const tipoTag = p.is_resale ? '<span class="tag tag-purple">COMPRA/VENTA</span>' : '<span class="tag tag-blue">GENERAL</span>';
    document.getElementById('modal-title').textContent = `PROVEEDOR`;
    document.getElementById('modal-body').innerHTML = `
        <table class="data-table"><tbody><tr><td style="color:var(--text-muted);width:35%;">NOMBRE</td><td><strong>${name}</strong></td></tr><tr><td style="color:var(--text-muted);">CATEGORÍA</td><td>${category}</td></tr><tr><td style="color:var(--text-muted);">TIPO</td><td>${tipoTag}</td></tr></tbody></table>
        <div id="prov-edit-form" style="display:none;margin-top:16px;border-top:1px solid var(--surface-border);padding-top:16px;">
            <div class="form-row"><div class="input-group"><label>NOMBRE</label><input id="modal-prov-name" type="text"></div><div class="input-group"><label>CATEGORÍA</label><select id="modal-prov-cat"></select></div></div>
            <label style="display:flex;align-items:center;gap:8px;margin:6px 0 10px;cursor:pointer;font-size:0.82rem;color:var(--text-muted);">
                <input type="checkbox" id="modal-prov-is-resale" style="width:15px;height:15px;accent-color:var(--primary);cursor:pointer;" ${p.is_resale ? 'checked' : ''}>
                <span>PROVEEDOR DE COMPRA/VENTA</span>
            </label>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:10px;"><button class="btn secondary outline" onclick="document.getElementById('prov-edit-form').style.display='none'">CANCELAR</button><button class="btn primary" onclick="saveProviderEdit(${id})">GUARDAR</button></div>
        </div>
        <div style="display:flex;gap:10px;margin-top:20px;border-top:1px solid var(--surface-border);padding-top:16px;">
            <button class="btn secondary outline" style="flex:1;" onclick="toggleProviderEditForm(${id})"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">edit</span> EDITAR</button>
            <button class="btn" style="flex:1;background:var(--negative);color:white;" onclick="deleteProvider(${id})"><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">delete</span> ELIMINAR</button>
        </div>`;
    document.getElementById('detail-modal').style.display = 'block';
}
async function toggleProviderEditForm(id) {
    const form = document.getElementById('prov-edit-form');
    if (form.style.display === 'none') {
        const p = (allProviders || []).find(x => x.id === id) || {};
        document.getElementById('modal-prov-name').value = p.name || '';
        const catSel = document.getElementById('modal-prov-cat');
        const catRes = await apiFetch('/categories'); const cats = await catRes.json();
        catSel.innerHTML = cats.map(c => `<option value="${c.name}" ${c.name === p.category ? 'selected' : ''}>${c.name}</option>`).join('');
        form.style.display = 'block';
    } else { form.style.display = 'none'; }
}
async function saveProviderEdit(id) {
    const name = document.getElementById('modal-prov-name').value.trim();
    const category_name = document.getElementById('modal-prov-cat').value;
    const is_resale = document.getElementById('modal-prov-is-resale').checked;
    const res = await apiFetch(`/providers/${id}`, { method: 'PUT', body: JSON.stringify({ name, category_name, is_resale }) });
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

// ═════════════════════════════════════════════════════════════════════════════
// PARAMETRIZACIÓN, TABS, ROLES y MIGRAR DATOS
// ═════════════════════════════════════════════════════════════════════════════

async function loadSettings() {
    try { const r = await apiFetch('/settings'); if (r.ok) tenantSettings = await r.json(); } catch (e) {}
}
async function saveSetting(key, value) {
    tenantSettings[key] = value;
    try { await apiFetch('/settings', { method: 'PUT', body: JSON.stringify({ key, value }) }); } catch (e) {}
}
function getParamConfig(secId) {
    try { return JSON.parse(tenantSettings['params_' + secId] || '{}'); } catch (e) { return {}; }
}

// ─── Manual de campos opcionales por planilla ─────────────────────────────────
const PARAM_FIELDS = {
    'sec-clientes': [
        { key: 'client-phone', label: 'TELÉFONO', desc: 'Número de contacto del cliente. Útil para avisarle pedidos listos o promociones.', def: true },
    ],
    'sec-proveedores': [
        { key: 'prov-phone', label: 'TELÉFONO', desc: 'Número de contacto del proveedor para hacer pedidos.', def: false },
        { key: 'prov-location', label: 'UBICACIÓN', desc: 'Dirección o zona del proveedor.', def: false },
        { key: 'prov-delivery', label: 'PLAZO DE ENTREGA', desc: 'Cuánto tarda en entregar desde que hacés el pedido (ej: 48 hs).', def: false },
        { key: 'prov-obs', label: 'OBSERVACIONES', desc: 'Notas libres: condiciones de pago, mínimos de compra, etc.', def: false },
    ],
    'sec-ventas': [
        { key: 'sale-discount-group', label: 'DESCUENTO', desc: 'Permite aplicar descuento por monto o porcentaje al registrar una venta.', def: true },
    ],
    'sec-escandallos': [
        { key: 'esc-min-stock', label: 'STOCK MÍNIMO', desc: 'Alerta en PERFORMANCE cuando el stock cae por debajo de este número.', def: true },
    ],
};

function applyFieldParams(secId) {
    const fields = PARAM_FIELDS[secId];
    if (!fields) return;
    const cfg = getParamConfig(secId);
    fields.forEach(f => {
        const fcfg = cfg[f.key] || { on: f.def, req: false };
        let group = document.querySelector(`.param-field[data-param="${f.key}"]`);
        if (!group) {
            const el = document.getElementById(f.key);
            group = el ? el.closest('.input-group') : null;
        }
        if (!group) return;
        group.style.display = fcfg.on ? '' : 'none';
        const input = group.querySelector('input, select');
        if (input) {
            if (fcfg.on && fcfg.req) input.setAttribute('required', '');
            else input.removeAttribute('required');
        }
    });
}

// ─── Árbol de permisos para ROLES (USUARIOS → PARAMETRIZACIÓN) ────────────────
const PERM_TREE = [
    { sec: 'sec-ventas', label: 'VENTAS', icon: 'point_of_sale', funcs: [
        { k: 'registrar', label: 'REGISTRAR VENTAS' },
        { k: 'historial', label: 'HISTORIAL DE VENTAS', subs: ['VER', 'EDITAR', 'ELIMINAR'] },
        { k: 'param', label: 'PARAMETRIZACIÓN' } ] },
    { sec: 'sec-gastos', label: 'GASTOS', icon: 'receipt_long', funcs: [
        { k: 'registrar', label: 'REGISTRAR GASTOS' },
        { k: 'historial', label: 'HISTORIAL DE GASTOS', subs: ['VER', 'EDITAR', 'ELIMINAR'] },
        { k: 'param', label: 'PARAMETRIZACIÓN' } ] },
    { sec: 'sec-ingresos', label: 'INGRESOS', icon: 'conveyor_belt', funcs: [
        { k: 'registrar', label: 'REGISTRAR INGRESOS' },
        { k: 'historial', label: 'HISTORIAL', subs: ['VER', 'EDITAR', 'ELIMINAR'] } ] },
    { sec: 'sec-clientes', label: 'CLIENTES', icon: 'person', funcs: [
        { k: 'registrar', label: 'REGISTRAR CLIENTES' },
        { k: 'historial', label: 'LISTA DE CLIENTES', subs: ['VER', 'EDITAR', 'ELIMINAR'] } ] },
    { sec: 'sec-proveedores', label: 'PROVEEDORES', icon: 'local_shipping', funcs: [
        { k: 'registrar', label: 'REGISTRAR PROVEEDORES' },
        { k: 'historial', label: 'LISTA DE PROVEEDORES', subs: ['VER', 'EDITAR', 'ELIMINAR'] },
        { k: 'param', label: 'PARAMETRIZACIÓN' } ] },
    { sec: 'sec-escandallos', label: 'ARTÍCULOS', icon: 'inventory_2', funcs: [
        { k: 'registrar', label: 'GESTIÓN DE ARTÍCULOS' },
        { k: 'historial', label: 'PLANILLA DE ARTÍCULOS', subs: ['VER', 'EDITAR', 'ELIMINAR'] } ] },
    { sec: 'sec-almacen', label: 'ALMACÉN', icon: 'warehouse', funcs: [
        { k: 'historial', label: 'STOCK DE INSUMOS', subs: ['VER'] } ] },
];

function getRoles() {
    try { return JSON.parse(tenantSettings['roles'] || '[]'); } catch (e) { return []; }
}

// ─── Permisos efectivos del usuario logueado (rol personalizado) ──────────────
function getMyPerms() {
    if (!currentUser || currentUser.role === 'Admin' || currentUser.role === 'SuperAdmin') return null;
    if (!currentUser.custom_role) return null;
    const r = getRoles().find(x => x.name === currentUser.custom_role);
    return r ? (r.perms || {}) : null;
}

// Oculta dentro de la planilla activa todo lo que el rol no tiene habilitado:
// formulario de registro, historial, botones VER/EDITAR/ELIMINAR y los tabs de
// PARAMETRIZACIÓN / MIGRAR DATOS (requieren la función "param" del rol).
function applyRolePerms(secId) {
    document.body.classList.remove('perm-no-ver', 'perm-no-edit', 'perm-no-del');
    const sec = document.getElementById(secId);
    if (!sec) return;
    sec.classList.remove('perm-no-reg', 'perm-no-hist');
    const perms = getMyPerms();
    if (!perms) return; // Admin / Operator sin rol personalizado: sin restricciones extra
    const plDef = PERM_TREE.find(x => x.sec === secId);
    if (!plDef) return; // secciones fuera del árbol de permisos (ej: usuarios) no aplican
    const p = perms[secId] || {};
    const funcs = p.funcs || {};
    const hasRegFunc = plDef.funcs.some(f => f.k === 'registrar');
    const regOn = !!(funcs.registrar && funcs.registrar.on);
    const hist = funcs.historial || {};
    const subs = hist.subs || {};
    const paramOn = !!(funcs.param && funcs.param.on);
    sec.classList.toggle('perm-no-reg', hasRegFunc && !regOn);
    sec.classList.toggle('perm-no-hist', !hist.on);
    if (hist.on) {
        if (!subs.VER) document.body.classList.add('perm-no-ver');
        if (!subs.EDITAR) document.body.classList.add('perm-no-edit');
        if (!subs.ELIMINAR) document.body.classList.add('perm-no-del');
    }
    sec.querySelectorAll(':scope > .section-tabs .section-tab').forEach(t => {
        if (t.dataset.tab !== 'funciones') t.style.display = paramOn ? '' : 'none';
    });
}

// ─── Sistema de TABS por sección ──────────────────────────────────────────────
const TABBED_SECTIONS = ['sec-ventas', 'sec-gastos', 'sec-ingresos', 'sec-clientes', 'sec-proveedores', 'sec-escandallos', 'sec-almacen', 'sec-usuarios'];

function ensureTabs(secId) {
    if (!TABBED_SECTIONS.includes(secId)) return;
    const sec = document.getElementById(secId);
    if (!sec || sec.dataset.tabbed) return;
    sec.dataset.tabbed = '1';
    const funcPanel = document.createElement('div');
    funcPanel.className = 'tab-panel active'; funcPanel.dataset.tab = 'funciones';
    while (sec.firstChild) funcPanel.appendChild(sec.firstChild);
    const bar = document.createElement('div'); bar.className = 'section-tabs';
    bar.innerHTML = `
        <button class="section-tab active" data-tab="funciones"><span class="material-symbols-outlined">apps</span> FUNCIONES</button>
        <button class="section-tab" data-tab="param"><span class="material-symbols-outlined">tune</span> PARAMETRIZACIÓN</button>
        <button class="section-tab" data-tab="migrar"><span class="material-symbols-outlined">sync_alt</span> MIGRAR DATOS</button>`;
    const paramPanel = document.createElement('div');
    paramPanel.className = 'tab-panel'; paramPanel.dataset.tab = 'param';
    const migrarPanel = document.createElement('div');
    migrarPanel.className = 'tab-panel'; migrarPanel.dataset.tab = 'migrar';
    sec.appendChild(bar); sec.appendChild(funcPanel); sec.appendChild(paramPanel); sec.appendChild(migrarPanel);
    bar.addEventListener('click', e => {
        const b = e.target.closest('.section-tab'); if (!b) return;
        bar.querySelectorAll('.section-tab').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        sec.querySelectorAll(':scope > .tab-panel').forEach(p => p.classList.toggle('active', p.dataset.tab === b.dataset.tab));
        if (b.dataset.tab === 'param') renderParamPanel(secId, paramPanel);
        if (b.dataset.tab === 'migrar') renderMigrarPanel(secId, migrarPanel);
    });
}

// ─── Panel PARAMETRIZACIÓN ────────────────────────────────────────────────────
function renderParamPanel(secId, panel) {
    const fields = PARAM_FIELDS[secId] || [];
    const cfg = getParamConfig(secId);
    let html = `<div class="card"><h3 style="display:flex;align-items:center;gap:8px;"><span class="material-symbols-outlined" style="color:var(--primary);">tune</span> CAMPOS DE ESTA PLANILLA</h3>`;
    if (!fields.length) {
        html += `<p style="color:var(--text-muted);font-size:0.9rem;">Esta planilla no tiene campos configurables por ahora.</p>`;
    } else {
        html += fields.map(f => {
            const fc = cfg[f.key] || { on: f.def, req: false };
            return `<div class="param-row">
                <label class="param-check">
                    <input type="checkbox" data-pf="${f.key}" ${fc.on ? 'checked' : ''}>
                    <div><strong>${f.label}</strong><p>${f.desc}</p></div>
                </label>
                <label class="param-req" style="${fc.on ? '' : 'visibility:hidden;'}">
                    <input type="checkbox" data-pfreq="${f.key}" ${fc.req ? 'checked' : ''}> obligatorio
                </label>
            </div>`;
        }).join('');
    }
    html += `</div>`;
    if (secId === 'sec-proveedores') html += `<div class="card" id="cats-manager"></div>`;
    if (secId === 'sec-usuarios') html += `<div class="card" id="roles-manager"></div>`;
    if (secId === 'sec-escandallos') html += `<div class="card" id="subcat-manager"></div>`;
    panel.innerHTML = html;
    panel.querySelectorAll('[data-pf]').forEach(chk => {
        chk.addEventListener('change', () => {
            const key = chk.dataset.pf;
            const c = getParamConfig(secId); c[key] = c[key] || {};
            c[key].on = chk.checked;
            if (!chk.checked) c[key].req = false;
            saveSetting('params_' + secId, JSON.stringify(c));
            const reqLbl = panel.querySelector(`[data-pfreq="${key}"]`).closest('.param-req');
            reqLbl.style.visibility = chk.checked ? '' : 'hidden';
            if (!chk.checked) panel.querySelector(`[data-pfreq="${key}"]`).checked = false;
            applyFieldParams(secId);
        });
    });
    panel.querySelectorAll('[data-pfreq]').forEach(chk => {
        chk.addEventListener('change', () => {
            const key = chk.dataset.pfreq;
            const c = getParamConfig(secId); c[key] = c[key] || { on: true };
            c[key].req = chk.checked;
            saveSetting('params_' + secId, JSON.stringify(c));
            applyFieldParams(secId);
        });
    });
    if (secId === 'sec-proveedores') renderCatsManager(document.getElementById('cats-manager'));
    if (secId === 'sec-usuarios') renderRolesManager(document.getElementById('roles-manager'));
    if (secId === 'sec-escandallos') renderSubcatManager(document.getElementById('subcat-manager'));
}

// ─── Gestor de CATEGORÍAS (PROVEEDORES → PARAMETRIZACIÓN) ─────────────────────
async function renderCatsManager(box) {
    if (!box) return;
    const res = await apiFetch('/categories'); const cats = await res.json();
    box.innerHTML = `
        <h3 style="display:flex;align-items:center;gap:8px;"><span class="material-symbols-outlined" style="color:var(--primary);">category</span> CATEGORÍAS DE GASTO</h3>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-top:-10px;">Creá, renombrá o eliminá las categorías que usa tu negocio. No se pueden eliminar categorías en uso.</p>
        <div style="display:flex;gap:10px;margin-bottom:16px;">
            <input type="text" id="new-cat-name" placeholder="NUEVA CATEGORÍA..." style="flex:1;">
            <button class="btn primary" id="add-cat-btn"><span class="material-symbols-outlined">add</span> AGREGAR</button>
        </div>
        <div id="cats-list">${cats.map(c => `
            <div class="cat-row" data-id="${c.id}">
                <input type="text" value="${c.name}" data-orig="${c.name}">
                <button class="btn secondary outline btn-icon cat-save" title="Guardar cambio de nombre"><span class="material-symbols-outlined">check</span></button>
                <button class="btn secondary outline btn-icon cat-del" title="Eliminar" style="color:var(--negative);"><span class="material-symbols-outlined">delete</span></button>
            </div>`).join('')}</div>
        <div id="cats-msg"></div>`;
    box.querySelector('#add-cat-btn').addEventListener('click', async () => {
        const inp = box.querySelector('#new-cat-name');
        const name = inp.value.trim(); if (!name) return;
        const r = await apiFetch('/categories', { method: 'POST', body: JSON.stringify({ name }) });
        const m = box.querySelector('#cats-msg');
        if (r.ok) { inp.value = ''; renderCatsManager(box); loadCategories(); }
        else { const d = await r.json(); m.textContent = d.detail || 'Error'; m.className = 'error-msg'; setTimeout(() => m.textContent = '', 4000); }
    });
    box.querySelectorAll('.cat-row').forEach(row => {
        row.querySelector('.cat-save').addEventListener('click', async () => {
            const inp = row.querySelector('input');
            if (inp.value.trim() === inp.dataset.orig) return;
            const r = await apiFetch(`/categories/${row.dataset.id}`, { method: 'PUT', body: JSON.stringify({ name: inp.value.trim() }) });
            if (r.ok) { renderCatsManager(box); loadCategories(); }
            else { const d = await r.json(); alert(d.detail || 'Error'); }
        });
        row.querySelector('.cat-del').addEventListener('click', async () => {
            if (!confirm('¿Eliminar esta categoría?')) return;
            const r = await apiFetch(`/categories/${row.dataset.id}`, { method: 'DELETE' });
            if (r.ok) { renderCatsManager(box); loadCategories(); }
            else { const d = await r.json(); const m = box.querySelector('#cats-msg'); m.textContent = d.detail || 'Error'; m.className = 'error-msg'; setTimeout(() => m.textContent = '', 4000); }
        });
    });
}

// ─── Gestor de ROLES (USUARIOS → PARAMETRIZACIÓN) ─────────────────────────────
function renderRolesManager(box) {
    if (!box) return;
    const roles = getRoles();
    box.innerHTML = `
        <h3 style="display:flex;align-items:center;gap:8px;"><span class="material-symbols-outlined" style="color:var(--primary);">badge</span> ROLES PERSONALIZADOS</h3>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-top:-10px;">Creá roles con habilitaciones específicas (ej: VENDEDOR solo con VENTAS). Al crear un usuario podés asignarle uno de estos roles.</p>
        <div style="display:flex;gap:10px;margin-bottom:16px;">
            <input type="text" id="new-role-name" placeholder="NOMBRE DEL ROL (ej: VENDEDOR)..." style="flex:1;">
            <button class="btn primary" id="add-role-btn"><span class="material-symbols-outlined">add</span> CREAR ROL</button>
        </div>
        <div id="role-editor" style="display:none;"></div>
        <div id="roles-list">${roles.map((r, i) => `
            <div class="cat-row">
                <strong style="flex:1;">${r.name}</strong>
                <span style="color:var(--text-muted);font-size:0.8rem;">${Object.keys(r.perms || {}).filter(s => r.perms[s].on).length} planillas</span>
                <button class="btn secondary outline btn-icon role-edit" data-i="${i}" title="Editar"><span class="material-symbols-outlined">edit</span></button>
                <button class="btn secondary outline btn-icon role-del" data-i="${i}" title="Eliminar" style="color:var(--negative);"><span class="material-symbols-outlined">delete</span></button>
            </div>`).join('')}</div>`;
    box.querySelector('#add-role-btn').addEventListener('click', () => {
        const name = box.querySelector('#new-role-name').value.trim().toUpperCase();
        if (!name) return;
        openRoleEditor(box, { name, perms: {} }, -1);
    });
    box.querySelectorAll('.role-edit').forEach(b => b.addEventListener('click', () => {
        const i = parseInt(b.dataset.i); openRoleEditor(box, JSON.parse(JSON.stringify(getRoles()[i])), i);
    }));
    box.querySelectorAll('.role-del').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este rol?')) return;
        const roles2 = getRoles(); roles2.splice(parseInt(b.dataset.i), 1);
        await saveSetting('roles', JSON.stringify(roles2));
        renderRolesManager(box); populateRoleSelect();
    }));
}

function openRoleEditor(box, role, index) {
    const ed = box.querySelector('#role-editor');
    ed.style.display = 'block';
    ed.innerHTML = `
        <div style="border:1px solid var(--primary);border-radius:12px;padding:16px;margin-bottom:16px;">
            <h4 style="margin:0 0 12px;">HABILITACIONES — ${role.name}</h4>
            <div id="perm-tree"></div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;">
                <button class="btn secondary outline" id="role-cancel">CANCELAR</button>
                <button class="btn primary" id="role-save">GUARDAR ROL</button>
            </div>
        </div>`;
    const tree = ed.querySelector('#perm-tree');
    tree.innerHTML = PERM_TREE.map(pl => {
        const p = role.perms[pl.sec] || {};
        return `<div class="perm-planilla" data-sec="${pl.sec}">
            <label class="param-check perm-lvl1">
                <input type="checkbox" class="perm-sec" ${p.on ? 'checked' : ''}>
                <div><strong><span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;">${pl.icon}</span> ${pl.label}</strong></div>
            </label>
            <div class="perm-funcs" style="display:${p.on ? 'block' : 'none'};">
                ${pl.funcs.map(fn => {
                    const fp = (p.funcs || {})[fn.k] || {};
                    return `<div data-func="${fn.k}">
                        <label class="param-check perm-lvl2">
                            <input type="checkbox" class="perm-func" ${fp.on ? 'checked' : ''}>
                            <div>${fn.label}</div>
                        </label>
                        ${fn.subs ? `<div class="perm-subs" style="display:${fp.on ? 'flex' : 'none'};">
                            ${fn.subs.map(sb => `<label class="param-check perm-lvl3"><input type="checkbox" class="perm-sub" data-sub="${sb}" ${(fp.subs || {})[sb] ? 'checked' : ''}> ${sb}</label>`).join('')}
                        </div>` : ''}
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    }).join('');
    tree.querySelectorAll('.perm-sec').forEach(chk => chk.addEventListener('change', () => {
        chk.closest('.perm-planilla').querySelector('.perm-funcs').style.display = chk.checked ? 'block' : 'none';
    }));
    tree.querySelectorAll('.perm-func').forEach(chk => chk.addEventListener('change', () => {
        const subs = chk.closest('[data-func]').querySelector('.perm-subs');
        if (subs) subs.style.display = chk.checked ? 'flex' : 'none';
    }));
    ed.querySelector('#role-cancel').addEventListener('click', () => { ed.style.display = 'none'; });
    ed.querySelector('#role-save').addEventListener('click', async () => {
        const perms = {};
        tree.querySelectorAll('.perm-planilla').forEach(pl => {
            const on = pl.querySelector('.perm-sec').checked;
            if (!on) return;
            const funcs = {};
            pl.querySelectorAll('[data-func]').forEach(fd => {
                const fOn = fd.querySelector('.perm-func').checked;
                if (!fOn) return;
                const subs = {};
                fd.querySelectorAll('.perm-sub').forEach(sb => { if (sb.checked) subs[sb.dataset.sub] = true; });
                funcs[fd.dataset.func] = { on: true, subs };
            });
            perms[pl.dataset.sec] = { on: true, funcs };
        });
        const roles = getRoles();
        const newRole = { name: role.name, perms };
        if (index >= 0) roles[index] = newRole; else roles.push(newRole);
        await saveSetting('roles', JSON.stringify(roles));
        ed.style.display = 'none';
        renderRolesManager(box); populateRoleSelect();
    });
}

function populateRoleSelect() {
    const sel = document.getElementById('new-user-role');
    if (!sel) return;
    const roles = getRoles();
    sel.innerHTML = `<option value="Operator">Operator</option><option value="Admin">Admin</option>` +
        roles.map(r => `<option value="${r.name}">${r.name}</option>`).join('');
}

// ─── MIGRAR DATOS (exportar / importar) ───────────────────────────────────────
function tableToCSV(tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return '';
    const table = tbody.closest('table');
    const rows = [];
    const headCells = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    rows.push(headCells.join(';'));
    tbody.querySelectorAll('tr').forEach(tr => {
        if (tr.classList.contains('ingredient-row') || tr.classList.contains('skeleton-row')) return;
        if (tr.style.display === 'none') return;
        const cells = [...tr.querySelectorAll('td')].map(td => '"' + td.textContent.trim().replace(/"/g, '""') + '"');
        if (cells.length > 1) rows.push(cells.join(';'));
    });
    return rows.join('\r\n');
}
function downloadCSV(filename, content) {
    const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}
const EXPORT_TABLES = {
    'sec-ventas': ['sales-history-tbody', 'ventas'],
    'sec-gastos': ['expenses-history-tbody', 'gastos'],
    'sec-ingresos': ['prodrun-tbody', 'ingresos'],
    'sec-clientes': ['clients-tbody', 'clientes'],
    'sec-proveedores': ['providers-tbody', 'proveedores'],
    'sec-escandallos': ['escandallo-tbody', 'articulos'],
    'sec-almacen': ['warehouse-tbody', 'almacen'],
    'sec-usuarios': ['users-tbody', 'usuarios'],
};
const IMPORT_TEMPLATES = {
    'sec-clientes': { name: 'clientes', headers: ['NOMBRE', 'TELEFONO'], example: ['MARIA LOPEZ', '+54 11 1234-5678'] },
    'sec-proveedores': { name: 'proveedores', headers: ['NOMBRE', 'CATEGORIA', 'COMPRA_VENTA(SI/NO)'], example: ['DISTRIBUIDORA NORTE', 'INSUMOS', 'NO'] },
    'sec-escandallos': { name: 'articulos', headers: ['NOMBRE', 'TIPO(SIMPLE/COMPUESTO)', 'PRECIO_VENTA', 'RENDIMIENTO', 'STOCK_MINIMO'], example: ['MERMELADA DE HIGO', 'COMPUESTO', '3500', '12', '5'] },
};

function renderMigrarPanel(secId, panel) {
    const exp = EXPORT_TABLES[secId];
    const tpl = IMPORT_TEMPLATES[secId];
    let html = `<div class="card">
        <h3 style="display:flex;align-items:center;gap:8px;"><span class="material-symbols-outlined" style="color:var(--primary);">download</span> EXPORTAR</h3>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-top:-10px;">Descargá los datos de esta planilla en un archivo compatible con Excel y Google Sheets.</p>
        <button class="btn primary" id="export-btn"><span class="material-symbols-outlined">table_view</span> DESCARGAR PLANILLA</button>
    </div>`;
    if (tpl) {
        html += `<div class="card">
            <h3 style="display:flex;align-items:center;gap:8px;"><span class="material-symbols-outlined" style="color:var(--primary);">upload</span> IMPORTAR</h3>
            <p style="color:var(--text-muted);font-size:0.85rem;margin-top:-10px;">Cargá datos en masa desde un archivo CSV (lo podés guardar desde Excel o Sheets con "Guardar como → CSV"). Primero descargá la planilla modelo para ver el formato exacto.</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <button class="btn secondary outline" id="template-btn"><span class="material-symbols-outlined">description</span> DESCARGAR PLANILLA MODELO</button>
                <label class="btn primary" style="cursor:pointer;"><span class="material-symbols-outlined">upload_file</span> SELECCIONAR ARCHIVO E IMPORTAR<input type="file" id="import-file" accept=".csv,text/csv" style="display:none;"></label>
            </div>
            <div id="import-msg" style="margin-top:12px;"></div>
        </div>`;
    } else {
        html += `<div class="card"><p style="color:var(--text-muted);font-size:0.85rem;margin:0;">Esta planilla solo permite exportar. La importación está disponible en CLIENTES, PROVEEDORES y ARTÍCULOS.</p></div>`;
    }
    panel.innerHTML = html;
    panel.querySelector('#export-btn').addEventListener('click', () => {
        const csv = tableToCSV(exp[0]);
        downloadCSV(`wise_${exp[1]}_${new Date().toISOString().slice(0, 10)}.csv`, csv);
    });
    if (tpl) {
        panel.querySelector('#template-btn').addEventListener('click', () => {
            downloadCSV(`wise_modelo_${tpl.name}.csv`, tpl.headers.join(';') + '\r\n' + tpl.example.join(';'));
        });
        panel.querySelector('#import-file').addEventListener('change', async (e) => {
            const file = e.target.files[0]; if (!file) return;
            const text = await file.text();
            const msg = panel.querySelector('#import-msg');
            msg.textContent = 'Importando...'; msg.className = '';
            const result = await importCSV(secId, text);
            msg.textContent = `Importación terminada: ${result.ok} registros cargados${result.fail ? `, ${result.fail} con error (${result.errors.slice(0, 3).join(' / ')})` : ''}.`;
            msg.className = result.fail ? 'error-msg' : 'success-msg';
            e.target.value = '';
            if (secId === 'sec-clientes') loadClients();
            if (secId === 'sec-proveedores') loadProviders();
            if (secId === 'sec-escandallos') loadEscandalloTable();
        });
    }
}

async function importCSV(secId, text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { ok: 0, fail: 1, errors: ['El archivo no tiene filas de datos'] };
    const delim = lines[0].includes(';') ? ';' : ',';
    const parseRow = l => l.split(delim).map(c => c.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
    let ok = 0, fail = 0; const errors = [];
    for (const line of lines.slice(1)) {
        const cells = parseRow(line);
        if (!cells[0]) continue;
        try {
            let res;
            if (secId === 'sec-clientes') {
                res = await apiFetch('/clients', { method: 'POST', body: JSON.stringify({ name: cells[0].toUpperCase(), phone: cells[1] || '' }) });
            } else if (secId === 'sec-proveedores') {
                res = await apiFetch('/providers', { method: 'POST', body: JSON.stringify({ name: cells[0].toUpperCase(), category_name: (cells[1] || 'INSUMOS').toUpperCase(), is_resale: /^s/i.test(cells[2] || '') }) });
            } else if (secId === 'sec-escandallos') {
                const tipo = /simple/i.test(cells[1] || '') ? 'SIMPLE' : 'FORMULA';
                res = await apiFetch('/products', { method: 'POST', body: JSON.stringify({ flavor_name: cells[0].toUpperCase(), article_type: tipo, sale_price: parseFloat(cells[2]) || 0, yield_per_batch: parseFloat(cells[3]) || 1, min_stock: parseInt(cells[4]) || 0 }) });
            }
            if (res && res.ok) ok++;
            else { fail++; try { const d = await res.json(); errors.push(`${cells[0]}: ${d.detail || 'error'}`); } catch (_) { errors.push(cells[0]); } }
        } catch (err) { fail++; errors.push(cells[0]); }
    }
    return { ok, fail, errors };
}

// ─── Toggle de modo de contraseña en CREAR USUARIO ────────────────────────────
(function () {
    const sel = document.getElementById('new-user-pass-mode');
    if (sel) sel.addEventListener('change', () => {
        document.getElementById('new-user-pass-group').style.display = sel.value === 'manual' ? '' : 'none';
    });
})();

// ═════════════════════════════════════════════════════════════════════════════
// SUBCATEGORIZACIÓN DE ARTÍCULOS (solo ARTÍCULOS SIMPLES)
// ═════════════════════════════════════════════════════════════════════════════

function subcatEnabled() { return tenantSettings['subcat_enabled'] === '1'; }
function getBaseVars() {
    try { return JSON.parse(tenantSettings['base_variables'] || '[]'); } catch (e) { return []; }
}
async function saveBaseVars(list) { await saveSetting('base_variables', JSON.stringify(list)); }

// ─── Gestor en ARTÍCULOS → PARAMETRIZACIÓN ────────────────────────────────────
function renderSubcatManager(box) {
    if (!box) return;
    const on = subcatEnabled();
    const vars = getBaseVars();
    box.innerHTML = `
        <h3 style="display:flex;align-items:center;gap:8px;"><span class="material-symbols-outlined" style="color:var(--primary);">account_tree</span> SUBCATEGORIZACIÓN DE ARTÍCULOS</h3>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-top:-10px;">Permite englobar varios productos de una misma naturaleza usando VARIABLES (ej: REMERA NIKE con variable COLOR: rojo, blanco, negro). Solo aplica a ARTÍCULOS SIMPLES.</p>
        <div class="param-row">
            <label class="param-check">
                <input type="checkbox" id="subcat-enable-chk" ${on ? 'checked' : ''}>
                <div><strong>ACTIVAR SUBCATEGORIZACIÓN</strong><p>Al crear un artículo SIMPLE vas a poder marcarlo como SUBCATEGORIZADO y definir hasta 2 variables.</p></div>
            </label>
        </div>
        <div id="subcat-basevars" style="display:${on ? 'block' : 'none'};margin-top:14px;">
            <h4 style="margin:0 0 6px;">VARIABLES BASE</h4>
            <p style="color:var(--text-muted);font-size:0.82rem;margin:0 0 12px;">Variables guardadas que vas a poder reutilizar al crear artículos subcategorizados.</p>
            <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
                <input type="text" id="new-bv-name" placeholder="NOMBRE (ej: TALLE)..." style="flex:1;min-width:140px;">
                <input type="text" id="new-bv-values" placeholder="VALORES separados por coma (ej: S, M, L, XL)..." style="flex:2;min-width:200px;">
                <button class="btn primary" id="add-bv-btn"><span class="material-symbols-outlined">add</span> AGREGAR</button>
            </div>
            <div id="bv-list">${vars.map((v, i) => `
                <div class="cat-row" data-i="${i}">
                    <strong style="min-width:110px;">${v.name}</strong>
                    <input type="text" value="${(v.values || []).join(', ')}" class="bv-values-inp" style="flex:1;">
                    <button class="btn secondary outline btn-icon bv-save" title="Guardar"><span class="material-symbols-outlined">check</span></button>
                    <button class="btn secondary outline btn-icon bv-del" title="Eliminar" style="color:var(--negative);"><span class="material-symbols-outlined">delete</span></button>
                </div>`).join('') || '<p style="color:var(--text-muted);font-size:0.82rem;">Todavía no hay variables base guardadas.</p>'}</div>
        </div>`;
    box.querySelector('#subcat-enable-chk').addEventListener('change', async (e) => {
        await saveSetting('subcat_enabled', e.target.checked ? '1' : '0');
        box.querySelector('#subcat-basevars').style.display = e.target.checked ? 'block' : 'none';
        updateSubcatVisibility();
    });
    const addBtn = box.querySelector('#add-bv-btn');
    if (addBtn) addBtn.addEventListener('click', async () => {
        const name = box.querySelector('#new-bv-name').value.trim().toUpperCase();
        const values = box.querySelector('#new-bv-values').value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        if (!name || !values.length) return;
        const vars2 = getBaseVars().filter(v => v.name !== name);
        vars2.push({ name, values });
        await saveBaseVars(vars2);
        renderSubcatManager(box); renderSubcatForm();
    });
    box.querySelectorAll('#bv-list .cat-row').forEach(row => {
        const i = parseInt(row.dataset.i);
        row.querySelector('.bv-save').addEventListener('click', async () => {
            const vars2 = getBaseVars();
            vars2[i].values = row.querySelector('.bv-values-inp').value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
            await saveBaseVars(vars2);
            renderSubcatManager(box); renderSubcatForm();
        });
        row.querySelector('.bv-del').addEventListener('click', async () => {
            if (!confirm('¿Eliminar esta variable base?')) return;
            const vars2 = getBaseVars(); vars2.splice(i, 1);
            await saveBaseVars(vars2);
            renderSubcatManager(box); renderSubcatForm();
        });
    });
}

// ─── UI dentro del formulario de NUEVO ARTÍCULO ───────────────────────────────
function updateSubcatVisibility() {
    const block = document.getElementById('esc-subcat-block');
    if (!block) return;
    const isSimple = document.getElementById('esc-type-simple').checked;
    const show = isSimple && subcatEnabled() && !editingProductId;
    block.style.display = show ? '' : 'none';
    if (show && !block.dataset.rendered) renderSubcatForm();
    if (!show) {
        const chk = document.getElementById('esc-subcat-on');
        if (chk) { chk.checked = false; const cfg = document.getElementById('esc-subcat-config'); if (cfg) cfg.style.display = 'none'; }
    }
}

function _subcatSlotHtml(i, removable) {
    const baseOpts = getBaseVars().map(v => `<option value="${v.name}">${v.name}</option>`).join('');
    return `<div class="form-row subcat-slot" data-i="${i}" style="align-items:flex-end;">
        <div class="input-group"><label>VARIABLE ${i + 1}</label><select class="subcat-var-sel">
            <option value="">SELECCIONAR...</option>${baseOpts}<option value="__new__">➕ NUEVA VARIABLE (manual)</option>
        </select></div>
        <div class="input-group subcat-name-group" style="display:none;"><label>NOMBRE DE LA VARIABLE</label><input type="text" class="subcat-var-name" placeholder="Ej: COLOR"></div>
        <div class="input-group" style="flex:2;"><label>VALORES (separados por coma)</label><input type="text" class="subcat-var-values" placeholder="Ej: ROJO, BLANCO, NEGRO"></div>
        ${removable ? `<button type="button" class="btn secondary outline btn-icon subcat-slot-del" style="margin-bottom:2px;" title="Quitar variable"><span class="material-symbols-outlined">close</span></button>` : ''}
    </div>`;
}

function renderSubcatForm() {
    const block = document.getElementById('esc-subcat-block');
    if (!block) return;
    block.dataset.rendered = '1';
    block.innerHTML = `
        <div style="border:1px dashed var(--primary);border-radius:10px;padding:14px 16px;margin-bottom:16px;">
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.85rem;color:var(--text-muted);">
                <input type="checkbox" id="esc-subcat-on" style="width:16px;height:16px;accent-color:var(--primary);cursor:pointer;">
                <span><strong style="color:var(--text-main);">ARTÍCULO SUBCATEGORIZADO</strong> — generá varias versiones de este artículo combinando hasta 2 variables (ej: color y talle)</span>
            </label>
            <div id="esc-subcat-config" style="display:none;margin-top:14px;">
                <div id="subcat-slots">${_subcatSlotHtml(0, false)}</div>
                <button type="button" class="btn secondary outline" id="subcat-add-var" style="width:auto;"><span class="material-symbols-outlined">add</span> AGREGAR SEGUNDA VARIABLE</button>
                <div id="subcat-matrix" style="margin-top:14px;"></div>
                <div id="subcat-preview" style="margin-top:10px;font-size:0.82rem;color:var(--text-muted);"></div>
            </div>
        </div>`;
    const chk = block.querySelector('#esc-subcat-on');
    chk.addEventListener('change', () => {
        block.querySelector('#esc-subcat-config').style.display = chk.checked ? 'block' : 'none';
        refreshSubcatCombos();
    });
    block.querySelector('#subcat-add-var').addEventListener('click', () => {
        const slots = block.querySelectorAll('.subcat-slot');
        if (slots.length >= 2) return;
        block.querySelector('#subcat-slots').insertAdjacentHTML('beforeend', _subcatSlotHtml(1, true));
        block.querySelector('#subcat-add-var').style.display = 'none';
        refreshSubcatCombos();
    });
    // Listeners delegados: se adjuntan una sola vez aunque el bloque se re-renderice
    if (!block.dataset.delegated) {
        block.dataset.delegated = '1';
        block.addEventListener('click', e => {
            const del = e.target.closest('.subcat-slot-del');
            if (del) {
                const slot = del.closest('.subcat-slot');
                if (slot && slot.parentNode) slot.remove();
                const addBtn = block.querySelector('#subcat-add-var');
                if (addBtn) addBtn.style.display = '';
                refreshSubcatCombos();
            }
        });
        block.addEventListener('change', e => {
            if (e.target.classList.contains('subcat-var-sel')) {
                const slot = e.target.closest('.subcat-slot');
                const isNew = e.target.value === '__new__';
                slot.querySelector('.subcat-name-group').style.display = isNew ? '' : 'none';
                const valInp = slot.querySelector('.subcat-var-values');
                if (isNew) { valInp.value = ''; }
                else {
                    const bv = getBaseVars().find(v => v.name === e.target.value);
                    valInp.value = bv ? bv.values.join(', ') : '';
                }
                refreshSubcatCombos();
            }
        });
        block.addEventListener('input', e => {
            if (e.target.classList.contains('subcat-var-values') || e.target.classList.contains('subcat-var-name')) refreshSubcatCombos();
        });
    }
}

// El nombre del artículo forma parte de la previsualización de variantes
(function () {
    const inp = document.getElementById('esc-sabor');
    if (inp) inp.addEventListener('input', () => { if (subcatFormActive()) updateSubcatPreview(); });
})();

function subcatFormActive() {
    const chk = document.getElementById('esc-subcat-on');
    return !!(chk && chk.checked && subcatEnabled());
}

function getSubcatSlotData() {
    const slots = [...document.querySelectorAll('#esc-subcat-block .subcat-slot')];
    return slots.map(slot => {
        const sel = slot.querySelector('.subcat-var-sel').value;
        const name = sel === '__new__' ? slot.querySelector('.subcat-var-name').value.trim().toUpperCase() : sel;
        const values = slot.querySelector('.subcat-var-values').value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        return { isNew: sel === '__new__', name, values };
    }).filter(s => s.name && s.values.length);
}

function refreshSubcatCombos() {
    const matrixBox = document.getElementById('subcat-matrix');
    const preview = document.getElementById('subcat-preview');
    if (!matrixBox || !preview) return;
    const slots = getSubcatSlotData();
    if (slots.length === 2) {
        // Grilla de combinaciones: filas = variable 1, columnas = variable 2
        const [v1, v2] = slots;
        matrixBox.innerHTML = `
            <p style="font-size:0.82rem;color:var(--text-muted);margin:0 0 8px;">Marcá qué combinaciones existen de este producto:</p>
            <button type="button" class="btn secondary outline" id="subcat-check-all" style="width:auto;margin-bottom:10px;font-size:0.78rem;padding:6px 12px;"><span class="material-symbols-outlined" style="font-size:1rem;">done_all</span> TODAS LAS COMBINACIONES EXISTEN</button>
            <div class="table-container" style="overflow-x:auto;">
            <table class="data-table subcat-matrix-table"><thead><tr><th>${v1.name} \\ ${v2.name}</th>${v2.values.map(c => `<th style="text-align:center;">${c}</th>`).join('')}</tr></thead>
            <tbody>${v1.values.map(r => `<tr><td><strong>${r}</strong></td>${v2.values.map(c => `<td style="text-align:center;"><input type="checkbox" class="subcat-cell" data-r="${r}" data-c="${c}" style="width:16px;height:16px;accent-color:var(--primary);cursor:pointer;"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        matrixBox.querySelector('#subcat-check-all').addEventListener('click', () => {
            const cells = [...matrixBox.querySelectorAll('.subcat-cell')];
            const allOn = cells.every(c => c.checked);
            cells.forEach(c => c.checked = !allOn);
            updateSubcatPreview();
        });
        matrixBox.addEventListener('change', updateSubcatPreview);
    } else {
        matrixBox.innerHTML = '';
    }
    updateSubcatPreview();
}

function getSubcatCombos() {
    const slots = getSubcatSlotData();
    if (!slots.length) return [];
    if (slots.length === 1) return slots[0].values.slice();
    const checked = [...document.querySelectorAll('#subcat-matrix .subcat-cell:checked')];
    return checked.map(c => `${c.dataset.r} / ${c.dataset.c}`);
}

function updateSubcatPreview() {
    const preview = document.getElementById('subcat-preview');
    if (!preview) return;
    const name = (document.getElementById('esc-sabor').value || 'ARTÍCULO').trim().toUpperCase();
    const combos = getSubcatCombos();
    preview.innerHTML = combos.length
        ? `Se van a crear <strong style="color:var(--primary);">${combos.length}</strong> artículos: ${combos.slice(0, 6).map(c => `<span class="tag tag-blue" style="margin:2px;">${name} - ${c}</span>`).join('')}${combos.length > 6 ? ` <span class="tag">+${combos.length - 6} más</span>` : ''}`
        : 'Definí una variable con valores (y marcá combinaciones si usás dos variables).';
}

async function maybeSaveManualVariables() {
    const slots = getSubcatSlotData();
    let vars = getBaseVars();
    let changed = false;
    for (const s of slots) {
        if (!s.isNew) continue;
        if (vars.some(v => v.name === s.name)) continue;
        if (confirm(`¿Deseás que guardemos la variable "${s.name}" (${s.values.join(', ')}) para futuros artículos?`)) {
            vars.push({ name: s.name, values: s.values });
            changed = true;
        }
    }
    if (changed) await saveBaseVars(vars);
}

async function handleSubcatSubmit(sabor, price, minStock, submitBtn, originalHtml, form) {
    const m = document.getElementById('esc-msg');
    const combos = getSubcatCombos();
    if (!combos.length) {
        m.textContent = 'Definí al menos una variable con valores (y marcá combinaciones en la grilla si usás dos).';
        m.className = 'error-msg'; setTimeout(() => m.textContent = '', 5000);
        submitBtn.disabled = false; submitBtn.innerHTML = originalHtml;
        return;
    }
    try {
        await maybeSaveManualVariables();
        let ok = 0; const errs = [];
        for (const label of combos) {
            const res = await apiFetch('/products', { method: 'POST', body: JSON.stringify({
                flavor_name: `${sabor} - ${label}`, sale_price: price, yield_per_batch: 1,
                min_stock: minStock, article_type: 'SIMPLE', subcat_group: sabor
            }) });
            if (res.ok) ok++;
            else { try { const d = await res.json(); errs.push(`${label}: ${d.detail || 'error'}`); } catch (_) { errs.push(label); } }
        }
        if (ok > 0) {
            submitBtn.style.background = 'var(--positive)'; submitBtn.style.color = 'white';
            submitBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:1.1rem;vertical-align:middle;">check</span> ¡${ok} ARTÍCULOS CREADOS!`;
            m.textContent = `Se crearon ${ok} artículos del grupo "${sabor}"${errs.length ? ` (${errs.length} con error)` : ''}.`;
            m.className = errs.length ? 'error-msg' : 'success-msg';
            setTimeout(() => {
                submitBtn.disabled = false; submitBtn.style.background = ''; submitBtn.style.color = ''; submitBtn.innerHTML = originalHtml;
                form.reset(); escCont.innerHTML = ''; addEscRow(); setArticleType('FORMULA');
                const blk = document.getElementById('esc-subcat-block'); if (blk) { delete blk.dataset.rendered; blk.innerHTML = ''; }
                loadEscandalloTable();
                setTimeout(() => m.textContent = '', 5000);
            }, 1600);
        } else {
            m.textContent = `No se pudo crear ningún artículo. ${errs.slice(0, 2).join(' / ')}`;
            m.className = 'error-msg'; setTimeout(() => m.textContent = '', 6000);
            submitBtn.disabled = false; submitBtn.innerHTML = originalHtml;
        }
    } catch (err) {
        m.textContent = err.message || 'Error inesperado'; m.className = 'error-msg'; setTimeout(() => m.textContent = '', 5000);
        submitBtn.disabled = false; submitBtn.innerHTML = originalHtml;
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// GLOBO DE AYUDA / SOPORTE
// ═════════════════════════════════════════════════════════════════════════════

function toggleHelpPanel() {
    const p = document.getElementById('help-panel');
    if (p) p.classList.toggle('open');
}
document.addEventListener('click', e => {
    if (!e.target.closest('#help-bubble') && !e.target.closest('#help-panel')) {
        const p = document.getElementById('help-panel');
        if (p) p.classList.remove('open');
    }
});

// ═════════════════════════════════════════════════════════════════════════════
// TUTORIAL DE PRIMER INGRESO
// ═════════════════════════════════════════════════════════════════════════════

const TUTO_STEPS = [
    { icon: 'waving_hand', title: '¡BIENVENIDO A WISE!', text: 'Tu sistema de gestión de rentabilidad. En menos de un minuto te mostramos las planillas principales para que arranques con todo. Usá las flechas para avanzar o retroceder.' },
    { icon: 'donut_small', title: 'PERFORMANCE', text: 'El tablero de control: acá ves el CTR (capital total restante), la rentabilidad del mes (RNA), ingresos, gastos reales y el estado de tu stock. Es la foto financiera de tu negocio.' },
    { icon: 'point_of_sale', title: 'VENTAS', text: 'Registrá cada venta eligiendo cliente y productos. Solo vas a poder elegir artículos que tengan stock disponible, y el stock se descuenta automáticamente.' },
    { icon: 'receipt_long', title: 'GASTOS', text: 'Cargá todas tus compras y gastos por proveedor y categoría. Los gastos de INSUMOS alimentan el ALMACÉN y los costos de tus artículos.' },
    { icon: 'conveyor_belt', title: 'INGRESOS', text: 'Cuando producís, lo registrás acá: cada producción suma unidades al stock disponible para vender.' },
    { icon: 'contacts', title: 'CLIENTES Y PROVEEDORES', text: 'Tu directorio: clientes para asociar a las ventas, y proveedores para asociar a los gastos. A los proveedores de compra/venta les podés comprar artículos para revender.' },
    { icon: 'inventory_2', title: 'ARTÍCULOS', text: 'El corazón del sistema: creá artículos COMPUESTOS (los fabricás con insumos y receta) o SIMPLES (los comprás y revendés). Los simples pueden subcategorizarse con variables como color o talle.' },
    { icon: 'warehouse', title: 'ALMACÉN', text: 'El stock de tus insumos: cuánto compraste, cuánto consumiste según la producción y cuánto te queda.' },
    { icon: 'tune', title: 'TABS DE CADA PLANILLA', text: 'Arriba de cada planilla tenés 3 pestañas: FUNCIONES (el uso diario), PARAMETRIZACIÓN (activar campos y opciones) y MIGRAR DATOS (exportar e importar planillas).' },
    { icon: 'support_agent', title: '¿DUDAS? ESTAMOS ACÁ', text: 'En la esquina inferior derecha tenés el globo de ayuda: desde ahí podés contactar a soporte por WhatsApp o volver a ver este tutorial cuando quieras. ¡Éxitos!' },
];

let _tutoIdx = 0, _tutoTimer = null;
function startTutorial(force = false) {
    const ov = document.getElementById('tuto-overlay');
    if (!ov) return;
    _tutoIdx = 0;
    ov.style.display = 'flex';
    ov.innerHTML = `
        <div class="tuto-card">
            <div class="tuto-icon"><span class="material-symbols-outlined" id="tuto-icon-sym">waving_hand</span></div>
            <h3 id="tuto-title"></h3>
            <p id="tuto-text"></p>
            <div class="tuto-dots" id="tuto-dots"></div>
            <div class="tuto-controls">
                <button class="tuto-skip" id="tuto-skip">SALTEAR TUTORIAL</button>
                <div style="display:flex;gap:8px;">
                    <button class="btn secondary outline btn-icon" id="tuto-prev" title="Anterior"><span class="material-symbols-outlined">arrow_back</span></button>
                    <button class="btn primary btn-icon" id="tuto-next" title="Siguiente"><span class="material-symbols-outlined">arrow_forward</span></button>
                </div>
            </div>
        </div>`;
    ov.querySelector('#tuto-skip').addEventListener('click', closeTutorial);
    ov.querySelector('#tuto-prev').addEventListener('click', () => { if (_tutoIdx > 0) showTutoStep(_tutoIdx - 1); });
    ov.querySelector('#tuto-next').addEventListener('click', () => {
        if (_tutoIdx < TUTO_STEPS.length - 1) showTutoStep(_tutoIdx + 1);
        else closeTutorial();
    });
    showTutoStep(0);
}

function showTutoStep(i) {
    _tutoIdx = i;
    const step = TUTO_STEPS[i];
    const card = document.querySelector('#tuto-overlay .tuto-card');
    if (!card) return;
    // Reinicia la animación de entrada de la tarjeta
    card.classList.remove('tuto-pop'); void card.offsetWidth; card.classList.add('tuto-pop');
    document.getElementById('tuto-icon-sym').textContent = step.icon;
    document.getElementById('tuto-title').textContent = step.title;
    document.getElementById('tuto-dots').innerHTML = TUTO_STEPS.map((_, d) => `<span class="tuto-dot ${d === i ? 'on' : ''}"></span>`).join('');
    document.getElementById('tuto-prev').style.visibility = i === 0 ? 'hidden' : 'visible';
    const nextBtn = document.getElementById('tuto-next');
    nextBtn.innerHTML = i === TUTO_STEPS.length - 1
        ? '<span class="material-symbols-outlined">rocket_launch</span>'
        : '<span class="material-symbols-outlined">arrow_forward</span>';
    nextBtn.title = i === TUTO_STEPS.length - 1 ? '¡Empezar a usar WISE!' : 'Siguiente';
    // Efecto máquina de escribir
    const txtEl = document.getElementById('tuto-text');
    if (_tutoTimer) clearInterval(_tutoTimer);
    txtEl.textContent = ''; txtEl.classList.add('typing');
    let c = 0;
    _tutoTimer = setInterval(() => {
        c += 2;
        txtEl.textContent = step.text.slice(0, c);
        if (c >= step.text.length) { clearInterval(_tutoTimer); _tutoTimer = null; txtEl.classList.remove('typing'); }
    }, 14);
}

function closeTutorial() {
    if (_tutoTimer) { clearInterval(_tutoTimer); _tutoTimer = null; }
    const ov = document.getElementById('tuto-overlay');
    if (ov) {
        ov.classList.add('tuto-fade-out');
        setTimeout(() => { ov.style.display = 'none'; ov.classList.remove('tuto-fade-out'); ov.innerHTML = ''; }, 350);
    }
    if (currentUser && currentUser.username) localStorage.setItem('wise_tuto_seen_' + currentUser.username, '1');
}

