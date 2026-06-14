from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import List, Optional
import bcrypt
import os
import sys
import secrets
import string
from datetime import datetime, timedelta
import logging

from jose import JWTError, jwt

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    from database import get_connection, init_db, seed_tenant_categories
    import logic
    from email_service import send_welcome_email, send_reset_email
except ImportError as e:
    logger.error(f"Error importando modulos locales: {e}")
    sys.path.append(os.path.dirname(__file__))
    from database import get_connection, init_db, seed_tenant_categories
    import logic
    from email_service import send_welcome_email, send_reset_email

# ─────────────────────────────────────────────────────────────────────────────
# Configuración JWT
# ─────────────────────────────────────────────────────────────────────────────
JWT_SECRET = os.environ.get("JWT_SECRET", "wise_super_secret_key_change_in_production_2025")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 12

security = HTTPBearer()

app = FastAPI(title="WISE ERP API – Multi-Tenant")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_event():
    # init_db corre en un hilo aparte para que el puerto se abra de inmediato.
    # Si una migración espera un lock (instancia vieja todavía viva durante el
    # deploy), el servidor igual arranca y Render no mata el deploy por timeout.
    import threading

    def _run_migrations():
        try:
            init_db()
            logger.info("Base de datos multi-tenant inicializada.")
        except Exception as e:
            logger.error(f"Error DB: {e}")

    threading.Thread(target=_run_migrations, daemon=True).start()


# Frontend
base_dir = os.path.dirname(__file__)
frontend_dir = None
if os.path.exists(os.path.join(base_dir, "frontend")):
    frontend_dir = os.path.join(base_dir, "frontend")
elif os.path.exists(os.path.join(base_dir, "Frontend")):
    frontend_dir = os.path.join(base_dir, "Frontend")
elif os.path.exists(os.path.join(base_dir, "index.html")):
    frontend_dir = base_dir

if frontend_dir:
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

@app.get("/")
def serve_index():
    if not frontend_dir:
        return {"error": "No se encontró index.html."}
    return FileResponse(os.path.join(frontend_dir, "index.html"))


# ─────────────────────────────────────────────────────────────────────────────
# Helpers JWT
# ─────────────────────────────────────────────────────────────────────────────

def create_token(user_id: int, username: str, role: str, tenant_id: Optional[int]) -> str:
    expire = datetime.utcnow() + timedelta(hours=JWT_EXPIRE_HOURS)
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "tenant_id": tenant_id,
        "exp": expire,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    return decode_token(credentials.credentials)


def require_superadmin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "SuperAdmin":
        raise HTTPException(status_code=403, detail="Acceso denegado: se requiere SuperAdmin")
    return user


def require_admin_or_superadmin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] not in ("Admin", "SuperAdmin"):
        raise HTTPException(status_code=403, detail="Acceso denegado: se requiere Admin")
    return user


def get_tenant_id(user: dict) -> int:
    """Obtiene el tenant_id del usuario. Lanza error si no tiene tenant (SuperAdmin sin contexto)."""
    tid = user.get("tenant_id")
    if tid is None:
        raise HTTPException(status_code=400, detail="SuperAdmin no tiene instancia asociada")
    return tid


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic Models
# ─────────────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str

class CreateTenantRequest(BaseModel):
    username: str
    password: str

class ChangeTenantPasswordRequest(BaseModel):
    new_password: str

class DeleteTenantRequest(BaseModel):
    superadmin_password: str

class CreateUserRequest(BaseModel):
    username: str
    email: Optional[str] = None
    role: str = "Operator"
    password: Optional[str] = None      # si viene, se usa en lugar de la autogenerada
    custom_role: Optional[str] = None   # rol definido en PARAMETRIZACIÓN de USUARIOS
    phone: Optional[str] = None

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

class ExpenseItemModel(BaseModel):
    description: str
    quantity: float
    unit_price: float

class ExpenseRequest(BaseModel):
    provider_id: Optional[int] = None
    provider: Optional[str] = None
    category_name: str
    items: List[ExpenseItemModel]
    date: Optional[str] = None

class ProviderModel(BaseModel):
    name: str
    category_name: str
    phone: Optional[str] = None
    location: Optional[str] = None
    delivery_time: Optional[str] = None
    observations: Optional[str] = None
    is_resale: Optional[bool] = False

class IngredientModel(BaseModel):
    name: str

class ProductModel(BaseModel):
    flavor_name: str
    sale_price: float
    yield_per_batch: float = 1
    min_stock: Optional[int] = 0
    article_type: Optional[str] = 'FORMULA'
    subcat_group: Optional[str] = None

class RecipeItem(BaseModel):
    ingredient_id: int
    quantity: float

class RecipeRequest(BaseModel):
    product_id: int
    yield_per_batch: float
    items: List[RecipeItem]

class ProductionModel(BaseModel):
    product_id: int
    quantity: int
    date: Optional[str] = None

