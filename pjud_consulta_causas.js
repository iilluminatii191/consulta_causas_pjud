const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

/****************************************************************************************
 * Helpers generales
 ****************************************************************************************/
function safeFileName(str) {
  return str.replace(/[<>:"/\\|?*]+/g, '_');
}
function makeLogger(execLogPath) {
  return function log(message) {
    console.log(message);
    fs.appendFileSync(execLogPath, message + '\n', 'utf8');
  };
}
function writeLog(filePath, message) {
  fs.appendFileSync(filePath, message + '\n', 'utf8');
}
function writeErrorLog(errorLogPath, message) {
  fs.appendFileSync(errorLogPath, message + '\n', 'utf8');
}
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function randomDelay(minMs, maxMs) {
  const rand = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, rand));
}

/**
 * Cierra cualquier modal .modal.in (Bootstrap) que esté en "display: block;"
 * usando el botón <button type="button" class="close" data-dismiss="modal">×</button>.
 * 
 * Reintenta hasta 3 veces. Cada vez:
 *   - Busca un div.modal.in con style="display: block;"
 *   - Encuentra su button.close[data-dismiss="modal"]
 *   - Hace click
 *   - Espera a que ese modal se oculte (display: none) o deje de tener `.in`
 */
async function closeAnyActiveModal(page, log, errorLogPath) {
  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    try {
      // 1) Esperar un modal .modal.in con display:block
      await page.waitForFunction(() => {
        const modals = document.querySelectorAll('.modal.in');
        // Buscar al menos uno con style="display: block;"
        return [...modals].some(m => m.style.display === 'block');
      }, { timeout: 5000 });

      // 2) Hacer click en el button.close de ese modal
      await page.evaluate(() => {
        const modals = document.querySelectorAll('.modal.in');
        for (const modal of modals) {
          if (modal.style.display === 'block') {
            // Tomar este modal
            const closeBtn = modal.querySelector('button.close[data-dismiss="modal"]');
            if (closeBtn) {
              closeBtn.click();
            } else {
              // Podríamos forzar un click en un overlay, pero 
              // en tu caso dices que no hay más forma que la X
            }
            break; // Terminamos con el primer modal abierto
          }
        }
      });

      // 3) Esperar a que se oculte (display: none) o deje de tener .in
      await page.waitForFunction(() => {
        const modals = document.querySelectorAll('.modal');
        return [...modals].every(m => m.style.display === 'none' || !m.classList.contains('in'));
      }, { timeout: 4000 });

      log(`    Modal cerrado (attempt ${attempts})`);
      return; // Éxito

    } catch (err) {
      const warnMsg = `[WARN] Error al cerrar modal => ${err.message}, reintento ${attempts}/3`;
      log(`    ${warnMsg}`);
      writeErrorLog(errorLogPath, warnMsg);

      // Hacemos un pequeño scrollTop + delay
      await page.evaluate(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      });
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  const errorMsg = '[ERROR] No se pudo cerrar el modal tras 3 intentos.';
  log(`    ${errorMsg}`);
  writeErrorLog(errorLogPath, errorMsg);
}

/****************************************************************************************
 * Ejemplo parseTdCell => "F. Ing.: 11/11/2024" => "F. Ing.,11/11/2024"
 ****************************************************************************************/
function parseTdCell(cellText) {
  const splitted = cellText.split(':');
  if (splitted.length === 2) {
    const key = splitted[0].trim();
    const value = splitted[1].trim();
    return `${key},${value}`;
  }
  return cellText.replace(/,/g, ''); // elimina comas sueltas
}

/****************************************************************************************
 * Ejemplo para CSV principal
 ****************************************************************************************/
function appendResultsToCSV(filePath, rows, competencia, corteOTribunal) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      'Competencia,Seleccionado,RIT,RUC,Tribunal,Caratulado,Fecha Ingreso,Estado Causa\n',
      'utf8'
    );
  }
  let lines = '';
  for (const row of rows) {
    // row => p.ej. length=5 => [RIT, Tribunal, Caratulado, Fecha, Estado]
    // length=6 => [RIT, RUC, Tribunal, Caratulado, Fecha, Estado]
    // ...
    if (row.length === 5) {
      const [rit, trib, carat, fecha, estado] = row;
      const line = [competencia, corteOTribunal, rit, '', trib, carat, fecha, estado].join(',');
      lines += line + '\n';
    } else if (row.length === 6) {
      const [rit, ruc, trib, carat, fecha, estado] = row;
      const line = [competencia, corteOTribunal, rit, ruc, trib, carat, fecha, estado].join(',');
      lines += line + '\n';
    } else {
      // Manejar otros casos (7 columnas, etc.)
      console.warn(`[WARN] Row con longitud inesperada: ${row.length} => ${row}`);
      // ...
    }
  }
  fs.appendFileSync(filePath, lines, 'utf8');
}

