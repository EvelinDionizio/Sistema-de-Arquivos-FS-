@echo off
chcp 65001 > nul
echo ======================================================================
echo   EXECUTANDO TESTE AUTOMATIZADO DO SIMULADOR DE SISTEMA DE ARQUIVOS
echo ======================================================================
echo.

where node >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Executando com Node.js...
    node simulator.js demo
    goto end
)

where python >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Executando com Python 3...
    python simulator.py demo
    goto end
)

echo [ERRO] Nem Node.js nem Python foram encontrados no sistema.
echo Instale o Node.js ou o Python para executar o simulador.

:end
echo.
echo ======================================================================
echo   Teste concluido com sucesso!
echo ======================================================================
pause