class ClientModel(BaseModel):
    name: str
    phone: Optional[str] = None

class SaleItemModel(BaseModel):
    product_id: int
    quantity: int

class SaleRequest(BaseModel):
    client_name: str
    items: List[SaleItemModel]
    discount: float = 0
    date: Optional[str] = None

class SaleEditModel(BaseModel):
    client_name: str
    date: Optional[str] = None
    discount: Optional[float] = 0


# ─────────────────────────────────────────────────────────────────────────────
# Auth – Login / Forgot Password / Reset Password
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/login")
def login(req: LoginRequest):
    conn = get_connection()
    cursor = conn.cursor()
    # SuperAdmin no tiene tenant_id (NULL)
    cursor.execute(
        "SELECT id, password_hash, role, tenant_id, custom_role FROM users WHERE username = %s AND role = 'SuperAdmin'",
        (req.username,)
    )
    result = cursor.fetchone()

    if not result:
        # Buscar en todos los tenants (username único por tenant)
        cursor.execute(
            "SELECT id, password_hash, role, tenant_id, custom_role FROM users WHERE username = %s AND role != 'SuperAdmin'",
            (req.username,)
        )
        result = cursor.fetchone()

    conn.close()

    if result and bcrypt.checkpw(req.password.encode('utf-8'), result[1].encode('utf-8')):
        token = create_token(
            user_id=result[0],
            username=req.username,
            role=result[2],
            tenant_id=result[3],
        )
        return {"success": True, "token": token, "role": result[2], "username": req.username, "tenant_id": result[3], "custom_role": result[4]}
    else:
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos")


@app.post("/auth/forgot-password")
def forgot_password(req: ForgotPasswordRequest, request: Request):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username FROM users WHERE email = %s", (req.email,))
    user = cursor.fetchone()
    if not user:
        conn.close()
        # Por seguridad, siempre retornar éxito
        return {"success": True, "message": "Si el correo existe, recibirás un enlace de recuperación."}

    token = secrets.token_urlsafe(32)
    expiry = datetime.utcnow() + timedelta(hours=1)
    cursor.execute(
        "UPDATE users SET reset_token = %s, reset_token_expiry = %s WHERE id = %s",
        (token, expiry, user[0])
    )
    conn.commit()
    conn.close()

    base_url = str(request.base_url).rstrip("/")
    send_reset_email(req.email, user[1], token, base_url)
    return {"success": True, "message": "Si el correo existe, recibirás un enlace de recuperación."}


