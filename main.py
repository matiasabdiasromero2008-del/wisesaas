import tkinter as tk
from tkinter import ttk, messagebox
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
import bcrypt
from database import get_connection, init_db
import logic
from datetime import datetime

class RindeApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Rinde - ERP de Rentabilidad Dinámica")
        self.root.geometry("1000x700")
        self.current_user = None
        
        # Initialize Database
        init_db()
        
        # Style
        self.style = ttk.Style()
        self.style.theme_use("clam")
        
        self.show_login()

    def clear_screen(self):
        for widget in self.root.winfo_children():
            widget.destroy()

    def show_login(self):
        self.clear_screen()
        frame = ttk.Frame(self.root, padding="20")
        frame.place(relx=0.5, rely=0.5, anchor="center")
        
        ttk.Label(frame, text="Rinde", font=("Arial", 24, "bold")).grid(row=0, column=0, columnspan=2, pady=20)
        
        ttk.Label(frame, text="Usuario:").grid(row=1, column=0, sticky="e", pady=5)
        self.user_ent = ttk.Entry(frame)
        self.user_ent.grid(row=1, column=1, pady=5)
        
        ttk.Label(frame, text="Contraseña:").grid(row=2, column=0, sticky="e", pady=5)
        self.pass_ent = ttk.Entry(frame, show="*")
        self.pass_ent.grid(row=2, column=1, pady=5)
        
        ttk.Button(frame, text="Ingresar", command=self.login).grid(row=3, column=0, columnspan=2, pady=20)

    def login(self):
        username = self.user_ent.get()
        password = self.pass_ent.get()
        
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT password_hash, role FROM users WHERE username = ?", (username,))
        result = cursor.fetchone()
        conn.close()
        
        if result and bcrypt.checkpw(password.encode('utf-8'), result[0].encode('utf-8')):
            self.current_user = {'username': username, 'role': result[1]}
            if self.current_user['role'] == "Admin":
                self.show_admin_dashboard()
            else:
                self.show_operator_dashboard()
        else:
            messagebox.showerror("Error", "Usuario o contraseña incorrectos")

    # --- ADMIN DASHBOARD ---
    def show_admin_dashboard(self):
        self.clear_screen()
        
        # Sidebar / Tabs
        notebook = ttk.Notebook(self.root)
        notebook.pack(fill="both", expand=True)
        
        perf_tab = ttk.Frame(notebook)
        gastos_tab = ttk.Frame(notebook)
        escandallo_tab = ttk.Frame(notebook)
        
        notebook.add(perf_tab, text="Performance")
        notebook.add(gastos_tab, text="Carga de Gastos")
        notebook.add(escandallo_tab, text="Escandallo")
        
        self.setup_performance_tab(perf_tab)
        self.setup_gastos_tab(gastos_tab)
        self.setup_escandallo_tab(escandallo_tab)
        
        # Logout button
        btn_frame = ttk.Frame(self.root)
        btn_frame.pack(fill="x")
        ttk.Button(btn_frame, text="Cerrar Sesión", command=self.show_login).pack(side="right", padx=10, pady=5)

    def setup_performance_tab(self, frame):
        # Monthly Selector
        top_frame = ttk.Frame(frame, padding="10")
        top_frame.pack(fill="x")
        
        ttk.Label(top_frame, text="Mes (YYYY-MM):").pack(side="left")
        month_var = tk.StringVar(value=datetime.now().strftime("%Y-%m"))
        ttk.Entry(top_frame, textvariable=month_var, width=10).pack(side="left", padx=5)
        
        metrics_frame = ttk.Frame(frame, padding="10")
        metrics_frame.pack(fill="both", expand=True)

        def refresh_metrics():
            m = month_var.get()
            data = logic.get_performance_metrics(m)
            
            # Clear previous chart
            for widget in metrics_frame.winfo_children():
                widget.destroy()
                
            # Text metrics
            txt = f"Ingresos: ${data['ingresos']:.2f} | GTR: ${data['gtr']:.2f}\n"
            txt += f"Rentabilidad Real: {data['rentabilidad_real']:.2f}%"
            ttk.Label(metrics_frame, text=txt, font=("Arial", 14)).pack(pady=10)
            
            # Matplotlib Chart
            fig, ax = plt.subplots(figsize=(6, 4))
            labels = ['Ingresos', 'GTR', 'Egresos Op.']
            values = [data['ingresos'], data['gtr'], data['egresos_operativos']]
            ax.bar(labels, values, color=['#4CAF50', '#F44336', '#2196F3'])
            ax.set_title(f"Performance - {m}")
            
            canvas = FigureCanvasTkAgg(fig, master=metrics_frame)
            canvas.draw()
            canvas.get_tk_widget().pack(pady=10)

        ttk.Button(top_frame, text="Ver Performance", command=refresh_metrics).pack(side="left", padx=10)
        refresh_metrics()

    def setup_gastos_tab(self, frame):
        ttk.Label(frame, text="Nueva Carga de Gastos", font=("Arial", 16, "bold")).pack(pady=10)
        
        form = ttk.Frame(frame, padding="20")
        form.pack()
        
        ttk.Label(form, text="Proveedor:").grid(row=0, column=0, sticky="e")
        prov_ent = ttk.Entry(form)
        prov_ent.grid(row=0, column=1, pady=5)
        
        ttk.Label(form, text="Categoría:").grid(row=1, column=0, sticky="e")
        cat_cb = ttk.Combobox(form, values=["Sueldo", "Insumos", "Utensilios", "Programas", "TN web", "Diseñador", "Packaging", "Marketing"])
        cat_cb.grid(row=1, column=1, pady=5)
        
        # Item entry (simplified for now, supporting 1 item per form but logic supports 5)
        ttk.Label(form, text="Descripción:").grid(row=2, column=0, sticky="e")
        desc_ent = ttk.Entry(form)
        desc_ent.grid(row=2, column=1, pady=5)
        
        ttk.Label(form, text="Cantidad:").grid(row=3, column=0, sticky="e")
        qty_ent = ttk.Entry(form)
        qty_ent.grid(row=3, column=1, pady=5)
        
        ttk.Label(form, text="Precio Unitario:").grid(row=4, column=0, sticky="e")
        unit_ent = ttk.Entry(form)
        unit_ent.grid(row=4, column=1, pady=5)
        
        def save_gasto():
            try:
                items = [{
                    'description': desc_ent.get(),
                    'quantity': float(qty_ent.get()),
                    'unit_price': float(unit_ent.get())
                }]
                logic.add_expense(prov_ent.get(), cat_cb.get(), items, datetime.now().strftime("%Y-%m-%d"))
                messagebox.showinfo("Éxito", "Gasto registrado y costos actualizados.")
            except Exception as e:
                messagebox.showerror("Error", f"Verifique los datos: {e}")

        ttk.Button(form, text="Registrar Gasto", command=save_gasto).grid(row=5, column=0, columnspan=2, pady=20)

    def setup_escandallo_tab(self, frame):
        ttk.Label(frame, text="Gestión de Recetas (Escandallo)", font=("Arial", 16, "bold")).pack(pady=10)
        # Placeholder for recipe management
        ttk.Label(frame, text="En esta sección se definen los insumos por tanda y el rendimiento.").pack()

    # --- OPERATOR DASHBOARD ---
    def show_operator_dashboard(self):
        self.clear_screen()
        
        frame = ttk.Frame(self.root, padding="20")
        frame.pack(fill="both", expand=True)
        
        ttk.Label(frame, text="Carga de Ventas", font=("Arial", 18, "bold")).pack(pady=10)
        
        # Simple Sales Form
        sale_form = ttk.Frame(frame)
        sale_form.pack(pady=20)
        
        ttk.Label(sale_form, text="Cliente:").grid(row=0, column=0, sticky="e")
        client_ent = ttk.Entry(sale_form)
        client_ent.grid(row=0, column=1, pady=5)
        
        ttk.Label(sale_form, text="Producto (ID):").grid(row=1, column=0, sticky="e")
        prod_ent = ttk.Entry(sale_form)
        prod_ent.grid(row=1, column=1, pady=5)
        
        ttk.Label(sale_form, text="Cantidad:").grid(row=2, column=0, sticky="e")
        qty_ent = ttk.Entry(sale_form)
        qty_ent.grid(row=2, column=1, pady=5)
        
        def save_sale():
            try:
                items = [{'product_id': int(prod_ent.get()), 'quantity': int(qty_ent.get())}]
                logic.record_sale(client_ent.get(), items, 0)
                messagebox.showinfo("Éxito", "Venta registrada con GPU snapshot.")
            except Exception as e:
                messagebox.showerror("Error", f"{e}")

        ttk.Button(sale_form, text="Registrar Venta", command=save_sale).grid(row=3, column=0, columnspan=2, pady=20)
        
        # Stock View
        ttk.Label(frame, text="Stock Disponible", font=("Arial", 14, "bold")).pack(pady=10)
        self.stock_tree = ttk.Treeview(frame, columns=("ID", "Sabor", "Stock"), show="headings")
        self.stock_tree.heading("ID", text="ID")
        self.stock_tree.heading("Sabor", text="Sabor")
        self.stock_tree.heading("Stock", text="Stock")
        self.stock_tree.pack(fill="x")
        
        def refresh_stock():
            for i in self.stock_tree.get_children():
                self.stock_tree.delete(i)
            conn = get_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT p.id, p.flavor_name, s.quantity_remaining FROM products p JOIN stock s ON p.id = s.product_id")
            for row in cursor.fetchall():
                self.stock_tree.insert("", "end", values=row)
            conn.close()

        ttk.Button(frame, text="Actualizar Stock", command=refresh_stock).pack(pady=5)
        refresh_stock()
        
        ttk.Button(self.root, text="Cerrar Sesión", command=self.show_login).pack(pady=10)

if __name__ == "__main__":
    root = tk.Tk()
    app = RindeApp(root)
    root.mainloop()
