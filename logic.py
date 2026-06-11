from database import get_connection
from datetime import datetime


# ─────────────────────────────────────────────────────────────────────────────
# GPU (Gasto Por Unidad)
# ─────────────────────────────────────────────────────────────────────────────

def update_all_gpus(tenant_id: int):
    """Recalcula el GPU de todos los productos de un tenant."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM products WHERE tenant_id = %s", (tenant_id,))
    products = cursor.fetchall()
    for (p_id,) in products:
        recalculate_product_gpu(p_id, cursor)
    conn.commit()
    conn.close()


def recalculate_product_gpu(product_id: int, cursor):
    """Calcula COGS por unidad. Para FORMULA: suma ingredientes / rendimiento. Para SIMPLE: último precio de compra desde gastos."""
    cursor.execute("SELECT yield_per_batch, flavor_name, article_type, tenant_id FROM products WHERE id = %s", (product_id,))
    row = cursor.fetchone()
    if not row:
        return
    yield_val = row[0] if row[0] else 1
    flavor_name = row[1]
    article_type = row[2] or 'FORMULA'
    tenant_id = row[3]

    if article_type == 'SIMPLE':
        # COGS = último precio unitario cargado en gastos con descripción igual al nombre del artículo
        cursor.execute('''
            SELECT ei.unit_price
            FROM expense_items ei
            JOIN expenses e ON ei.expense_id = e.id
            WHERE UPPER(TRIM(ei.description)) = UPPER(TRIM(%s))
              AND e.tenant_id = %s
            ORDER BY e.date DESC, e.id DESC
            LIMIT 1
        ''', (flavor_name, tenant_id))
        cost_row = cursor.fetchone()
        cogs = cost_row[0] if cost_row else 0
        cursor.execute("UPDATE products SET current_gpu = %s WHERE id = %s", (cogs, product_id))
        return

    # FORMULA: suma(cantidad × costo_ingrediente) / rendimiento
    cursor.execute('''
        SELECT pi.quantity_per_batch, i.last_unit_cost
        FROM product_ingredients pi
        JOIN ingredients i ON pi.ingredient_id = i.id
        WHERE pi.product_id = %s
    ''', (product_id,))

    items = cursor.fetchall()
    if not items:
        cursor.execute("UPDATE products SET current_gpu = 0 WHERE id = %s", (product_id,))
        return

    total_batch_cost = sum(qty * cost for qty, cost in items)
    gpu = total_batch_cost / yield_val if yield_val > 0 else 0
    cursor.execute("UPDATE products SET current_gpu = %s WHERE id = %s", (gpu, product_id))


# ─────────────────────────────────────────────────────────────────────────────
# Gastos
# ─────────────────────────────────────────────────────────────────────────────

def add_expense(provider: str, category_name: str, items_list: list, date_str: str, tenant_id: int):
    """
    items_list: [{'description': 'Azucar', 'quantity': 10, 'unit_price': 900}]
    """
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT id FROM categories WHERE name = %s AND tenant_id = %s",
        (category_name, tenant_id)
    )
    cat_row = cursor.fetchone()
    if not cat_row:
        raise ValueError("Categoría no encontrada")
    cat_id = cat_row[0]

    total_amount = sum(item['quantity'] * item['unit_price'] for item in items_list)

    cursor.execute('''
        INSERT INTO expenses (provider, category_id, date, total_amount, tenant_id)
        VALUES (%s, %s, %s, %s, %s) RETURNING id
    ''', (provider, cat_id, date_str, total_amount, tenant_id))
    expense_id = cursor.fetchone()[0]

    for item in items_list:
        cursor.execute('''
            INSERT INTO expense_items (expense_id, description, quantity, unit_price, total_price)
            VALUES (%s, %s, %s, %s, %s)
        ''', (expense_id, item['description'], item['quantity'], item['unit_price'],
              item['quantity'] * item['unit_price']))

        if category_name == "INSUMOS":
            cursor.execute('''
                INSERT INTO ingredients (name, last_unit_cost, tenant_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (name, tenant_id) DO UPDATE SET last_unit_cost = EXCLUDED.last_unit_cost
            ''', (item['description'], item['unit_price'], tenant_id))

    conn.commit()

    # Recalcular COGS: FORMULA cuando cambian INSUMOS, SIMPLE siempre (cualquier gasto puede ser su costo)
    cursor.execute("SELECT id FROM products WHERE tenant_id = %s", (tenant_id,))
    all_products = cursor.fetchall()
    for (p_id,) in all_products:
        recalculate_product_gpu(p_id, cursor)
    conn.commit()

    conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Ventas
# ─────────────────────────────────────────────────────────────────────────────

def record_sale(client_name: str, items_list: list, discount: float, tenant_id: int, date_str: str = None):
    """
    items_list: [{'product_id': 1, 'quantity': 2}]
    """
    if not date_str:
        date_str = datetime.now().strftime("%Y-%m-%d")

    conn = get_connection()
    cursor = conn.cursor()

    total_income = 0
    total_gpu_snapshot = 0
    valid_items = []

    for item in items_list:
        cursor.execute(
            "SELECT flavor_name, sale_price, current_gpu FROM products WHERE id = %s AND tenant_id = %s",
            (item['product_id'], tenant_id)
        )
        prod = cursor.fetchone()
        if not prod:
            raise ValueError(f"Producto {item['product_id']} no encontrado en esta instancia")

        cursor.execute(
            "SELECT quantity_remaining FROM stock WHERE product_id = %s AND tenant_id = %s",
            (item['product_id'], tenant_id)
        )
        stock_row = cursor.fetchone()
        stock_qty = stock_row[0] if stock_row else 0

        if stock_qty < item['quantity']:
            raise ValueError(f"Stock insuficiente para {prod[0]}")

        total_income += prod[1] * item['quantity']
        total_gpu_snapshot += (prod[2] or 0) * item['quantity']
        valid_items.append({'id': item['product_id'], 'qty': item['quantity'], 'gpu': prod[2] or 0})

    final_income = total_income - discount

    cursor.execute('''
        INSERT INTO sales (client_name, date, discount, total_income, total_gpu_snapshot, tenant_id)
        VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
    ''', (client_name, date_str, discount, final_income, total_gpu_snapshot, tenant_id))
    sale_id = cursor.fetchone()[0]

    for item in valid_items:
        cursor.execute('''
            INSERT INTO sale_items (sale_id, product_id, quantity, gpu_snapshot)
            VALUES (%s, %s, %s, %s)
        ''', (sale_id, item['id'], item['qty'], item['gpu']))

        cursor.execute(
            "UPDATE stock SET quantity_remaining = quantity_remaining - %s WHERE product_id = %s AND tenant_id = %s",
            (item['qty'], item['id'], tenant_id)
        )

    conn.commit()
    conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Métricas de Performance
# ─────────────────────────────────────────────────────────────────────────────

def get_performance_metrics(month_str: str, tenant_id: int):
    """month_str format: 'YYYY-MM'"""
    conn = get_connection()
    cursor = conn.cursor()

    # 1. Ingresos y GTR (Gasto Total Real)
    cursor.execute('''
        SELECT SUM(total_income), SUM(total_gpu_snapshot)
        FROM sales
        WHERE to_char(date::timestamp, 'YYYY-MM') = %s AND tenant_id = %s
    ''', (month_str, tenant_id))
    sales_data = cursor.fetchone()
    ingresos = sales_data[0] if sales_data and sales_data[0] else 0
    gtr = sales_data[1] if sales_data and sales_data[1] else 0

    # 2. Egresos Operativos por categoría
    cursor.execute('''
        SELECT c.name, SUM(e.total_amount)
        FROM expenses e
        JOIN categories c ON e.category_id = c.id
        WHERE to_char(e.date::timestamp, 'YYYY-MM') = %s AND e.tenant_id = %s
        GROUP BY c.name
    ''', (month_str, tenant_id))
    egresos_by_cat = dict(cursor.fetchall())
    total_egresos_operativos = sum(v for k, v in egresos_by_cat.items() if k != "INSUMOS")

    # 3. Ingresos por producto del mes
    cursor.execute('''
        SELECT p.flavor_name, SUM(si.quantity), SUM(si.quantity * p.sale_price)
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        JOIN sales s ON si.sale_id = s.id
        WHERE to_char(s.date::timestamp, 'YYYY-MM') = %s AND s.tenant_id = %s
        GROUP BY p.flavor_name
        ORDER BY SUM(si.quantity * p.sale_price) DESC
    ''', (month_str, tenant_id))
    ingresos_por_producto = [
        {"producto": r[0], "unidades": r[1], "ingresos": r[2]}
        for r in cursor.fetchall()
    ]

    # 4. CTR Histórico (Capital Total Restante)
    cursor.execute(
        "SELECT COALESCE(SUM(total_income), 0) FROM sales WHERE tenant_id = %s",
        (tenant_id,)
    )
    total_ventas_hist = cursor.fetchone()[0]
    cursor.execute(
        "SELECT COALESCE(SUM(total_amount), 0) FROM expenses WHERE tenant_id = %s",
        (tenant_id,)
    )
    total_gastos_hist = cursor.fetchone()[0]
    ctr = total_ventas_hist - total_gastos_hist

    # 5. Rentabilidad
    rentabilidad = ((ingresos - gtr) / ingresos * 100) if ingresos > 0 else 0

    conn.close()

    return {
        'ingresos': ingresos,
        'gtr': gtr,
        'egresos_operativos': total_egresos_operativos,
        'egresos_detallados': egresos_by_cat,
        'rentabilidad_real': rentabilidad,
        'ingresos_por_producto': ingresos_por_producto,
        'ctr': ctr,
    }