@app.post("/auth/reset-password")
def reset_password(req: ResetPasswordRequest):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id FROM users WHERE reset_token = %s AND reset_token_expiry > NOW()",
        (req.token,)
    )
    user = cursor.fetchone()
    if not user:
        conn.close()
        raise HTTPException(status_code=400, detail="Token inválido o expirado")

    new_hash = bcrypt.hashpw(req.new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    cursor.execute(
        "UPDATE users SET password_hash = %s, reset_token = NULL, reset_token_expiry = NULL WHERE id = %s",
        (new_hash, user[0])
    )
    conn.commit()
    conn.close()
    return {"success": True, "message": "Contraseña actualizada correctamente"}


# ─────────────────────────────────────────────────────────────────────────────
# SuperAdmin – Gestión de Tenants e Instancias
# ─────────────────────────────────────────────────────────────────────────────

def _generate_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    return ''.join(secrets.choice(alphabet) for _ in range(length))


@app.get("/superadmin/tenants")
def list_tenants(user: dict = Depends(require_superadmin)):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT t.id, t.name, t.slug, t.is_active, t.created_at,
               COUNT(u.id) as user_count
        FROM tenants t
        LEFT JOIN users u ON u.tenant_id = t.id
        GROUP BY t.id ORDER BY t.created_at DESC
    """)
    rows = cursor.fetchall()
    conn.close()
    return [{
        "id": r[0], "name": r[1], "slug": r[2],
        "is_active": r[3],
        "created_at": r[4].strftime("%Y-%m-%d %H:%M") if r[4] else "",
        "user_count": r[5]
    } for r in rows]


@app.post("/superadmin/tenants")
def create_tenant(req: CreateTenantRequest, user: dict = Depends(require_superadmin)):
    try:
        conn = get_connection()
        cursor = conn.cursor()

        slug = req.username.lower().replace(" ", "-")

        # Verificar slug único
        cursor.execute("SELECT id FROM tenants WHERE slug = %s", (slug,))
        if cursor.fetchone():
            conn.close()
            raise HTTPException(status_code=400, detail="El usuario ya está en uso")

        # Crear tenant usando el username como nombre de la instancia
        cursor.execute(
            "INSERT INTO tenants (name, slug) VALUES (%s, %s) RETURNING id",
            (req.username, slug)
        )
        tenant_id = cursor.fetchone()[0]

        # Sembrar categorías por defecto
        seed_tenant_categories(tenant_id, cursor)

        # Crear Admin de la instancia con la contraseña manual (sin correo)
        hashed = bcrypt.hashpw(req.password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        cursor.execute(
            "INSERT INTO users (username, password_hash, role, tenant_id) VALUES (%s, %s, %s, %s)",
            (req.username, hashed, "Admin", tenant_id)
        )

        conn.commit()
        conn.close()

        return {"success": True, "tenant_id": tenant_id, "message": f"Cuenta '{req.username}' creada."}
    except Exception as e:
        import traceback
        return JSONResponse(status_code=500, content={"detail": f"Error interno: {str(e)}\n{traceback.format_exc()}"})


@app.put("/superadmin/tenants/{tenant_id}")
def update_tenant(tenant_id: int, body: dict, user: dict = Depends(require_superadmin)):
    conn = get_connection()
    cursor = conn.cursor()
    is_active = body.get("is_active")
    if is_active is not None:
        cursor.execute("UPDATE tenants SET is_active = %s WHERE id = %s", (is_active, tenant_id))
    conn.commit()
    conn.close()
    return {"success": True}


@app.put("/superadmin/tenants/{tenant_id}/password")
def update_tenant_password(tenant_id: int, req: ChangeTenantPasswordRequest, user: dict = Depends(require_superadmin)):
    conn = get_connection()
    cursor = conn.cursor()
    hashed = bcrypt.hashpw(req.new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    # Cambiamos la contraseña del usuario Admin de esa instancia
    cursor.execute("UPDATE users SET password_hash = %s WHERE tenant_id = %s AND role = 'Admin'", (hashed, tenant_id))
    conn.commit()
    conn.close()
    return {"success": True, "message": "Contraseña cambiada exitosamente"}


@app.post("/superadmin/tenants/{tenant_id}/delete")
def delete_tenant(tenant_id: int, req: DeleteTenantRequest, user: dict = Depends(require_superadmin)):
    conn = get_connection()
    cursor = conn.cursor()

    # Verificar contraseña del SuperAdmin
    cursor.execute("SELECT password_hash FROM users WHERE id = %s", (user['id'],))
    sa_row = cursor.fetchone()
    if not sa_row or not bcrypt.checkpw(req.superadmin_password.encode('utf-8'), sa_row[0].encode('utf-8')):
        conn.close()
        raise HTTPException(status_code=401, detail="Contraseña de SuperAdmin incorrecta")

    # El CASCADE en FK elimina users, products, etc.
    cursor.execute("DELETE FROM tenants WHERE id = %s", (tenant_id,))
    conn.commit()
    conn.close()
    return {"success": True}


@app.get("/superadmin/users")
def list_all_users(user: dict = Depends(require_superadmin)):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT u.id, u.username, u.role, u.email, t.name as tenant_name
        FROM users u
        LEFT JOIN tenants t ON u.tenant_id = t.id
        ORDER BY t.name, u.username
    """)
    rows = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "username": r[1], "role": r[2], "email": r[3], "tenant": r[4] or "SuperAdmin"} for r in rows]


# ─────────────────────────────────────────────────────────────────────────────
# Gestión de Usuarios (Admin de instancia)
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/users")
def list_users(user: dict = Depends(require_admin_or_superadmin)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, username, role, email, custom_role, phone FROM users WHERE tenant_id = %s ORDER BY username",
        (tenant_id,)
    )
    rows = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "username": r[1], "role": r[2], "email": r[3], "custom_role": r[4], "phone": r[5]} for r in rows]


