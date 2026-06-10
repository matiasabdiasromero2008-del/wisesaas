import psycopg2
import bcrypt
import os

DB_URL = os.environ.get("DATABASE_URL", "postgresql://neondb_owner:npg_3qmQAyfaS8oJ@ep-cool-waterfall-ajt00qej-pooler.c-3.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require")

def get_connection():
    return psycopg2.connect(DB_URL)

def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    # ─── Tenants (instancias de clientes) ───────────────────────────────────────
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS tenants (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
    )
    ''')

    # ─── Users ──────────────────────────────────────────────────────────────────
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT CHECK(role IN ('SuperAdmin', 'Admin', 'Operator')) NOT NULL,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        email TEXT,
        reset_token TEXT,
        reset_token_expiry TIMESTAMP,
        UNIQUE(username, tenant_id)
    )
    ''')

    # Migrar columna username: quitar el UNIQUE global si existía (era single-tenant)
    try:
        cursor.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;")
        conn.commit()
    except Exception:
        conn.rollback()

    # Agregar columnas faltantes si ya existía la tabla
    for col_def in [
        ("tenant_id", "INTEGER REFERENCES tenants(id) ON DELETE CASCADE"),
        ("email", "TEXT"),
        ("reset_token", "TEXT"),
        ("reset_token_expiry", "TIMESTAMP"),
    ]:
        try:
            cursor.execute(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col_def[0]} {col_def[1]};")
            conn.commit()
        except Exception:
            conn.rollback()

    # Actualizar el CHECK de rol para incluir SuperAdmin
    try:
        cursor.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;")
        cursor.execute("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('SuperAdmin', 'Admin', 'Operator'));")
        conn.commit()
    except Exception:
        conn.rollback()

    # ─── Categories ─────────────────────────────────────────────────────────────
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        UNIQUE(name, tenant_id)
    )
    ''')
    try:
        cursor.execute("ALTER TABLE categories ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;")
        conn.commit()
    except Exception:
        conn.rollback()

    # ─── Products ───────────────────────────────────────────────────────────────
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        flavor_name TEXT NOT NULL,
        sale_price REAL NOT NULL,
        yield_per_batch REAL DEFAULT 1,
        current_gpu REAL DEFAULT 0,
        min_stock INTEGER DEFAULT 0,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE
    )
    ''')
    for col in [
        ("tenant_id", "INTEGER REFERENCES tenants(id) ON DELETE CASCADE"),
        ("min_stock", "INTEGER DEFAULT 0"),
    ]:
        try:
            cursor.execute(f"ALTER TABLE products ADD COLUMN IF NOT EXISTS {col[0]} {col[1]};")
            conn.commit()
        except Exception:
            conn.rollback()

    # ─── Ingredients ────────────────────────────────────────────────────────────
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS ingredients (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        last_unit_cost REAL DEFAULT 0,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE
    )
    ''')
    try:
        cursor.execute("ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;")
        conn.commit()
    except Exception:
        conn.rollback()

    # ─── Product-Ingredient mapping ─────────────────────────────────────────────
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS product_ingredients (
        product_id INTEGER,
        ingredient_id INTEGER,
        quantity_per_batch REAL NOT NULL,
        PRIMARY KEY (product_id, ingredient_id),
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
    )
    ''')

    # ─── Providers ──────────────────────────────────────────────────────────────
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS providers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        category_id INTEGER,
        phone TEXT,
        location TEXT,
        delivery_time TEXT,
        observations TEXT,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id)
    )
    ''')
    try:
        cursor.execute("ALTER TABLE providers ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;")
        conn.commit()
    except Exception:
        conn.rollback()

    # ─── Clients ────────────────────────────────────────────────────────────────
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE
    )
    ''')
    try:
        cursor.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;")
        conn.commit()
    except Exception:
        conn.rollback()

    # ─── Expenses ───────────────────────────────────────────────────────────────
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        provider TEXT,
        category_id INTEGER,
        date TIMESTAMP,
        total_amount REAL,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id)
    )
    ''')
    try:
        cursor.execute("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;")
        conn.commit()
    except Exception:
        conn.rollback()

    # ─── Expense Items ───────────────────────────────────────────────────────────
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS expense_items (
        id SERIAL PRIMARY KEY,
        expense_id INTEGER,
        description TEXT,
        quantity REAL,
        unit_price REAL,
        total_price REAL,
        FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE
    )
    ''')

    # ─── Sales ──────────────────────────────────────────────────────────────────
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS sales (
        id SERIAL PRIMARY KEY,
        client_name TEXT,
        date TIMESTAMP,
        discount REAL DEFAULT 0,
        total_income REAL,
        total_gpu_snapshot REAL DEFAULT 0,
        user_id INTEGER,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
    ''')
    for col in [
        ("total_gpu_snapshot", "REAL DEFAULT 0"),
        ("tenant_id", "INTEGER REFERENCES tenants(id) ON DELETE CASCADE"),
    ]:
        try:
            cursor.execute(f"ALTER TABLE sales ADD COLUMN IF NOT EXISTS {col[0]} {col[1]};")
            conn.commit()
        except Exception:
            conn.rollback()

    # ─── Sale Items ─────────────────────────────────────────────────────────────
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS sale_items (
        id SERIAL PRIMARY KEY,
        sale_id INTEGER,
        product_id INTEGER,
        quantity INTEGER,
        gpu_snapshot REAL,
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
    )
    ''')

    # ─── Production Runs ─────────────────────────────────────────────────────────
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS production_runs (
        id SERIAL PRIMARY KEY,
        product_id INTEGER,
        quantity INTEGER,
        date TIMESTAMP,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
    )
    ''')
    try:
        cursor.execute("ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;")
        conn.commit()
    except Exception:
        conn.rollback()

    # ─── Stock ──────────────────────────────────────────────────────────────────
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS stock (
        id SERIAL PRIMARY KEY,
        product_id INTEGER,
        quantity_remaining INTEGER DEFAULT 0,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id),
        UNIQUE(product_id, tenant_id)
    )
    ''')
    try:
        cursor.execute("ALTER TABLE stock ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;")
        cursor.execute("ALTER TABLE stock ADD COLUMN IF NOT EXISTS id SERIAL;")
        conn.commit()
    except Exception:
        conn.rollback()

    conn.commit()

    # ─── Crear o Actualizar Super Admin por defecto ──────────────────────────────
    admin_pass = bcrypt.hashpw("MATIAS2008".encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    cursor.execute("SELECT id FROM users WHERE role = 'SuperAdmin' LIMIT 1")
    row = cursor.fetchone()
    if not row:
        cursor.execute(
            "INSERT INTO users (username, password_hash, role, tenant_id, email) VALUES (%s, %s, %s, NULL, %s)",
            ("superadmin", admin_pass, "SuperAdmin", "wissesaas@gmail.com")
        )
    else:
        cursor.execute(
            "UPDATE users SET password_hash = %s WHERE id = %s",
            (admin_pass, row[0])
        )
    conn.commit()

    conn.close()


def seed_tenant_categories(tenant_id, cursor):
    """Inserta las categorías por defecto para un nuevo tenant."""
    categories = [
        "SUELDOS", "INSUMOS", "UTENSILIOS", "PROGRAMAS",
        "SITIO WEB", "DISEÑADOR", "PACKAGING", "MARKETING"
    ]
    for cat in categories:
        cursor.execute(
            "INSERT INTO categories (name, tenant_id) VALUES (%s, %s) ON CONFLICT (name, tenant_id) DO NOTHING",
            (cat, tenant_id)
        )


if __name__ == "__main__":
    init_db()
    print("Base de datos inicializada correctamente.")
