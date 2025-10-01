@echo off
setlocal enabledelayedexpansion

REM -----------------------------------------------------------------
REM VERSION=1.0.4
REM INSTALADOR/ACTUALIZADOR DE IMAGEN DOCKER PARA CONSULTA CAUSAS PJUD
REM -----------------------------------------------------------------

@echo off
echo ###########################################
echo           CONSULTA DE CAUSAS PJUD
echo ###########################################
echo.

echo [DEBUG] Paso 1: Comprobando Docker
set /p openDocker="Esta Docker abierto y corriendo (S/N): "
if /I not "%openDocker%"=="S" if /I not "%openDocker%"=="s" (
    echo Por favor abre Docker y vuelve a ejecutar este script.
    pause
    goto :EOF
)

echo [DEBUG] Paso 2: Detectando arquitectura con: docker version --format "{{.Server.Arch}}"
set "ARCH="
for /f "delims=" %%A in ('docker version --format "{{.Server.Arch}}" 2^>nul') do (
    set "ARCH=%%A"
)

if /I "%ARCH%"=="amd64" (
    set "IMG_BASENAME=consulta_causas_pjud_amd64"
) else if /I "%ARCH%"=="arm64" (
    set "IMG_BASENAME=consulta_causas_pjud"
) else (
    echo [ERROR] Arquitectura no reconocida: %ARCH%
    pause
    goto :EOF
)

echo [INFO] Arquitectura detectada: %ARCH%
echo [INFO] Basename de la imagen: %IMG_BASENAME%
echo.

echo Por favor espera un momento para verificar si hay actualizaciones...


echo [DEBUG] Paso 3: Descargando archivo INI (version.ini)
set "INI_URL=https://sandbox.walk.technology/update_repo.ini"
set "INI_FILE=%temp%\version.ini"
if exist "%INI_FILE%" del "%INI_FILE%"

:: Intentar con curl, luego wget, luego PowerShell
where curl >nul 2>nul
if %ERRORLEVEL%==0 (
    curl -fsSL -o "%INI_FILE%" "%INI_URL%"
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] No se pudo descargar version.ini con curl
        pause
        goto :EOF
    )
) else (
    where wget >nul 2>nul
    if %ERRORLEVEL%==0 (
        wget -q -O "%INI_FILE%" "%INI_URL%"
        if %ERRORLEVEL% neq 0 (
            echo [ERROR] No se pudo descargar version.ini con wget
            pause
            goto :EOF
        )
    ) else (
        powershell -Command "(New-Object Net.WebClient).DownloadFile('%INI_URL%', '%INI_FILE%')" 2>nul
        if not exist "%INI_FILE%" (
            echo [ERROR] No se pudo descargar version.ini con PowerShell
            pause
            goto :EOF
        )
    )
)

echo [DEBUG] Paso 4: Leer LATEST= en %INI_FILE%
set "LATEST="
for /f "tokens=1,* delims==" %%I in ('type "%INI_FILE%"') do (
    if /I "%%I"=="LATEST" (
        set "LATEST=%%J"
    )
)
if "%LATEST%"=="" (
    echo [ERROR] version.ini no contiene LATEST=
    pause
    goto :EOF
)
echo [INFO] Ultima version publicada: %LATEST%
echo.

REM -----------------------------------------------------------------
REM Paso 5) Buscar imagen local => version local
REM -----------------------------------------------------------------
echo [DEBUG] Paso 5: Detectar imagen local con base "%IMG_BASENAME%"
set "dockerLocal="
for /f "delims=" %%X in ('docker images --format "{{.Repository}}:{{.Tag}}"') do (
    echo [DEBUG] => %%X
    echo %%X | findstr /i "%IMG_BASENAME%" >nul
    if !ERRORLEVEL! equ 0 (
        set "dockerLocal=%%X"
        goto foundLocal
    )
)

:foundLocal
echo [DEBUG] dockerLocal=%dockerLocal%
set "localVer=none"

if not "%dockerLocal%"=="" (
    echo [INFO] Se encontro la imagen local: %dockerLocal%
    for /f "tokens=1,2 delims=:" %%a in ("%dockerLocal%") do (
        set "tagPart=%%b"
    )

    if defined tagPart (
        echo [INFO] Tag detectado: !tagPart!
        echo !tagPart! | findstr /r "^[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*$" >nul
        if !errorlevel! equ 0 (
            echo [WARN] El tag no cumple x.y.z
            set "localVer=unknown"
        ) else (
            set "localVer=!tagPart!"
        )
    ) else (
        echo [WARN] No se pudo extraer la parte despues de ":"
        set "localVer=unknown"
    )
)

