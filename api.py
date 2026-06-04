from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import bcrypt
import os
from datetime import datetime

from database import get_connection, init_db
import logic

app = FastAPI(title="Rinde ERP API")

# Initialize DB on startup
@app.on_event("startup")
def startup_event():
    init_db()

# Serve Frontend
frontend_dir = os.path.join(os.path.dirname(__file__), "frontend")
if not os.path.exists(frontend_dir):
    os.makedirs(frontend_dir)
app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

@app.get("/")
def serve_index():
    return FileResponse(os.path.join(frontend_dir, "index.html"))

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # For development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Pydantic Models ---

class LoginRequest(BaseModel):
    username: str
    password: str

class ExpenseItemModel(BaseModel):
    description: str
    quantity: float
    unit_price: float

class ExpenseRequest(BaseModel):
    provider: str
    category_name: str
    items: List[ExpenseItemModel]
    date: Optional[str] = None

class ProviderModel(BaseModel):
    name: str
    category_name: str

class SaleItemModel(BaseModel):
    product_id: int
    quantity: int

class SaleRequest(BaseModel):
    client_name: str
    items: List[SaleItemModel]
    discount: float = 0
    date: Optional[str] = None

# --- API Endpoints ---

@app.post("/login")
def login(req: LoginRequest):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT password_hash, role FROM users WHERE username = ?", (req.username,))
    result = cursor.fetchone()
    conn.close()
    
    if result and bcrypt.checkpw(req.password.encode('utf-8'), result[0].encode('utf-8')):
        return {"success": True, "role": result[1], "username": req.username}
    else:
        raise HTTPException(status_code=401, detail="Invalid credentials")

@app.get("/metrics")
def get_metrics(month: str = None):
    if not month:
        month = datetime.now().strftime("%Y-%m")
    try:
        data = logic.get_performance_metrics(month)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/expenses")
def create_expense(req: ExpenseRequest):
    date_str = req.date if req.date else datetime.now().strftime("%Y-%m-%d")
    items_dict = [{"description": i.description, "quantity": i.quantity, "unit_price": i.unit_price} for i in req.items]
    try:
        logic.add_expense(req.provider, req.category_name, items_dict, date_str)
        return {"success": True, "message": "Expense registered"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/providers")
def get_providers():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT p.id, p.name, c.name 
        FROM providers p 
        JOIN categories c ON p.category_id = c.id
    """)
    results = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1], "category": r[2]} for r in results]

@app.post("/providers")
def add_provider(req: ProviderModel):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM categories WHERE name = ?", (req.category_name,))
        cat_id = cursor.fetchone()
        if not cat_id:
            raise HTTPException(status_code=400, detail="Category not found")
        
        cursor.execute("INSERT INTO providers (name, category_id) VALUES (?, ?)", (req.name, cat_id[0]))
        conn.commit()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()

@app.delete("/providers/{provider_id}")
def delete_provider(provider_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM providers WHERE id = ?", (provider_id,))
    conn.commit()
    conn.close()
    return {"success": True}

@app.post("/sales")
def create_sale(req: SaleRequest):
    date_str = req.date if req.date else datetime.now().strftime("%Y-%m-%d")
    items_dict = [{"product_id": i.product_id, "quantity": i.quantity} for i in req.items]
    try:
        logic.record_sale(req.client_name, items_dict, req.discount, date_str)
        return {"success": True, "message": "Sale registered"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/stock")
def get_stock():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT p.id, p.flavor_name, s.quantity_remaining 
        FROM products p 
        JOIN stock s ON p.id = s.product_id
    """)
    results = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "flavor": r[1], "stock": r[2]} for r in results]

@app.get("/products")
def get_products():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, flavor_name, sale_price, current_gpu FROM products")
    results = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1], "price": r[2], "gpu": r[3]} for r in results]

@app.get("/categories")
def get_categories():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name FROM categories")
    results = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1]} for r in results]