@app.post("/users")
def create_user(req: CreateUserRequest, user: dict = Depends(require_admin_or_superadmin)):
    tenant_id = get_tenant_id(user)
    if req.role not in ("Admin", "Operator"):
        raise HTTPException(status_code=400, detail="Rol inválido. Use 'Admin' u 'Operator'")

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT id FROM users WHERE username = %s AND tenant_id = %s",
        (req.username, tenant_id)
    )
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="El usuario ya existe en esta instancia")

    manual_password = bool(req.password and req.password.strip())
    if not manual_password and not req.email:
        conn.close()
        raise HTTPException(status_code=400, detail="Indicá un correo (para enviar la contraseña) o definí una contraseña manual")

    raw_password = req.password.strip() if manual_password else _generate_password()
    hashed = bcrypt.hashpw(raw_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    cursor.execute(
        "INSERT INTO users (username, password_hash, role, tenant_id, email, custom_role, phone) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (req.username, hashed, req.role, tenant_id, req.email, req.custom_role, req.phone)
    )
    conn.commit()
    conn.close()

    if manual_password:
        return {"success": True, "message": f"Usuario '{req.username}' creado con la contraseña definida."}

    # Enviar email con credenciales al nuevo usuario
    from email_service import send_welcome_email as _welcome
    _welcome(req.email, f"instancia #{tenant_id}", req.username, raw_password)

    return {"success": True, "message": f"Usuario '{req.username}' creado. Credenciales enviadas a {req.email}"}


@app.delete("/users/{user_id}")
def delete_user(user_id: int, user: dict = Depends(require_admin_or_superadmin)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    # Solo puede eliminar usuarios de su propio tenant
    cursor.execute(
        "DELETE FROM users WHERE id = %s AND tenant_id = %s",
        (user_id, tenant_id)
    )
    if cursor.rowcount == 0:
        conn.close()
        raise HTTPException(status_code=404, detail="Usuario no encontrado en esta instancia")
    conn.commit()
    conn.close()
    return {"success": True}


# ─────────────────────────────────────────────────────────────────────────────
# Métricas / Performance
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/metrics")
def get_metrics(month: str = None, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    if not month:
        month = datetime.now().strftime("%Y-%m")
    try:
        data = logic.get_performance_metrics(month, tenant_id)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# Gastos
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/expenses")
def get_expenses(user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT e.id, e.provider, c.name, e.date, e.total_amount, p.id
        FROM expenses e
        JOIN categories c ON e.category_id = c.id
        LEFT JOIN providers p ON e.provider = p.name AND p.tenant_id = %s
        WHERE e.tenant_id = %s
        ORDER BY e.date DESC, e.id DESC
        LIMIT 50
    """, (tenant_id, tenant_id))
    results = cursor.fetchall()
    conn.close()
    return [{
        "id": r[0], "provider": r[1], "provider_name": r[1],
        "provider_id": r[5] or 0, "category": r[2], "category_name": r[2],
        "date": r[3].strftime("%Y-%m-%d %H:%M") if r[3] else "",
        "amount": r[4], "total": r[4]
    } for r in results]


@app.get("/expenses/{expense_id}/items")
def get_expense_items(expense_id: int, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT description, quantity, unit_price, total_price FROM expense_items WHERE expense_id = %s",
        (expense_id,)
    )
    items = cursor.fetchall()
    conn.close()
    return [{"description": r[0], "quantity": r[1], "unit_price": r[2], "total_price": r[3]} for r in items]


@app.post("/expenses")
def create_expense(req: ExpenseRequest, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    date_str = req.date if req.date else datetime.now().strftime("%Y-%m-%d")
    items_dict = [{"description": i.description, "quantity": i.quantity, "unit_price": i.unit_price} for i in req.items]
    provider_name = req.provider or "Desconocido"
    if req.provider_id:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM providers WHERE id = %s AND tenant_id = %s", (req.provider_id, tenant_id))
        row = cursor.fetchone()
        conn.close()
        if row:
            provider_name = row[0]
    try:
        logic.add_expense(provider_name, req.category_name, items_dict, date_str, tenant_id)
        return {"success": True, "message": "Gasto registrado"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/expenses/{expense_id}")
def delete_expense(expense_id: int, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM expenses WHERE id = %s AND tenant_id = %s", (expense_id, tenant_id))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Gasto no encontrado")
    cursor.execute("DELETE FROM expense_items WHERE expense_id = %s", (expense_id,))
    cursor.execute("DELETE FROM expenses WHERE id = %s", (expense_id,))
    conn.commit()
    conn.close()
    return {"success": True}


@app.put("/expenses/{expense_id}")
def update_expense(expense_id: int, req: ExpenseRequest, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    date_str = req.date if req.date else datetime.now().strftime("%Y-%m-%d")
    items_dict = [{"description": i.description, "quantity": i.quantity, "unit_price": i.unit_price} for i in req.items]
    provider_name = req.provider or "Desconocido"
    if req.provider_id:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM providers WHERE id = %s AND tenant_id = %s", (req.provider_id, tenant_id))
        row = cursor.fetchone()
        conn.close()
        if row:
            provider_name = row[0]
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM categories WHERE name = %s AND tenant_id = %s", (req.category_name, tenant_id))
        cat_id = cursor.fetchone()[0]
        total_amount = sum(item['quantity'] * item['unit_price'] for item in items_dict)
        cursor.execute("""
            UPDATE expenses SET provider = %s, category_id = %s, date = %s, total_amount = %s
            WHERE id = %s AND tenant_id = %s
        """, (provider_name, cat_id, date_str, total_amount, expense_id, tenant_id))
        cursor.execute("DELETE FROM expense_items WHERE expense_id = %s", (expense_id,))
        for item in items_dict:
            cursor.execute('''
                INSERT INTO expense_items (expense_id, description, quantity, unit_price, total_price)
                VALUES (%s, %s, %s, %s, %s)
            ''', (expense_id, item['description'], item['quantity'], item['unit_price'], item['quantity'] * item['unit_price']))
            if req.category_name == "INSUMOS":
                cursor.execute('''
                    INSERT INTO ingredients (name, last_unit_cost, tenant_id)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (name, tenant_id) DO UPDATE SET last_unit_cost = EXCLUDED.last_unit_cost
                ''', (item['description'], item['unit_price'], tenant_id))
        conn.commit()
        conn.close()
        return {"success": True, "message": "Gasto actualizado"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# Proveedores
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/providers")
def get_providers(user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT p.id, p.name, c.name, p.phone, p.location, p.delivery_time, p.observations, p.is_resale
        FROM providers p
        JOIN categories c ON p.category_id = c.id
        WHERE p.tenant_id = %s
    """, (tenant_id,))
    results = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1], "category": r[2], "phone": r[3], "location": r[4], "delivery_time": r[5], "observations": r[6], "is_resale": bool(r[7])} for r in results]


