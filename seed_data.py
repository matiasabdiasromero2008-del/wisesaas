import sqlite3
from database import get_connection, init_db
import logic

def seed():
    init_db()
    conn = get_connection()
    cursor = conn.cursor()

    # 1. Seed Ingredients and Initial Costs
    ingredients = [
        ("AZUCAR", "kg", 900),
        ("NARANJAS", "kg", 0),
        ("MARACUYAS", "kg", 0),
        ("FRUTILLAS", "kg", 0),
        ("CIRUELAS", "kg", 0),
        ("MANZANAS", "kg", 0),
        ("DURAZNOS", "kg", 0),
        ("MORAS", "kg", 0),
        ("FRASCOS", "U", 1200),
        ("ETIQUETAS", "U", 0),
        ("LECHE", "lt", 0),
        ("C. LECHE", "U", 0)
    ]
    for name, unit, cost in ingredients:
        cursor.execute("INSERT OR IGNORE INTO ingredients (name, unit, last_unit_cost) VALUES (?, ?, ?)", 
                       (name, unit, cost))

    # 2. Seed Products
    products = [
        ("NARANJA", 2100),
        ("MARACUYA", 2100),
        ("FRUTILLA", 2100),
        ("CIRUELA", 2100),
        ("MANZANA", 2100),
        ("DURAZNO", 2100),
        ("MORA", 2100),
        ("DDL", 2100)
    ]
    for flavor, price in products:
        cursor.execute("INSERT OR IGNORE INTO products (flavor_name, sale_price) VALUES (?, ?)", 
                       (flavor, price))
        p_id = cursor.lastrowid or cursor.execute("SELECT id FROM products WHERE flavor_name=?", (flavor,)).fetchone()[0]
        cursor.execute("INSERT OR IGNORE INTO stock (product_id, quantity_remaining) VALUES (?, ?)", (p_id, 0))

    # 3. Seed Escandallo (Recipes) - Example for Naranja
    # Logic: Get IDs
    cursor.execute("SELECT id FROM products WHERE flavor_name='NARANJA'")
    p_naranja = cursor.fetchone()[0]
    
    cursor.execute("SELECT id FROM ingredients WHERE name='AZUCAR'")
    i_azucar = cursor.fetchone()[0]
    
    cursor.execute("SELECT id FROM ingredients WHERE name='FRASCOS'")
    i_frascos = cursor.fetchone()[0]

    # Batch for Naranja: 2kg Azucar + 13 Frascos -> Yield 13
    recipes = [
        (p_naranja, i_azucar, 2, 13),
        (p_naranja, i_frascos, 13, 13)
    ]
    for p_id, i_id, qty, yld in recipes:
        cursor.execute("INSERT OR IGNORE INTO escandallo (product_id, ingredient_id, qty_per_batch, yield_per_batch) VALUES (?, ?, ?, ?)", 
                       (p_id, i_id, qty, yld))

    conn.commit()
    
    # 4. Initial GPU update
    logic.update_all_gpus()
    
    # 5. Add some initial stock for testing
    cursor.execute("UPDATE stock SET quantity_remaining = 12 WHERE product_id = ?", (p_naranja,))
    
    conn.commit()
    conn.close()
    print("Base de datos inicializada y sembrada con éxito.")

if __name__ == "__main__":
    seed()
