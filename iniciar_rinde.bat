@echo off
title Rinde ERP - Iniciador
echo ========================================
echo       Iniciando Rinde ERP (Web)
echo ========================================
echo.

:: Check if Python is installed
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo [!] No se encontro Python en el sistema.
    echo [!] Instalando Python automaticamente...
    winget install Python.Python.3.11 --silent --accept-package-agreements --accept-source-agreements
    echo.
    echo [EXITO] Python se ha instalado. 
    echo [!] ATENCION: Por favor cierra esta ventana de negro y vuelve a darle doble clic a "iniciar_rinde.bat" para continuar.
    pause
    exit
)

echo [OK] Python esta instalado.
echo [!] Instalando/Verificando dependencias del servidor...
echo [!] Esto puede tardar unos minutos la primera vez...
python -m pip install -r requirements.txt

echo [OK] Dependencias listas.
echo [!] Levantando el servidor web...
echo.
echo ========================================
echo   Tu ERP estara disponible en tu navegador
echo   Por favor, no cierres esta ventana.
echo ========================================
echo.

:: Wait 2 seconds and open browser
timeout /t 2 /nobreak >nul
start http://localhost:8000

:: Run the server
python run.py

pause
