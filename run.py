import uvicorn

if __name__ == "__main__":
    print("Iniciando Rinde ERP Web Server...")
    print("Por favor, abre tu navegador en: http://localhost:8000")
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