@app.post("/providers")
def add_provider(req: ProviderModel, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM categories WHERE name = %s AND tenant_id = %s", (req.category_name, tenant_id))
        cat_id = cursor.fetchone()
        if not cat_id:
            raise HTTPException(status_code=400, detail="Categoría no encontrada")
        cursor.execute("""
            INSERT INTO providers (name, category_id, phone, location, delivery_time, observations, is_resale, tenant_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (req.name, cat_id[0], req.phone, req.location, req.delivery_time, req.observations, bool(req.is_resale), tenant_id))
        conn.commit()
        return {"success": True}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.put("/providers/{provider_id}")
def update_provider(provider_id: int, req: ProviderModel, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM categories WHERE name = %s AND tenant_id = %s", (req.category_name, tenant_id))
        cat_row = cursor.fetchone()
        if not cat_row:
            raise HTTPException(status_code=400, detail="Categoría no encontrada")
        cursor.execute("UPDATE providers SET name = %s, category_id = %s, phone = %s, location = %s, delivery_time = %s, observations = %s, is_resale = %s WHERE id = %s AND tenant_id = %s",
                       (req.name, cat_row[0], req.phone, req.location, req.delivery_time, req.observations, bool(req.is_resale), provider_id, tenant_id))
        conn.commit()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.delete("/providers/{provider_id}")
def delete_provider(provider_id: int, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM providers WHERE id = %s AND tenant_id = %s", (provider_id, tenant_id))
    conn.commit()
    conn.close()
    return {"success": True}


# ─────────────────────────────────────────────────────────────────────────────
# Almacén (stock de insumos comprados vía GASTOS)
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/warehouse")
def get_warehouse(user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, last_unit_cost FROM ingredients WHERE tenant_id = %s ORDER BY name", (tenant_id,))
    ings = cursor.fetchall()
    result = []
    for ing_id, name, cost in ings:
        # Comprado: suma de cantidades en gastos de categoría INSUMOS con esa descripción
        cursor.execute('''
            SELECT COALESCE(SUM(ei.quantity), 0)
            FROM expense_items ei
            JOIN expenses e ON ei.expense_id = e.id
            JOIN categories c ON e.category_id = c.id
            WHERE e.tenant_id = %s AND c.name = 'INSUMOS'
              AND UPPER(TRIM(ei.description)) = UPPER(TRIM(%s))
        ''', (tenant_id, name))
        purchased = cursor.fetchone()[0] or 0
        # Consumido estimado: producción registrada × cantidad por lote ÷ rendimiento
        cursor.execute('''
            SELECT COALESCE(SUM(pr.quantity * pi.quantity_per_batch / NULLIF(p.yield_per_batch, 0)), 0)
            FROM production_runs pr
            JOIN products p ON pr.product_id = p.id
            JOIN product_ingredients pi ON pi.product_id = p.id AND pi.ingredient_id = %s
            WHERE pr.tenant_id = %s
        ''', (ing_id, tenant_id))
        consumed = cursor.fetchone()[0] or 0
        result.append({
            "id": ing_id, "name": name, "last_cost": cost or 0,
            "purchased": round(purchased, 2), "consumed": round(consumed, 2),
            "stock": round(purchased - consumed, 2),
        })
    conn.close()
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Clientes
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/clients")
def get_clients(user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, phone FROM clients WHERE tenant_id = %s ORDER BY name", (tenant_id,))
    results = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1], "phone": r[2] or ""} for r in results]


@app.post("/clients")
def add_client(req: ClientModel, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO clients (name, phone, tenant_id) VALUES (%s, %s, %s)", (req.name.upper(), req.phone, tenant_id))
        conn.commit()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.put("/clients/{client_id}")
def update_client(client_id: int, req: ClientModel, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE clients SET name = %s, phone = %s WHERE id = %s AND tenant_id = %s", (req.name.upper(), req.phone, client_id, tenant_id))
        conn.commit()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.delete("/clients/{client_id}")
def delete_client(client_id: int, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM clients WHERE id = %s AND tenant_id = %s", (client_id, tenant_id))
        conn.commit()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Ingredientes
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/ingredients")
def get_ingredients(user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, last_unit_cost FROM ingredients WHERE tenant_id = %s ORDER BY name", (tenant_id,))
    results = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1], "cost": r[2]} for r in results]


@app.post("/ingredients")
def add_ingredient(req: IngredientModel, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO ingredients (name, tenant_id) VALUES (%s, %s)", (req.name, tenant_id))
        conn.commit()
        return {"success": True}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Productos y Recetas
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/products")
def get_products(user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, flavor_name, sale_price, current_gpu, yield_per_batch, min_stock, article_type, subcat_group FROM products WHERE tenant_id = %s", (tenant_id,))
    results = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1], "price": r[2], "gpu": r[3], "yield": r[4], "min_stock": r[5] or 0, "article_type": r[6] or 'FORMULA', "subcat_group": r[7]} for r in results]


@app.post("/products")
def add_product(req: ProductModel, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO products (flavor_name, sale_price, yield_per_batch, min_stock, article_type, subcat_group, tenant_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id
        """, (req.flavor_name, req.sale_price, req.yield_per_batch, req.min_stock or 0, req.article_type or 'FORMULA', req.subcat_group, tenant_id))
        new_id = cursor.fetchone()[0]
        conn.commit()
        return {"success": True, "id": new_id}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.delete("/products/{product_id}")
def delete_product(product_id: int, user: dict = Depends(get_current_user)):
    import psycopg2.errors
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM products WHERE id = %s AND tenant_id = %s", (product_id, tenant_id))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        cursor.execute("DELETE FROM product_ingredients WHERE product_id = %s", (product_id,))
        cursor.execute("DELETE FROM stock WHERE product_id = %s AND tenant_id = %s", (product_id, tenant_id))
        cursor.execute("DELETE FROM products WHERE id = %s AND tenant_id = %s", (product_id, tenant_id))
        conn.commit()
        return {"success": True}
    except psycopg2.errors.ForeignKeyViolation:
        conn.rollback()
        raise HTTPException(status_code=400, detail="No se puede eliminar: el producto tiene ventas registradas.")
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.put("/products/{product_id}")
def update_product(product_id: int, req: ProductModel, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            UPDATE products SET flavor_name = %s, sale_price = %s, yield_per_batch = %s, min_stock = %s, article_type = %s, subcat_group = %s
            WHERE id = %s AND tenant_id = %s
        """, (req.flavor_name, req.sale_price, req.yield_per_batch, req.min_stock or 0, req.article_type or 'FORMULA', req.subcat_group, product_id, tenant_id))
        conn.commit()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.get("/recipes/{product_id}")
def get_recipe(product_id: int, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    # Validar que el producto es de este tenant
    cursor.execute("SELECT id FROM products WHERE id = %s AND tenant_id = %s", (product_id, tenant_id))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    cursor.execute("""
        SELECT i.id, i.name, pi.quantity_per_batch, i.last_unit_cost
        FROM product_ingredients pi
        JOIN ingredients i ON pi.ingredient_id = i.id
        WHERE pi.product_id = %s
    """, (product_id,))
    items = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1], "quantity": r[2], "cost": r[3]} for r in items]


@app.post("/recipes")
def save_recipe(req: RecipeRequest, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM products WHERE id = %s AND tenant_id = %s", (req.product_id, tenant_id))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        cursor.execute("UPDATE products SET yield_per_batch = %s WHERE id = %s", (req.yield_per_batch, req.product_id))
        cursor.execute("DELETE FROM product_ingredients WHERE product_id = %s", (req.product_id,))
        for item in req.items:
            cursor.execute("""
                INSERT INTO product_ingredients (product_id, ingredient_id, quantity_per_batch)
                VALUES (%s, %s, %s)
            """, (req.product_id, item.ingredient_id, item.quantity))
        logic.recalculate_product_gpu(req.product_id, cursor)
        conn.commit()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Ventas
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/sales")
def create_sale(req: SaleRequest, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    date_str = req.date if req.date else datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_connection()
    cursor = conn.cursor()
    try:
        total_income = 0
        total_gpv = 0
        for item in req.items:
            cursor.execute("SELECT sale_price, current_gpu FROM products WHERE id = %s AND tenant_id = %s", (item.product_id, tenant_id))
            prod_row = cursor.fetchone()
            if prod_row:
                price, unit_gpu = prod_row
                total_income += price * item.quantity
                total_gpv += (unit_gpu or 0) * item.quantity

        if req.discount < 0:
            discount_amount = abs(req.discount)
        else:
            discount_amount = total_income * (req.discount / 100) if req.discount else 0
        total_income -= discount_amount

        cursor.execute("""
            INSERT INTO sales (client_name, date, discount, total_income, total_gpu_snapshot, tenant_id)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
        """, (req.client_name, date_str, req.discount or 0, total_income, total_gpv, tenant_id))
        sale_id = cursor.fetchone()[0]

        for item in req.items:
            cursor.execute("SELECT current_gpu FROM products WHERE id = %s AND tenant_id = %s", (item.product_id, tenant_id))
            gpu_row = cursor.fetchone()
            unit_gpu = gpu_row[0] if gpu_row else 0
            cursor.execute("""
                INSERT INTO sale_items (sale_id, product_id, quantity, gpu_snapshot)
                VALUES (%s, %s, %s, %s)
            """, (sale_id, item.product_id, item.quantity, unit_gpu))
            cursor.execute("""
                UPDATE stock SET quantity_remaining = quantity_remaining - %s
                WHERE product_id = %s AND tenant_id = %s
            """, (item.quantity, item.product_id, tenant_id))

        conn.commit()
        return {"success": True, "sale_id": sale_id}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.get("/sales")
def get_sales(user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT s.id, s.client_name, s.date, s.discount, s.total_income,
               (SELECT AVG(gpu_snapshot) FROM sale_items WHERE sale_id = s.id) as unit_gpu,
               COALESCE(s.total_gpu_snapshot, 0) as total_gpu_snapshot
        FROM sales s WHERE s.tenant_id = %s ORDER BY s.date DESC
    """, (tenant_id,))
    results = cursor.fetchall()
    conn.close()
    return [{
        "id": r[0], "client": r[1],
        "date": r[2].strftime("%Y-%m-%dT%H:%M") if r[2] else "",
        "discount": f"${abs(r[3]):.2f}" if r[3] < 0 else (f"{r[3]:g}%" if r[3] > 0 else "0%"),
        "total": r[4], "gpu": r[5] or 0, "gpu_total": r[6] or 0
    } for r in results]


@app.get("/sales/{sale_id}/items")
def get_sale_items(sale_id: int, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM sales WHERE id = %s AND tenant_id = %s", (sale_id, tenant_id))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Venta no encontrada")
    cursor.execute("""
        SELECT p.flavor_name, si.quantity, p.sale_price, si.gpu_snapshot,
               si.quantity * p.sale_price AS subtotal,
               si.quantity * si.gpu_snapshot AS costo_total
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        WHERE si.sale_id = %s
    """, (sale_id,))
    rows = cursor.fetchall()
    conn.close()
    return [{"product": r[0], "quantity": r[1], "unit_price": r[2], "gpu": r[3], "subtotal": r[4], "costo_total": r[5]} for r in rows]


@app.put("/sales/{sale_id}")
def update_sale(sale_id: int, req: SaleEditModel, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    date_str = req.date if req.date else datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM sales WHERE id = %s AND tenant_id = %s", (sale_id, tenant_id))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Venta no encontrada")
        cursor.execute("UPDATE sales SET client_name = %s, date = %s, discount = %s WHERE id = %s AND tenant_id = %s",
                       (req.client_name, date_str, req.discount or 0, sale_id, tenant_id))
        conn.commit()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.delete("/sales/{sale_id}")
def delete_sale(sale_id: int, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM sales WHERE id = %s AND tenant_id = %s", (sale_id, tenant_id))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Venta no encontrada")
        cursor.execute("SELECT product_id, quantity FROM sale_items WHERE sale_id = %s", (sale_id,))
        items = cursor.fetchall()
        for p_id, qty in items:
            cursor.execute("UPDATE stock SET quantity_remaining = quantity_remaining + %s WHERE product_id = %s AND tenant_id = %s", (qty, p_id, tenant_id))
        cursor.execute("DELETE FROM sale_items WHERE sale_id = %s", (sale_id,))
        cursor.execute("DELETE FROM sales WHERE id = %s AND tenant_id = %s", (sale_id, tenant_id))
        conn.commit()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Stock
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/stock")
def get_stock_all(user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT p.id, p.flavor_name, p.sale_price, COALESCE(s.quantity_remaining, 0), COALESCE(p.min_stock, 0)
        FROM products p
        LEFT JOIN stock s ON p.id = s.product_id AND s.tenant_id = %s
        WHERE p.tenant_id = %s
    """, (tenant_id, tenant_id))
    results = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1], "price": r[2], "stock": r[3], "min_stock": r[4]} for r in results]


# ─────────────────────────────────────────────────────────────────────────────
# Producción (Ingresos)
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/production")
def create_production(req: ProductionModel, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    date_str = req.date if req.date else datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM products WHERE id = %s AND tenant_id = %s", (req.product_id, tenant_id))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        cursor.execute("INSERT INTO production_runs (product_id, quantity, date, tenant_id) VALUES (%s, %s, %s, %s)", (req.product_id, req.quantity, date_str, tenant_id))
        cursor.execute("""
            INSERT INTO stock (product_id, quantity_remaining, tenant_id)
            VALUES (%s, %s, %s)
            ON CONFLICT (product_id, tenant_id) DO UPDATE SET quantity_remaining = stock.quantity_remaining + EXCLUDED.quantity_remaining
        """, (req.product_id, req.quantity, tenant_id))
        conn.commit()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.get("/production")
def get_production(user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT pr.id, p.id, p.flavor_name, pr.quantity, pr.date
        FROM production_runs pr
        JOIN products p ON pr.product_id = p.id
        WHERE pr.tenant_id = %s
        ORDER BY pr.date DESC
    """, (tenant_id,))
    results = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "product_id": r[1], "product_name": r[2], "quantity": r[3], "date": r[4].strftime("%Y-%m-%dT%H:%M")} for r in results]