if "%localVer%"=="none" (
    echo [DEBUG] No se detecto ninguna imagen local
    set /p hasVersion="Tienes alguna version instalada no detectada (S/N): "
    if /I "%hasVersion%"=="S" (
        set /p userVer="Cual version tienes (ej: 1.0.2): "
        set "localVer=%userVer%"
    )
)

echo [DEBUG] localVer=%localVer%
echo.

REM -----------------------------------------------------------------
REM Paso 6) Instalar/actualizar la imagen a LATEST si difiere
REM (Aqui NO comparamos version del script)
REM -----------------------------------------------------------------
echo [DEBUG] Paso 6: Instalar/actualizar imagen

if "%localVer%"=="none" (
    echo [INFO] No hay version instalada. Instalo %LATEST%.
    call :installDockerImage "%LATEST%"
    if %ERRORLEVEL%==0 (
        set "localVer=%LATEST%"
        echo [INFO] Se instalo la version %LATEST%.
        goto updateScript
    ) else (
        echo [ERROR] No se pudo instalar %LATEST%
        pause
        goto :EOF
    )
) else (
    if "%localVer%"=="unknown" (
        echo [INFO] Se forzara la instalacion de %LATEST%.
        call :installDockerImage "%LATEST%"
        if %ERRORLEVEL%==0 (
            set "localVer=%LATEST%"
            echo [INFO] Se instalo %LATEST%.
            goto updateScript
        ) else (
            echo [ERROR] No se pudo instalar %LATEST%.
            pause
            goto :EOF
        )
    ) else (
        if "%localVer%"=="%LATEST%" (
            echo [INFO] Ya tienes la version mas reciente: %LATEST%.
        ) else (
            echo [INFO] Hay una version mas reciente: %LATEST%. Actualizando...
            call :installDockerImage "%LATEST%"
            if %ERRORLEVEL%==0 (
                set "localVer=%LATEST%"
                echo [INFO] Actualizado a %LATEST%.
                goto updateScript
            ) else (
                echo [ERROR] Fallo la actualizacion a %LATEST%.
                pause
                goto :EOF
            )
        )
    )
)

echo.
echo [DEBUG] Paso 6-B: No hubo actualizacion de imagen => no se descarga script
goto step8

REM ---------------------------------------------------------------
REM Paso 7) Actualizar el propio instalador (FORZADO, sin leer
REM version local del script)
REM ---------------------------------------------------------------
:updateScript
echo [DEBUG] Paso 7: Descargando instalador de la misma version LATEST=%LATEST%

set "archKey=exec_win_repo"
REM set "archKey=exec_win_repo_%ARCH%"
set "newBatUrl="
call :getValueFromIni "%LATEST%" "exec_win_repo" "%INI_FILE%" "newBatUrl"
REM el anterior que llamaba arch era call :getValueFromIni "%LATEST%" "exec_win_repo_%ARCH%" "%INI_FILE%" "newBatUrl"

if "%newBatUrl%"=="" (
    echo [INFO] No se define %archKey% en la seccion [%LATEST%]. Sin actualizacion del .bat
    goto step8
) else (
    set "newFile=instalador_v%LATEST%.bat"
    echo [INFO] Descargando nuevo instalador => %newFile%
    call :downloadFile "%newBatUrl%" "%newFile%"
    if %ERRORLEVEL%==0 (
        echo [INFO] Se descargo el nuevo instalador: %newFile%
        ren "%~f0" "%~nx0.old"
        echo [INFO] Usa ".\%newFile%" en adelante.
        pause
        goto :EOF
    ) else (
        echo [ERROR] No se pudo descargar %newFile%.
        pause
        goto :EOF
    )
)

REM ---------------------------------------------------------------
REM Paso 8) Pedir datos al usuario
REM ---------------------------------------------------------------
:step8
echo.
echo [DEBUG] Paso 8: Solicitar RUT, DV, YEAR
set /p RUT="Ingresa el RUT sin puntos ni DV (ej 79556490): "
set /p DV="Ingresa DV (ej k): "
set /p YEAR="Ingresa YEAR (ej 2024): "
set /p HOST_DESTINO="Ingrese la carpeta local donde desea guardar resultados (ej: C:\Users\... ): "
set /p HOST_CSV_MODO2="Si vas a procesar causas desde un CSV, escribe la RUTA donde esta el archivo (sino pega la misma de arriba, NO DEJAR EN BLANCO): "

echo [DEBUG] Revisando
echo   RUT=%RUT%
echo   DV=%DV%
echo   YEAR=%YEAR%
echo   Carpeta Destino=%HOST_DESTINO%
echo   Ruta CSV=%HOST_CSV_MODO2%
set /p confirm="Son correctos (S/N): "
if /I not "%confirm%"=="S" if /I not "%confirm%"=="s" (
    echo Cancelando
    pause
    goto :EOF
)

REM Paso 9) Ejecutar contenedor Docker
echo [DEBUG] Paso 9: Ejecutar contenedor