/****************************************************************************************
 * CSV de cada causa (con litigantes, etc.)
 ****************************************************************************************/
function saveCauseCsv(filePath, infoModalLines, litigantesData) {
  const linesLitigantes = litigantesData.map(row => row.join(',')).join('\n');
  const finalText = infoModalLines.join('\n') + '\n\nLitigantes:\n' + linesLitigantes;
  fs.writeFileSync(filePath, finalText, 'utf8');
}

/****************************************************************************************
 * CSV formateado => ejemplo
 ****************************************************************************************/
function saveFormateadoCsv(filePath, caratulado, tribunal, fechaIngreso, etapa, estAdm, estProc, litigantesForm) {
  const lines = [];
  lines.push(`${caratulado}`);
  lines.push(`Tribunales,${tribunal}`);
  lines.push(`Fecha de Ingreso,${fechaIngreso}`);
  litigantesForm.forEach(l => lines.push(l));
  lines.push(`Materia,`);
  lines.push(`Hitos Relevantes del Proceso,`);
  lines.push(`Etapa,${etapa}`);
  lines.push(`Estado Adm.,${estAdm}`);
  lines.push(`Estado Proc.,${estProc}`);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

/****************************************************************************************
 * procesoCausa => se basa en la ausencia de tab "litigantes" => isReserved
 ****************************************************************************************/
async function procesoCausa(page, causa, basePath, errorLogPath, log) {
  log(`  >> procesoCausa(): RIT=${causa.rit}, Caratulado=${causa.caratulado}`);

  const safeRit = safeFileName(causa.rit);
  const safeCarat = safeFileName(causa.caratulado);
  const causeFolderPath = path.join(basePath, `${safeRit} -- ${safeCarat}`);
  if (!fs.existsSync(causeFolderPath)) fs.mkdirSync(causeFolderPath, { recursive: true });

  // 1) Abrir modal
  if (!causa.onclick) {
    const warnMsg = `[WARN] No se encontró onclick para la causa: ${causa.rit}`;
    log(`    ${warnMsg}`);
    writeErrorLog(errorLogPath, warnMsg);
    return;
  }
  await page.evaluate(onclickStr => eval(onclickStr), causa.onclick);

  // 2) Esperar .modal-backdrop
  try {
    await page.waitForSelector('.modal-backdrop.in.modal-stack', { visible: true, timeout: 10000 });
  } catch (e) {
    const errMsg = `[ERROR] No apareció modal backdrop para ${causa.rit}`;
    log(`    ${errMsg}`);
    writeErrorLog(errorLogPath, errMsg);
    return;
  }

  await randomDelay(5000, 15000);

  // 3) Captura
  const scModalPath = path.join(causeFolderPath, 'modal.png');
  await page.screenshot({ path: scModalPath });
  log(`    Captura de pantalla del modal: ${scModalPath}`);

  // 4) isReserved => ausencia de tab "litigantes"
  //    Si no existe a[href^="#litigantes"], la causa está reservada
  const hasLitigTab = await page.evaluate(() => {
    return !!document.querySelector('a[href^="#litigantes"]');
  });
  const isReserved = !hasLitigTab;
  log(`    hasLitigTab=${hasLitigTab} => isReserved=${isReserved}`);

  // 5) Extraer tabla principal (table.table-titulos)
  let infoModalLines = [];
  let fechaIng = '', etapa = '', estAdm = '', estProc = '';

  try {
    const table1 = await page.evaluate(() => {
      const tab = document.querySelector('table.table-titulos');
      if (!tab) return null;
      return Array.from(tab.querySelectorAll('td')).map(td => td.innerText.trim());
    });
    if (table1) {
      table1.forEach(td => {
        const line = parseTdCell(td);
        infoModalLines.push(line);
        if (td.startsWith('F. Ing.')) {
          fechaIng = td.split(':')[1].trim();
        }
        if (td.startsWith('Etapa:')) {
          etapa = td.split(':')[1].trim();
        }
        if (td.startsWith('Est. Adm.')) {
          estAdm = td.split(':')[1].trim();
        }
        if (td.startsWith('Estado Proc.:')) {
          estProc = td.split(':')[1].trim();
        }
      });
    } else {
      const warnMsg = `[WARN] No se encontró table.table-titulos en la causa: ${causa.rit}`;
      log(`    ${warnMsg}`);
      writeErrorLog(errorLogPath, warnMsg);
      infoModalLines.push('No Data Found in table');
    }
  } catch(err) {
    const warnMsg = `[WARN] Error extrayendo tabla principal => ${err.message}`;
    log(`    ${warnMsg}`);
    writeErrorLog(errorLogPath, warnMsg);
  }

  // 6) Si no reservada => buscar tab litigantes genérico
  let litigantesData = [];
  if (!isReserved) {
    try {
      // Tomamos el primer <a href^="#litigantes">
      const linkLitig = await page.evaluate(() => {
        const link = document.querySelector('a[href^="#litigantes"]');
        return link ? link.getAttribute('href') : null;
      });
      if (linkLitig) {
        // Hacer click
        await page.click(`a[href="${linkLitig}"]`);
        log(`    Clic en tab "${linkLitig}" para ${causa.rit}`);

        // Esperar la <table> dentro del contenedor linkLitig
        const tableSel = `${linkLitig} table.table-bordered`;
        await page.waitForSelector(tableSel, { visible: true, timeout: 5000 });

        litigantesData = await page.evaluate((sel) => {
          const table = document.querySelector(sel);
          if (!table) return [];
          const rows = table.querySelectorAll('tbody tr');
          const out = [];
          rows.forEach(tr => {
            const tds = tr.querySelectorAll('td');
            // A veces 4 col (Cobranza), a veces 6 col (Laboral), etc.
            const rowArr = [...tds].map(td => td.innerText.trim());
            out.push(rowArr);
          });
          return out;
        }, tableSel);

        log(`    Se extrajeron ${litigantesData.length} litigantes para ${causa.rit}`);
      } else {
        // Realmente no hay tab => (?), 
        log(`    [INFO] No se encontró tab litigantes genérico => sin litigantes en ${causa.rit}`);
      }
    } catch (err) {
      const warnMsg = `[WARN] Error extrayendo litigantes => ${err.message}`;
      log(`    ${warnMsg}`);
      writeErrorLog(errorLogPath, warnMsg);
    }
  } else {
    log('    [INFO] Causa reservada => omitimos "Litigantes".');
  }

  // 7) E-Book => solo si !isReserved (omito detalles)
  // ...

  // 8) Cerrar modal => closeAnyActiveModal
  await closeAnyActiveModal(page, log, errorLogPath);

  // 9) CSV individual
  if (isReserved) {
    infoModalLines.push('CAUSA RESERVADA POR ACTA 44-2022');
  }
  const causeCsvPath = path.join(causeFolderPath, `${safeRit} -- ${safeCarat}.csv`);
  saveCauseCsv(causeCsvPath, infoModalLines, litigantesData);
  log(`    CSV (con litigantes) guardado: ${causeCsvPath}`);

  // 10) CSV FORMATEADO => si no reservada
  if (!isReserved) {
    fechaIng = fechaIng || '';
    etapa   = etapa   || '';
    estAdm  = estAdm  || '';
    estProc = estProc || '';

    // Mapear litigantes => p.ej. 
    const litigantesForm = [];
    for (const row of litigantesData) {
      // Laboral => 6 col, Cobranza => 4 col, etc.
      // Ajusta la forma de parsear
      if (row.length === 6) {
        // Ej Laboral: [Est., Abog. Defensor, Sujeto, Rut, Persona, Nombre]
        const [col0, col1, sujeto, rut, persona, nombre] = row;
        litigantesForm.push(`Sujeto,${sujeto}`);
        litigantesForm.push(`Rut,${rut}`);
        litigantesForm.push(`Persona,${persona}`);
        litigantesForm.push(`Nombre,${nombre}`);
        litigantesForm.push('');
      } else if (row.length === 4) {
        // Ej Cobranza: [Sujeto, Rut, Persona, Nombre]
        const [suj, rut, pers, nom] = row;
        litigantesForm.push(`Sujeto,${suj}`);
        litigantesForm.push(`Rut,${rut}`);
        litigantesForm.push(`Persona,${pers}`);
        litigantesForm.push(`Nombre,${nom}`);
        litigantesForm.push('');
      }
    }
    const formCsvPath = path.join(causeFolderPath, `${safeRit} -- ${safeCarat} FORMATEADO.csv`);
    saveFormateadoCsv(formCsvPath, causa.caratulado, causa.tribunal, fechaIng, etapa, estAdm, estProc, litigantesForm);
    log(`    CSV FORMATEADO guardado: ${formCsvPath}`);
  } else {
    log('    [INFO] No se genera CSV FORMATEADO por ser causa reservada.');
  }
}

/****************************************************************************************
 * buscarYProcesar => extrae filas => se añade al CSV principal
 * (Ajuste clave: siempre registra la fila, aunque sea reservada)
 ****************************************************************************************/
async function buscarYProcesar(
  page,
  competenciaLabel,
  seleccionLabel,
  screenshotName,
  logPath,
  csvPath,
  execLog,
  screenshotsConCausasPath,
  screenshotsSinResultadosPath
) {
  execLog(`>>> buscarYProcesar() => competencia="${competenciaLabel}", seleccionado="${seleccionLabel}"`);

  // 1. Botón "Buscar"
  await page.waitForSelector('#btnConConsultaJur');
  await page.evaluate(() => document.querySelector('#btnConConsultaJur')?.scrollIntoView());
  await delay(500);

  await page.$eval('#btnConConsultaJur', (btn) => btn.click());
  execLog(`Hizo clic en "Buscar" para ${competenciaLabel} - ${seleccionLabel}... Esperando loader...`);

  // 2. Esperar loader (si aparece)
  try {
    await page.waitForFunction(() => {
      const loader = document.querySelector('#loadPreJuridica');
      return loader && loader.innerHTML.trim() !== '';
    }, { timeout: 3000 });
  } catch(e) {
    // Si no aparece, no pasa nada
  }

  // 3. Esperar que se vacíe (30s)
  await page.waitForFunction(() => {
    const loader = document.querySelector('#loadPreJuridica');
    return loader && loader.innerHTML.trim() === '';
  }, { timeout: 30000 });
  execLog(`Loader finalizado para ${competenciaLabel} - ${seleccionLabel}`);

  // 4. Pequeño delay random
  await randomDelay(500, 3000);

  // 5. Extraer filas
  /**
   * "No se han encontrado resultados" => si es la única fila en #verDetalleJuridica 
   * => noResults = true
   */
  const resultInfo = await page.evaluate(() => {
    const resultDiv = document.querySelector('#resultConsultaJuridica');
    if (!resultDiv) {
      return { noResults: true, data: [] };
    }

    const rows = resultDiv.querySelectorAll('#verDetalleJuridica tr');
    if (rows.length === 0) {
      return { noResults: true, data: [] };
    }

    // Si hay una sola fila y su texto incluye "No se han encontrado resultados"
    if (rows.length === 1) {
      const text = rows[0].innerText.trim();
      if (text.includes('No se han encontrado resultados')) {
        return { noResults: true, data: [] };
      }
    }

    // Caso contrario => parsear
    const dataRows = [];
    rows.forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length > 1) {
        // [RIT,(RUC?),Tribunal,Caratulado,Fecha,Estado]
        const rowData = Array.from(tds).slice(1).map(td => td.textContent.trim());
        dataRows.push(rowData);
      }
    });

    return { noResults: (dataRows.length === 0), data: dataRows };
  });

  // 6. Screenshot => con o sin resultados
  let screenshotDir;
  if (resultInfo.noResults) {
    screenshotDir = screenshotsSinResultadosPath;
  } else {
    screenshotDir = screenshotsConCausasPath;
  }
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const scPath = path.join(screenshotDir, screenshotName);
  await page.setViewport({ width: 1920, height: 1080 });
  await page.screenshot({ path: scPath });
  execLog(`Captura de pantalla: "${scPath}"`);

  // 7. Log + CSV
  if (resultInfo.noResults) {
    execLog(`Sin resultados en ${competenciaLabel} - ${seleccionLabel}`);
    writeLog(logPath, `[${new Date().toISOString()}] ${competenciaLabel}, ${seleccionLabel} => SIN RESULTADOS`);
  } else {
    const total = resultInfo.data.length;
    execLog(`Se encontraron ${total} resultados en ${competenciaLabel} - ${seleccionLabel}`);
    writeLog(logPath, `[${new Date().toISOString()}] ${competenciaLabel}, ${seleccionLabel} => ${total} resultados`);

    // CSV principal => anotar filas, incl. las reservadas
    appendResultsToCSV(csvPath, resultInfo.data, competenciaLabel, seleccionLabel);
  }

  return resultInfo;
}