@app.delete("/production/{prod_id}")
def delete_production(prod_id: int, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT product_id, quantity FROM production_runs WHERE id = %s AND tenant_id = %s", (prod_id, tenant_id))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Registro no encontrado")
        p_id, qty = row
        cursor.execute("UPDATE stock SET quantity_remaining = quantity_remaining - %s WHERE product_id = %s AND tenant_id = %s", (qty, p_id, tenant_id))
        cursor.execute("DELETE FROM production_runs WHERE id = %s AND tenant_id = %s", (prod_id, tenant_id))
        conn.commit()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.put("/production/{prod_id}")
def update_production(prod_id: int, req: ProductionModel, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    date_str = req.date if req.date else datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT product_id, quantity FROM production_runs WHERE id = %s AND tenant_id = %s", (prod_id, tenant_id))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Registro no encontrado")
        old_p_id, old_qty = row
        cursor.execute("UPDATE stock SET quantity_remaining = quantity_remaining - %s WHERE product_id = %s AND tenant_id = %s", (old_qty, old_p_id, tenant_id))
        cursor.execute("UPDATE production_runs SET product_id = %s, quantity = %s, date = %s WHERE id = %s AND tenant_id = %s", (req.product_id, req.quantity, date_str, prod_id, tenant_id))
        cursor.execute("""
            INSERT INTO stock (product_id, quantity_remaining, tenant_id)
            VALUES (%s, %s, %s)
            ON CONFLICT (product_id, tenant_id) DO UPDATE SET quantity_remaining = stock.quantity_remaining + EXCLUDED.quantity_remaining
        """, (req.product_id, req.quantity, tenant_id))
        conn.commit()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Categorías
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/categories")
def get_categories(user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name FROM categories WHERE tenant_id = %s ORDER BY name", (tenant_id,))
    results = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1]} for r in results]