set "CONTAINER_DEST=/app/resultados"
set "CONTAINER_DEST_CSV=/app/carpeta_lectura_modo2"
set "IMG_NAME=%IMG_BASENAME%:%localVer%"

REM --rm --shm-size=4gb
echo docker run --rm -it ^
    -e RUT=%RUT% ^
    -e DV=%DV% ^
    -e YEAR=%YEAR% ^
    -e DESTINO=%CONTAINER_DEST% ^
    -e DIR_CSV_MODO2=%CONTAINER_DEST_CSV% ^
    -v "%HOST_DESTINO%:%CONTAINER_DEST%" ^
    -v "%HOST_CSV_MODO2%:%CONTAINER_DEST_CSV%" ^
    "%IMG_NAME%"

docker run --rm -it ^
    -e RUT=%RUT% ^
    -e DV=%DV% ^
    -e YEAR=%YEAR% ^
    -e DESTINO=%CONTAINER_DEST% ^
    -e DIR_CSV_MODO2=%CONTAINER_DEST_CSV% ^
    -v "%HOST_DESTINO%:%CONTAINER_DEST%" ^
    -v "%HOST_CSV_MODO2%:%CONTAINER_DEST_CSV%" ^
    "%IMG_NAME%"

echo [INFO] Programa terminado
pause
goto :EOF

REM ===========================================================================
REM SUBRUTINAS
REM ===========================================================================
:getValueFromIni
setlocal enabledelayedexpansion
set "iniSec=[%~1]"
set "iniKey=%~2"   :: Clave a buscar, sin '='
set "iniFile=%~3"
set "outVar=%~4"

set "foundSection=0"
set "foundValue="

for /f "usebackq delims=" %%Y in ("%iniFile%") do (
    set "line=%%Y"
    if "!line!"=="!iniSec!" (
        set "foundSection=1"
    ) else (
        if "!foundSection!"=="1" (
            if "!line:~0,1!"=="[" (
                set "foundSection=0"
            ) else (
                echo !line! | findstr /i /b "!iniKey!=" >nul
                if !errorlevel! equ 0 (
                    for /f "tokens=1* delims==" %%A in ("!line!") do (
                        set "foundValue=%%B"
                    )
                )
            )
        )
    )
)

echo [DEBUG getValueFromIni] Valor encontrado para %iniKey%: %foundValue%
endlocal & set "%outVar%=%foundValue%"
goto :EOF

:downloadFile
REM call :downloadFile "<URL>" "<destFile>"
setlocal
set "url=%~1"
set "destFile=%~2"

where curl >nul 2>nul
if %ERRORLEVEL%==0 (
    curl -fL --progress-bar -o "%destFile%" "%url%"
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Falla al descargar con curl
        endlocal
        exit /b 1
    )
) else (
    where wget >nul 2>nul
    if %ERRORLEVEL%==0 (
        wget -q --show-progress -O "%destFile%" "%url%"
        if %ERRORLEVEL% neq 0 (
            echo [ERROR] Falla al descargar con wget
            endlocal
            exit /b 1
        )
    ) else (
        powershell -Command "(New-Object Net.WebClient).DownloadFile('%url%', '%destFile%')" 2>nul
        if %ERRORLEVEL% neq 0 (
            echo [ERROR] Falla al descargar con PowerShell
            endlocal
            exit /b 1
        )
    )
)

endlocal
exit /b 0

:installDockerImage
REM call :installDockerImage "1.0.3"
setlocal
set "ver=%~1"

echo [DEBUG] SUB: installDockerImage ver=%ver%

set "tarUrl="
call :getValueFromIni "%ver%" "repo_img_%ARCH%" "%INI_FILE%" "tarUrl"

if "%tarUrl%"=="" (
    echo [INFO] No se define "repo_img_%ARCH%" en la seccion [%ver%]. Sin actualizacion de imagen.
    endlocal
    exit /b 1  :: **Puedes cambiar a exit /b 0 si prefieres continuar**
)

set "tarName=consulta_causas_pjud_%ver%_%ARCH%.tar"
echo [INFO] Descargando imagen Docker: %tarUrl%
call :downloadFile "%tarUrl%" "%tarName%"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] No se pudo descargar la imagen Docker.
    endlocal
    exit /b 1
)

if not exist "%tarName%" (
    echo [ERROR] No se descargo bien: %tarName%
    endlocal
    exit /b 1
)

for %%Z in ("%tarName%") do (
    if %%~zZ==0 (
        echo [ERROR] El archivo "%tarName%" esta vacio
        endlocal
        exit /b 1
    )
)

echo [INFO] Cargando la imagen con "docker load -i %tarName%"
docker load -i "%tarName%"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] docker load fallo
    endlocal
    exit /b 1
)

endlocal
exit /b 0
