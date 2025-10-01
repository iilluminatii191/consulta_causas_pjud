#!/bin/bash
# VERSION=1.0.3
# INSTALADOR/ACTUALIZADOR DE IMAGEN DOCKER PARA CONSULTA CAUSAS PJUD

set -euo pipefail

echo "###########################################"
echo "         CONSULTA DE CAUSAS PJUD           "
echo "###########################################"
echo ""
echo ""

########################################################################################
# 1) Confirmar que Docker esté abierto
########################################################################################
read -p "¿Está Docker abierto y corriendo? (S/N) " openDocker
if [[ "$openDocker" != "S" && "$openDocker" != "s" ]]; then
  echo "Por favor abre Docker y vuelve a ejecutar este script."
  exit 1
fi

########################################################################################
# 2) Detectar arquitectura + basename de la imagen
########################################################################################
ARCH=$(uname -m)
if [[ "$ARCH" == "x86_64" ]]; then
  ARCH="amd64"
  IMG_BASENAME="consulta_causas_pjud_amd64"
elif [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
  ARCH="arm64"
  IMG_BASENAME="consulta_causas_pjud"
else
  echo "[ERROR] Arquitectura no reconocida: $ARCH"
  exit 1
fi
echo "[INFO] Arquitectura detectada: $ARCH"
echo "[INFO] Basename de la imagen: $IMG_BASENAME"

echo ""
echo ""#############################""
echo "Por favor espera mientras se verifica si hay actualizaciones..."
echo ""

########################################################################################
# 3) Descargar el archivo INI (versión) desde URL fijo
########################################################################################
INI_URL="https://sandbox.walk.technology/update_repo.ini"
INI_FILE="/tmp/version.ini"

downloadINI() {
  echo "[INFO] Descargando version.ini desde: $INI_URL"
  if command -v curl &>/dev/null; then
    curl -fsSL -o "$INI_FILE" "$INI_URL" || { echo "[ERROR] No se pudo descargar version.ini"; exit 1; }
  elif command -v wget &>/dev/null; then
    wget -q -O "$INI_FILE" "$INI_URL" || { echo "[ERROR] No se pudo descargar version.ini"; exit 1; }
  else
    echo "[ERROR] Ni curl ni wget encontrados. Abortando."
    exit 1
  fi
}
downloadINI

########################################################################################
# 4) Obtener la última versión (LATEST=...)
########################################################################################
LATEST=$(grep '^LATEST=' "$INI_FILE" | cut -d= -f2)
if [ -z "$LATEST" ]; then
  echo "[ERROR] version.ini no contiene 'LATEST='"
  exit 1
fi
echo "[INFO] La última versión publicada es: $LATEST"

########################################################################################
# Función auxiliar para extraer valor de una sección [x] del INI
# getIniValue "1.0.3" "repo_img_amd64" /tmp/version.ini
########################################################################################
getIniValue() {
  local section="[$1]"
  local key="$2"
  awk -v sec="$section" -v ky="$key" '
    $0 == sec { found=1; next }
    /^\[/{ found=0 }
    found && index($0, ky"=")==1 {
      split($0,arr,"=")
      print arr[2]
      exit
    }
  ' "$3"
}

########################################################################################
# 5) Instalar/actualizar la imagen Docker (.tar) con docker load
########################################################################################
installDockerImage() {
  local ver="$1"
  local archKey="repo_img_${ARCH}"
  local tarUrl
  tarUrl=$(getIniValue "$ver" "$archKey" "$INI_FILE")
  if [ -z "$tarUrl" ]; then
    echo "[ERROR] No se encontró la clave $archKey en la sección [$ver] del INI."
    return 1
  fi

  echo "[INFO] Descargando la imagen Docker v$ver-$ARCH desde $tarUrl"
  local tarName="consulta_causas_pjud_${ver}_${ARCH}.tar"

  if command -v curl &>/dev/null; then
    curl -fL --progress-bar -o "$tarName" "$tarUrl" || return 1
  else
    wget -q --show-progress -O "$tarName" "$tarUrl" || return 1
  fi

  if [ ! -s "$tarName" ]; then
    echo "[ERROR] El archivo descargado está vacío o no existe: $tarName"
    return 1
  fi

  echo "[INFO] Cargando la imagen con 'docker load' (espere por favor)..."
  docker load -i "$tarName" || return 1
  return 0
}

########################################################################################
# 6) Detectar imágenes Docker locales (basename) => deducir versión
########################################################################################
echo "[DEBUG] Detectando imágenes Docker locales con base '$IMG_BASENAME'..."
dockerLocal=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -i "$IMG_BASENAME" || true)
localVer="none"
if [ -n "$dockerLocal" ]; then
  echo "[INFO] Se detectó la(s) siguiente(s) imagen(es) local(es):"
  echo "$dockerLocal"
  firstLine=$(echo "$dockerLocal" | head -n1)
  tagPart=$(echo "$firstLine" | cut -d: -f2)
  if [[ "$tagPart" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    localVer="$tagPart"
    echo "[INFO] Versión local deducida: $localVer"
  else
    echo "[WARN] Formato inesperado en el tag: $tagPart"
    localVer="unknown"
  fi
fi

if [[ "$localVer" == "none" ]]; then
  echo "¿Tienes alguna versión INSTALADA de la imagen Docker que no haya sido detectada? (S/N)"
  read hasVersion
  if [[ "$hasVersion" =~ ^[Ss]$ ]]; then
    echo "¿Qué versión tiene instalada? (ej: 1.0.2, 1.0.3, etc.)"
    read userVer
    localVer="$userVer"
  fi
fi
echo "[INFO] Versión local detectada/ingresada: $localVer"

########################################################################################
# 7) Instalar o actualizar a la versión LATEST si es distinto
########################################################################################
if [[ "$localVer" == "none" || "$localVer" == "unknown" ]]; then
  echo "[INFO] No hay versión instalada. Instalaré la versión $LATEST del basename '$IMG_BASENAME'"
  if installDockerImage "$LATEST"; then
    localVer="$LATEST"
    echo "[INFO] Se instaló correctamente la versión $LATEST"
  else
    echo "[ERROR] No se pudo instalar la versión $LATEST"
    exit 1
  fi
else
  if [[ "$localVer" != "$LATEST" ]]; then
    echo "[INFO] Existe una versión más reciente ($LATEST). Se procederá a actualizar automáticamente..."
    if installDockerImage "$LATEST"; then
      localVer="$LATEST"
      echo "[INFO] Se actualizó correctamente a la versión $LATEST"
    else
      echo "[ERROR] No se pudo actualizar a la versión $LATEST. Se mantiene la versión local: $localVer"
    fi
  else
    echo "[INFO] Ya tienes la versión más reciente: $LATEST"
  fi
fi

########################################################################################
# 8) Actualizar el propio instalador sin preguntar al usuario
########################################################################################
# Detectar la versión actual del script leyendo la línea "# VERSION=x.x.x"
scriptVerCur=$(grep -m1 '^# VERSION=' "$0" | cut -d= -f2 || true)
if [ -z "$scriptVerCur" ]; then
  echo "[WARN] No se encontró un '# VERSION=' en este script. Asumir '0.0.0'"
  scriptVerCur="0.0.0"
fi

getIniValueOrEmpty() {
  local section="[$1]"
  local key="$2"
  awk -v sec="$section" -v ky="$key" '
    $0 == sec { found=1; next }
    /^\[/{ found=0 }
    found && index($0, ky"=")==1 {
      split($0,arr,"=")
      print arr[2]
      exit
    }
  ' "$3"
}

updateThisScriptAuto() {
  if [[ "$scriptVerCur" == "$LATEST" ]]; then
    echo "[INFO] El instalador ya está en la versión $scriptVerCur (la más reciente)."
    return
  fi

  local archKey="exec_unix_repo_${ARCH}"
  local newShUrl
  newShUrl=$(getIniValueOrEmpty "$LATEST" "$archKey" "$INI_FILE")
  if [ -z "$newShUrl" ]; then
    echo "[INFO] No se define $archKey para la versión $LATEST => sin actualización de instalador."
    return
  fi

  local newFile="instalador_v${LATEST}.sh"
  echo "[INFO] Se descargará automáticamente el nuevo instalador v${LATEST} => $newFile"
  if command -v curl &>/dev/null; then
    curl -fsSL -o "$newFile" "$newShUrl" || { echo "[ERROR] No se pudo descargar $newFile"; return; }
  else
    wget -q -O "$newFile" "$newShUrl" || { echo "[ERROR] No se pudo descargar $newFile"; return; }
  fi

  chmod +x "$newFile"
  echo "[INFO] Se ha descargado el nuevo instalador: $newFile"

  # Eliminar o renombrar este mismo script
  thisScript="$(basename "$0")"
  mv "$thisScript" "${thisScript}.old" || echo "[WARN] No se pudo renombrar el script actual"

  echo "[INFO] Se ha descargado la nueva versión del instalador. Usa ./$newFile en adelante."
  exit 0
}

updateThisScriptAuto

########################################################################################
# 9) Pedir datos para la ejecución
########################################################################################
echo "#############################"
echo ""

# 1. Pedir variables al usuario
read -p "Ingresa el RUT sin dígito verificador ni puntos (ej: 79556490): " RUT
read -p "Ingresa el DV (ej: k): " DV
read -p "Ingresa el YEAR (ej: 2024): " YEAR

# Si también quieres solicitar la carpeta local donde guardar resultados:
read -p "Ingresa la carpeta local (ruta absoluta) donde deseas guardar los resultados: " HOST_DESTINO
read -p "Si vas a procesar causas desde un CSV, escribe la RUTA donde está el archivo (sino copia la de arriba): " HOST_CSV_MODO2

# 2. Mostrar un resumen de los datos ingresados y pedir confirmación
echo ""
echo "Has ingresado los siguientes datos:"
echo "  - RUT=$RUT"
echo "  - DV=$DV"
echo "  - YEAR=$YEAR"
echo "  - Carpeta local de destino=$HOST_DESTINO"
echo "  - Carpeta local donde está el CSV=$HOST_CSV_MODO2"
echo ""
read -p "¿Son correctos? (S/N): " confirm
case $confirm in
    [Ss]* ) 
        echo "Continuando con la ejecución...";;
    [Nn]* )
        echo "Cancelando la ejecución del contenedor..."
        exit 1;;
    * )
        echo "Respuesta no válida. Cancelando."
        exit 1;;
esac

# 3. Definir la carpeta de destino dentro del contenedor
CONTAINER_DEST="/app/resultados"
CONTAINER_DEST_CSV="/app/carpeta_lectura_modo2"

########################################################################################
# 10) Ejecutar el contenedor Docker con la imagen local
########################################################################################
IMG_NAME="${IMG_BASENAME}:${localVer}"
echo "[INFO] Ejecutando contenedor con la imagen $IMG_NAME..."
docker run --rm -it \
    -e RUT=$RUT \
    -e DV=$DV \
    -e YEAR=$YEAR \
    -e DESTINO=$CONTAINER_DEST \
    -e DIR_CSV_MODO2=$CONTAINER_DEST_CSV \
    -v "$HOST_DESTINO:$CONTAINER_DEST" \
    -v "$HOST_CSV_MODO2:$CONTAINER_DEST_CSV" \
  "$IMG_NAME"

echo "Programa terminado, revisa cuidadosamente los archivos en la carpeta que indicaste :)"
exit 0