class CategoryModel(BaseModel):
    name: str


@app.post("/categories")
def add_category(req: CategoryModel, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    name = (req.name or '').strip().upper()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM categories WHERE name = %s AND tenant_id = %s", (name, tenant_id))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="Esa categoría ya existe")
        cursor.execute("INSERT INTO categories (name, tenant_id) VALUES (%s, %s) RETURNING id", (name, tenant_id))
        new_id = cursor.fetchone()[0]
        conn.commit()
        return {"success": True, "id": new_id}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.put("/categories/{cat_id}")
def update_category(cat_id: int, req: CategoryModel, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    name = (req.name or '').strip().upper()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE categories SET name = %s WHERE id = %s AND tenant_id = %s", (name, cat_id, tenant_id))
        conn.commit()
        return {"success": True}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.delete("/categories/{cat_id}")
def delete_category(cat_id: int, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT COUNT(*) FROM providers WHERE category_id = %s AND tenant_id = %s", (cat_id, tenant_id))
        if cursor.fetchone()[0] > 0:
            raise HTTPException(status_code=400, detail="No se puede eliminar: hay proveedores usando esta categoría")
        cursor.execute("SELECT COUNT(*) FROM expenses WHERE category_id = %s AND tenant_id = %s", (cat_id, tenant_id))
        if cursor.fetchone()[0] > 0:
            raise HTTPException(status_code=400, detail="No se puede eliminar: hay gastos registrados con esta categoría")
        cursor.execute("DELETE FROM categories WHERE id = %s AND tenant_id = %s", (cat_id, tenant_id))
        conn.commit()
        return {"success": True}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Parametrización (settings por tenant)
# ─────────────────────────────────────────────────────────────────────────────

class SettingModel(BaseModel):
    key: str
    value: str


@app.get("/settings")
def get_settings(user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM tenant_settings WHERE tenant_id = %s", (tenant_id,))
    results = dict(cursor.fetchall())
    conn.close()
    return results


@app.put("/settings")
def put_setting(req: SettingModel, user: dict = Depends(get_current_user)):
    tenant_id = get_tenant_id(user)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT INTO tenant_settings (tenant_id, key, value) VALUES (%s, %s, %s)
            ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value
        ''', (tenant_id, req.key, req.value))
        conn.commit()
        return {"success": True}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()
