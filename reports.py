import pandas as pd
from fpdf import FPDF
from database import get_connection
import logic
import os

def export_to_excel(month_str):
    data = logic.get_performance_metrics(month_str)
    
    # Create a DataFrame for summary
    df_summary = pd.DataFrame([{
        'Mes': month_str,
        'Ingresos Brutos': data['ingresos'],
        'GTR (Costo Real)': data['gtr'],
        'Egresos Operativos': data['egresos_operativos'],
        'Rentabilidad Real (%)': data['rentabilidad_real']
    }])
    
    # Create a DataFrame for detailed expenses
    df_expenses = pd.DataFrame(list(data['egresos_detallados'].items()), columns=['Categoría', 'Monto'])
    
    filename = f"reports/Rinde_Reporte_{month_str}.xlsx"
    if not os.path.exists("reports"):
        os.makedirs("reports")
        
    with pd.ExcelWriter(filename) as writer:
        df_summary.to_excel(writer, sheet_name='Resumen', index=False)
        df_expenses.to_excel(writer, sheet_name='Gastos Detallados', index=False)
        
    return filename

def export_to_pdf(month_str):
    data = logic.get_performance_metrics(month_str)
    
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", 'B', 16)
    pdf.cell(200, 10, txt=f"Reporte de Rentabilidad Rinde - {month_str}", ln=True, align='C')
    
    pdf.set_font("Arial", size=12)
    pdf.ln(10)
    pdf.cell(200, 10, txt=f"Ingresos Brutos: ${data['ingresos']:.2f}", ln=True)
    pdf.cell(200, 10, txt=f"GTR (Costo Real de lo Vendido): ${data['gtr']:.2f}", ln=True)
    pdf.cell(200, 10, txt=f"Egresos Operativos: ${data['egresos_operativos']:.2f}", ln=True)
    pdf.cell(200, 10, txt=f"Rentabilidad Real: {data['rentabilidad_real']:.2f}%", ln=True)
    
    pdf.ln(10)
    pdf.set_font("Arial", 'B', 12)
    pdf.cell(200, 10, txt="Detalle de Egresos por Categoría:", ln=True)
    pdf.set_font("Arial", size=10)
    for cat, amount in data['egresos_detallados'].items():
        pdf.cell(200, 8, txt=f"- {cat}: ${amount:.2f}", ln=True)
        
    filename = f"reports/Rinde_Reporte_{month_str}.pdf"
    if not os.path.exists("reports"):
        os.makedirs("reports")
    pdf.output(filename)
    
    return filename