/****************************************************************************************
 * MAIN => recorre competencias
 ****************************************************************************************/
async function main(configParams) {
  const { rut, dv, year, destino } = configParams;

  // 1. Logs
  const logPath      = path.resolve(destino || __dirname, 'consulta_log.txt');
  const errorLogPath = path.resolve(destino || __dirname, 'errorLog.txt');
  const execLogPath  = path.resolve(destino || __dirname, 'exec_log.txt');
  fs.writeFileSync(execLogPath, '', 'utf8'); // Limpia exec_log al inicio
  const log = makeLogger(execLogPath);

  // 2. Directorios
  const basePath = path.resolve(destino || __dirname, 'Detalles Causas Encontradas');
  if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });

  const screenshotsConCausasPath = path.join(destino || __dirname, 'Screenshots Búsquedas con Causas');
  if (!fs.existsSync(screenshotsConCausasPath)) fs.mkdirSync(screenshotsConCausasPath, { recursive:true });

  const screenshotsSinResultadosPath = path.join(destino || __dirname, 'Screenshots Búsquedas sin Resultados');
  if (!fs.existsSync(screenshotsSinResultadosPath)) fs.mkdirSync(screenshotsSinResultadosPath, { recursive:true });

  const mainCsvPath = path.join(destino || __dirname, 'Listado de Causas Encontradas.csv');
  if (!fs.existsSync(mainCsvPath)) {
    fs.writeFileSync(
      mainCsvPath,
      'Competencia,Seleccionado,RIT,RUC,Tribunal,Caratulado,Fecha Ingreso,Estado Causa\n',
      'utf8'
    );
  }

  let browser;
  let page;

  try {
    // 3. Lanzar puppeteer
    browser = await puppeteer.launch({ headless:false });
    page = await browser.newPage();

    // 4. Ir a home pjud
    await page.goto('https://oficinajudicialvirtual.pjud.cl/home/index.php', { waitUntil:'domcontentloaded' });
    log('Entrando sitio pjud.cl');

    // "Consulta causas"
    await page.waitForSelector('button.dropbtn[onclick="accesoConsultaCausas();"]');
    await page.click('button.dropbtn[onclick="accesoConsultaCausas();"]');
    log('Clic en "Consulta causas"');
    await page.waitForNavigation({ waitUntil:'domcontentloaded' });

    // "Búsqueda por Rut Persona Jurídica"
    await page.waitForSelector('a[href="#BusJuridica"]');
    await page.click('a[href="#BusJuridica"]');
    log('Clic en "Búsqueda por Rut Persona Jurídica"');

    // 4b. Llenar RUT, DV, AÑO
    log('DEBUG: Esperando input #rutJur');
    await page.waitForSelector('#rutJur', { visible:true });
    log('DEBUG: Escribiendo RUT, DV, Año');
    await page.click('#rutJur');
    await page.keyboard.type(rut, { delay:50 });
    await page.waitForSelector('#dvJur');
    await page.type('#dvJur', dv);
    await page.waitForSelector('#eraJur');
    await page.type('#eraJur', year);

    // Scroll top
    await page.evaluate(() => {
      window.scrollTo({ top:0, left:0, behavior:'smooth' });
    });

    // 5. Recorrer Competencias
    const competencias = [
      { value:'1', label:'Corte Suprema',    seleccion:'Suprema',   screenshot:'Suprema.png' },
      { value:'2', label:'Corte Apelaciones',seleccion:'C.A. de Santiago',screenshot:'CorteApel.png' },
      { value:'3', label:'Civil',   seleccion:'Civil',   screenshot:'Civil.png' },
      { value:'4', label:'Laboral', seleccion:'Laboral', screenshot:'Laboral.png' },
      { value:'5', label:'Penal',   seleccion:'Penal',   screenshot:'Penal.png' },
      { value:'6', label:'Cobranza',seleccion:'Cobranza',screenshot:'Cobranza.png' },
    ];

    for (const comp of competencias) {
      log(`\n### Procesando Competencia: "${comp.label}" (value=${comp.value}) ###`);
      await page.select('#jurCompetencia', comp.value);
      await delay(1000);

      if (comp.value === '2') {
        // Caso Corte Apelaciones => #corteJur
        await page.waitForSelector('#corteJur');
        await page.evaluate(() => {
          const sel = document.querySelector('#jurCompetencia');
          sel.dispatchEvent(new Event('change', { bubbles:true }));
        });
        await page.waitForFunction(() => {
          const sel = document.querySelector('#corteJur');
          return sel && sel.querySelectorAll('option').length > 1;
        }, { timeout:10000 });

        // Listar combos
        const allOpts = await page.$$eval('#corteJur option', arr =>
          arr.map(o => ({ value:o.value, label:o.textContent.trim() }))
        );
        const dynamicOpts = allOpts.filter(o => o.value !== '0');
        log(`Cortes en Apelaciones: ${dynamicOpts.length}`);

        // Delay
        await randomDelay(5000, 10000);

        for (const corte of dynamicOpts) {
          log(`\n>> ${comp.label} - Seleccionando: ${corte.label} (value=${corte.value})`);
          await page.select('#corteJur', corte.value);
          await delay(1000);

          const screenshotName = `${comp.label} - ${corte.label}.png`;
          const resCorte = await buscarYProcesar(
            page,
            comp.label,
            corte.label,
            screenshotName,
            logPath,
            mainCsvPath,
            log,
            screenshotsConCausasPath,
            screenshotsSinResultadosPath
          );

          // Si hay resultados => extraer onclick + data
          if (!resCorte.noResults) {
            const causas = await page.evaluate(() => {
              const out = [];
              const rows = document.querySelectorAll('#verDetalleJuridica tr');
              rows.forEach(tr => {
                const tds = tr.querySelectorAll('td');
                if (tds.length > 1) {
                  const link = tds[0].querySelector('a');
                  const onclick = link ? link.getAttribute('onclick') : null;
                  // Siguientes celdas => [RIT,(RUC?),Trib,Carat,Fecha,Estado]
                  let arr = Array.from(tds).slice(1).map(td => td.textContent.trim());
                  out.push({ onclick, arr });
                }
              });
              return out;
            });

            // procesoCausa para cada fila
            for (const c2 of causas) {
              let [RIT, RUC='', Trib, Carat, FIng, Est] = c2.arr;
              if (c2.arr.length === 5) {
                [RIT, Trib, Carat, FIng, Est] = c2.arr;
              }
              const causa = {
                onclick: c2.onclick,
                rit: RIT,
                ruc: RUC,
                tribunal: Trib,
                caratulado: Carat,
                fecha: FIng,
                estado: Est
              };
              log(`Procesando causa: ${causa.rit} - ${causa.caratulado}`);
              await procesoCausa(page, causa, basePath, errorLogPath, log);
              await randomDelay(5000, 10000);
            }
          }
        }
      } else if (['3', '4', '5', '6'].includes(comp.value)) {
        // Civil, Laboral, Penal, Cobranza
        await page.waitForSelector('#jurTribunal', { visible:true });
        await page.evaluate(() => {
          const sel = document.querySelector('#jurCompetencia');
          sel.dispatchEvent(new Event('change', { bubbles:true }));
        });
        await page.waitForFunction(() => {
          const sel = document.querySelector('#jurTribunal');
          return sel && sel.querySelectorAll('option').length > 1;
        }, { timeout:10000 });

        const allTribOpts = await page.$$eval('#jurTribunal option', arr =>
          arr.map(o => ({ value:o.value, label:o.textContent.trim() }))
        );
        const dynamicTrib = allTribOpts.filter(o => o.value && o.value !== '0');
        log(`Tribunales en ${comp.label}: ${dynamicTrib.length}`);

        for (const trib of dynamicTrib) {
          log(`\n>> ${comp.label} - Tribunal: ${trib.label} (value=${trib.value})`);
          await page.select('#jurTribunal', trib.value);
          await delay(1000);
          await randomDelay(5000, 10000);

          const screenshotName = `${comp.label} - ${trib.label}.png`;
          const resTrib = await buscarYProcesar(
            page,
            comp.label,
            trib.label,
            screenshotName,
            logPath,
            mainCsvPath,
            log,
            screenshotsConCausasPath,
            screenshotsSinResultadosPath
          );

          if (!resTrib.noResults) {
            // Extraer onclick + data
            const causas = await page.evaluate(() => {
              const out = [];
              const rows = document.querySelectorAll('#verDetalleJuridica tr');
              rows.forEach(tr => {
                const tds = tr.querySelectorAll('td');
                if (tds.length > 1) {
                  const link = tds[0].querySelector('a');
                  const onclick = link ? link.getAttribute('onclick') : null;
                  let arr = Array.from(tds).slice(1).map(td => td.textContent.trim());
                  out.push({ onclick, arr });
                }
              });
              return out;
            });

            for (const c3 of causas) {
              let [RIT, RUC='', Trib2, Carat, FIng, Est] = c3.arr;
              if (c3.arr.length === 5) {
                [RIT, Trib2, Carat, FIng, Est] = c3.arr;
              }
              const causa = {
                onclick: c3.onclick,
                rit: RIT,
                ruc: RUC,
                tribunal: Trib2,
                caratulado: Carat,
                fecha: FIng,
                estado: Est
              };
              log(`Procesando causa: ${causa.rit} - ${causa.caratulado}`);
              await procesoCausa(page, causa, basePath, errorLogPath, log);
              await randomDelay(5000, 10000);
            }
          }
        }
      } else {
        // Corte Suprema => sin tribunal
        const screenshotName = comp.screenshot;
        const resSup = await buscarYProcesar(
          page,
          comp.label,
          comp.seleccion,
          screenshotName,
          logPath,
          mainCsvPath,
          log,
          screenshotsConCausasPath,
          screenshotsSinResultadosPath
        );
        if (!resSup.noResults) {
          const causas = await page.evaluate(() => {
            const out = [];
            const rows = document.querySelectorAll('#verDetalleJuridica tr');
            rows.forEach(tr => {
              const tds = tr.querySelectorAll('td');
              if (tds.length > 1) {
                const link = tds[0].querySelector('a');
                const onclick = link ? link.getAttribute('onclick') : null;
                let arr = Array.from(tds).slice(1).map(td => td.textContent.trim());
                out.push({ onclick, arr });
              }
            });
            return out;
          });
          for (const c4 of causas) {
            let [RIT, RUC='', Trib2, Carat, FIng, Est] = c4.arr;
            if (c4.arr.length === 5) {
              [RIT, Trib2, Carat, FIng, Est] = c4.arr;
            }
            const causa = {
              onclick: c4.onclick,
              rit: RIT,
              ruc: RUC,
              tribunal: Trib2,
              caratulado: Carat,
              fecha: FIng,
              estado: Est
            };
            log(`Procesando causa: ${causa.rit} - ${causa.caratulado}`);
            await procesoCausa(page, causa, basePath, errorLogPath, log);
            await randomDelay(5000, 10000);
          }
        }
      }
    }

    // Final
    log('\n>> Todas las consultas finalizadas. Cerrando navegador.');
    await browser.close();
  } catch(err) {
    log(`Error: ${err.stack}`);
    writeLog(logPath, `ERROR: ${err.stack}`);
    if (browser) {
      try { await browser.close(); } catch(e){}
    }
  }
}

/****************************************************************************************
 * leerParametros y lanzador
 ****************************************************************************************/
function leerParametros(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: El archivo ${filePath} no existe.`);
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const params = {};
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    const [k, v] = line.split(':');
    if (k && v) {
      params[k.trim().toLowerCase()] = v.trim();
    }
  }
  return params;
}

(async () => {
  try {
    const filePath = path.resolve(__dirname, 'parametros.txt');
    const config = leerParametros(filePath);

    const rut   = config.rut   || '';
    const dv    = config.dv    || '';
    const year  = config.year  || '';
    const destino = config.destino || __dirname;

    if (!rut || !dv || !year) {
      console.error('Error: RUT, DV y Año son obligatorios en parametros.txt');
      process.exit(1);
    }

    await main({ rut, dv, year, destino });
  } catch (err) {
    console.error('Error en la ejecución del script:', err);
  }
})();