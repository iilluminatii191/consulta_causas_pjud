//es lo mismo que el 5, pero se corrigen los errores de ejecución del ebook descarga en headless true

console.log('Hola!, estás ejecutando la versión 1.0.5 del programa, revisa lo que ingreses antes de comenzar; cualquier error que detectes se agradece puedas informarlo para arreglarlo :)');
console.log('');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// node-fetch dinámico
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Variables principales (ajusta a tu gusto o usa process.env)
const rut = process.env.RUT || "77465752";
const dv = process.env.DV || "5";
const year = process.env.YEAR || "2024";
const destino = process.env.DESTINO ||
  '/Users/alexssander/Desktop/ruts vale/14-02/santillana educación';

// '1' => modo original (consulta + csv + screenshots)
// '2' => leer CSV [Competencia, Seleccionado, RIT] y procesar causas específicas
//const preguntaAction= await askQuestion(`¿Quieres buscar causas (1) o procesar un listado de causas desde un CSV (2)?: `);
//const action= (preguntaAction.trim()==='1');
//const action = 2;//process.env.ACTION || '1';

//const csvOrigen = '/Users/alexssander/Downloads/procesar.csv'; // para Modo 2 (ajusta si deseas)

console.log(`Usando RUT=${rut}, DV=${dv}, YEAR=${year}, DESTINO=${destino}`); //, ACTION=${action}
if (!fs.existsSync(destino)) {
  fs.mkdirSync(destino, { recursive: true });
}

/****************************************************************************************
 * Helpers generales
 ****************************************************************************************/
function askQuestion(query) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, ans => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

function safeFileName(str) {
  return (str || '').replace(/[<>:"/\\|?*]+/g, '_');
}

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function randomDelay(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(res => setTimeout(res, ms));
}

function makeLogger(execLogPath) {
  return function log(msg) {
    console.log(msg);
    fs.appendFileSync(execLogPath, msg + '\n', 'utf8');
  };
}

function writeLog(filePath, message) {
  fs.appendFileSync(filePath, message + '\n', 'utf8');
}

function writeErrorLog(errorLogPath, message) {
  fs.appendFileSync(errorLogPath, message + '\n', 'utf8');
}

function waitUserConfirmation(msg='Presione Enter para reintentar o Ctrl+C para abortar...') {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(msg, () => {
      rl.close();
      resolve();
    });
  });
}

/****************************************************************************************
 * Delimitador CSV
 ****************************************************************************************/
function detectDelimiter(line) {
  const commas = (line.match(/,/g) || []).length;
  const semis  = (line.match(/;/g) || []).length;
  return (semis > commas) ? ';' : ',';
}

/****************************************************************************************
 * SweetAlert / Modals
 ****************************************************************************************/
async function closeSweetAlertIfVisible(page, log, errorLogPath) {
  for (let attempt=1; attempt<=3; attempt++){
    try {
      const isSweetAlertVisible = await page.evaluate(()=>{
        const sa = document.querySelector('.sweet-alert.showSweetAlert.visible');
        const ov = document.querySelector('.sweet-overlay[style*="display: block"]');
        return !!(sa && ov && sa.style.display!=='none');
      });
      if(!isSweetAlertVisible) return;

      await page.evaluate(()=>{
        const sels = [
          '.sweet-alert.showSweetAlert.visible button.confirm',
          '.sweet-alert.visible button.confirm',
          'button.confirm'
        ];
        for(const sel of sels){
          const b=document.querySelector(sel);
          if(b){ b.click(); break; }
        }
      });

      await page.waitForFunction(()=>{
        const sa= document.querySelector('.sweet-alert.showSweetAlert.visible');
        const ov= document.querySelector('.sweet-overlay[style*="display: block"]');
        if(sa && sa.style.display!=='none') return false;
        if(ov && ov.style.display!=='none') return false;
        return true;
      },{ timeout:5000 });

      log(`[INFO] SweetAlert cerrado (intento ${attempt}).`);
      return;
    } catch(err){
      const w=`[WARN] Error intentando cerrar SweetAlert => ${err.message}, reintento ${attempt}/3`;
      log(w);
      writeErrorLog(errorLogPath, w);
      await delay(2000);
    }
  }
  const e2='[ERROR] No se pudo cerrar SweetAlert tras 3 intentos.';
  writeErrorLog(errorLogPath, e2);
}

async function tryCloseAnyModal(page, log, errorLogPath) {
  await closeSweetAlertIfVisible(page, log, errorLogPath);

  try {
    await page.waitForFunction(()=>{
      const ms=document.querySelectorAll('.modal.in');
      return [...ms].some(m=> (m.style.display||'').includes('block'));
    },{ timeout:3000 });
    log('Se detectó un modal => cerrándolo...');
    await page.evaluate(()=>{
      const ms= document.querySelectorAll('.modal.in');
      ms.forEach(m=>{
        if((m.style.display||'').includes('block')){
          const closeBtn= m.querySelector('button[data-dismiss="modal"]');
          if(closeBtn) closeBtn.click();
        }
      });
    });
    await page.waitForFunction(()=>{
      const ms=document.querySelectorAll('.modal.in');
      return [...ms].every(m=> (m.style.display||'').includes('none'));
    },{ timeout:5000 });
    log('Modal(es) cerrados ok.');
  } catch(err){
    log(`No se cerró modal => ${err.message}`);
  }
}

async function closeAnyActiveModal(page, log, errorLogPath) {
  await closeSweetAlertIfVisible(page, log, errorLogPath);
  for(let attempt=1; attempt<=3; attempt++){
    try {
      await page.waitForFunction(()=>{
        const ms=document.querySelectorAll('.modal.in');
        return [...ms].some(m=> (m.style.display||'').includes('block'));
      },{ timeout:3000 });

      log(`  [INFO] Cerrando modal (attempt ${attempt}).`);
      await page.evaluate(()=>{
        const ms=document.querySelectorAll('.modal.in');
        ms.forEach(m=>{
          if((m.style.display||'').includes('block')){
            const c= m.querySelector('button[data-dismiss="modal"]');
            if(c) c.click();
          }
        });
      });
      await page.waitForFunction(()=>{
        const ms= document.querySelectorAll('.modal.in');
        return [...ms].every(m=> (m.style.display||'').includes('none'));
      },{ timeout:5000 });

      log(`  [INFO] Modal(es) cerrados.`);
      return;
    } catch(err){
      const w2=`[WARN] Error al cerrar modal => ${err.message}, reintento ${attempt}/3`;
      log(`  ${w2}`);
      writeErrorLog(errorLogPath, w2);
      await delay(2000);
    }
  }
  const e2='[ERROR] No se pudo cerrar modal tras 3 intentos.';
  log(e2);
  writeErrorLog(errorLogPath, e2);
}

/****************************************************************************************
 * parseTdCell => "F. Ing.: 11/11/2024" => "F. Ing.,11/11/2024"
 ****************************************************************************************/
function parseTdCell(cellText) {
  const splitted= cellText.split(':');
  if(splitted.length===2){
    const k=splitted[0].trim();
    const v=splitted[1].trim();
    return `${k},${v}`;
  }
  return cellText.replace(/,/g,''); // Elimina comas
}

function isDateDDMMYYYY(str){
  return /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str.trim());
}

/****************************************************************************************
 * checkIfCauseReservedOrExpired => ve si la modal dice que está reservada / expirada
 ****************************************************************************************/
async function checkIfCauseReservedOrExpired(page) {
  const sweetAlertText = await page.evaluate(() => {
    const sa = document.querySelector('.sweet-alert.showSweetAlert.visible p');
    return sa ? sa.innerText.trim() : '';
  });
  if (sweetAlertText) {
    const txtLower = sweetAlertText.toLowerCase();
    if (txtLower.includes('reservada')) {
      return { reserved: true, expired: false };
    }
    if (txtLower.includes('caducado') || txtLower.includes('expirado')) {
      return { reserved: false, expired: true };
    }
  }

  // "La causa se encuentra reservada..."
  const isReserved44 = await page.evaluate(()=>{
    const mo=document.querySelector('.modal.in[style*="display: block"]');
    if(!mo) return false;
    const p= mo.querySelector('div.panel.panel-default h4 p');
    if(!p) return false;
    const txt= p.innerText.replace(/\s+/g,' ').trim().toLowerCase();
    return txt.includes('se encuentra reservada') || txt.includes('acta n° 44-2022');
  });
  if(isReserved44){
    return { reserved:true, expired:false };
  }

  return { reserved:false, expired:false };
}

/****************************************************************************************
 * waitForModalOpened => espera backdrop o .modal.in display:block
 ****************************************************************************************/
async function waitForModalOpened(page, errorLogPath, log, { timeout=10000 }={}) {
  try {
    await page.waitForSelector('.modal-backdrop.in.modal-stack',{ visible:true, timeout:2000 });
    log(`[DEBUG] Apareció backdrop => modal abierto.`);
    return true;
  } catch{}
  try {
    await page.waitForFunction(()=>{
      const mo= document.querySelector('.modal.in[style*="display: block"]');
      return !!mo;
    },{ timeout });
    log(`[DEBUG] Apareció un .modal.in[display:block].`);
    return true;
  } catch(err){
    log(`[WARN] No se detectó backdrop ni modal => ${err.message}`);
    return false;
  }
}

/****************************************************************************************
 * descargarEbook => descarga directa sin abrir nueva pestaña
 ****************************************************************************************/
async function descargarEbook(page, log, errorLogPath, folderPath, safeRit, safeCarat) {
  try {
    // 1) Extraer info del form
    const formData = await page.evaluate(() => {
      // 1) Localizar el contenedor .modal.in => es el modal activo en pantalla
      const openModal = document.querySelector('.modal.in');
      if (!openModal) return null;  // No hay modal abierto
    
      // 2) Dentro de ese modal, buscar #contenedorEbook form
      const form = openModal.querySelector('#contenedorEbook form');
      if (!form) return null;
    
      const action = form.getAttribute('action') || '';
      const method = (form.getAttribute('method') || 'GET').toUpperCase();
    
      // Tomar inputs
      const inputs = [...form.querySelectorAll('input, select, textarea')];
      const data = {};
      inputs.forEach(inp => {
        if (inp.name) data[inp.name] = inp.value || '';
      });
    
      return { action, method, data };
    });

    if (!formData) {
      log(`[INFO] No se encontró form en #contenedorEbook => No E-Book.`);
      return;
    }
    if (!formData.action) {
      log(`[INFO] El form no tiene un action => imposible descargar E-Book.`);
      return;
    }

    // 2) Convertir "action" en URL absoluta si está en relativa
    let fullAction = formData.action; // p.e. "ADIR_871/suprema/documentos/newebooksuprema.php"
    if (!/^https?:\/\//i.test(fullAction)) {
      // Convirtiendo acción relativa a absoluta usando la URL actual de la página
      fullAction = new URL(fullAction, page.url()).href;
    }

    // 3) Armar querystring o body
    const method = formData.method;
    const data   = formData.data;

    let body = null;
    let urlFinal = fullAction;
    if (method === 'POST') {
      // Construimos body x-www-form-urlencoded
      const params = new URLSearchParams();
      for (const key in data) {
        params.append(key, data[key]);
      }
      body = params.toString();
    } else {
      // GET => construimos querystring
      const params = new URLSearchParams();
      for (const key in data) {
        params.append(key, data[key]);
      }
      const queryString = params.toString();
      if (queryString) {
        urlFinal += (urlFinal.includes('?') ? '&' : '?') + queryString;
      }
    }

    log(`\n[DEBUG] E-Book => ${method} ${urlFinal}`);

    // 4) Preparar cabeceras con cookies
    const cookies = await page.cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const userAgent = await page.evaluate(() => navigator.userAgent);

    // 5) fetch
    const res = await fetch(urlFinal, {
      method,
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': userAgent,
        'Referer': page.url(),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: method === 'POST' ? body : null
    });

    if (!res.ok) {
      const w = `[WARN] E-Book => status HTTP ${res.status}`;
      log(`  ${w}`);
      writeErrorLog(errorLogPath, w);
      return;
    }

    // 6) Descargar y guardar
    const buf = await res.arrayBuffer();
    const fileName  = `Ebook -- ${safeRit} -- ${safeCarat}.pdf`;
    const ebookPath = path.join(folderPath, fileName);
    fs.writeFileSync(ebookPath, Buffer.from(buf));
    log(`  [INFO] E-Book guardado => ${ebookPath}`);

  } catch (err) {
    log(`[WARN] Error en descargarEbook => ${err.message}`);
  }
}

/****************************************************************************************
 * CSV principal => maneja 4..7 columnas
 ****************************************************************************************/
function appendResultsToCSV(filePath, rows, competencia, corteOTribunal) {
  if(!fs.existsSync(filePath)){
    fs.writeFileSync(
      filePath,
      'Competencia,Seleccionado,RIT,RUC,Tribunal,Caratulado,Fecha Ingreso,Estado Causa,Fecha Ubic,Ubicacion\n',
      'utf8'
    );
  }
  let lines='';
  for(const row of rows){
    let RIT='',RUC='',Trib='',Carat='',FIng='',Est='',fUbic='',ubic='';
    if(row.length===4){
      [RIT, FIng, Carat, Trib]= row;
    } else if(row.length===5){
      [RIT, Trib, Carat, FIng, Est]= row;
    } else if(row.length===6){
      [RIT, RUC, Trib, Carat, FIng, Est]= row;
    } else if(row.length===7){
      [RIT, Trib, Carat, FIng, Est, fUbic, ubic]= row;
    } else {
      console.warn(`[WARN] Row longitud inesperada => ${JSON.stringify(row)}`);
      continue;
    }
    const line = [
      competencia,
      corteOTribunal,
      RIT || '',
      RUC || '',
      Trib||'',
      Carat||'',
      FIng||'',
      Est||'',
      fUbic||'',
      ubic||''
    ].join(',');
    lines+= line+'\n';
  }
  fs.appendFileSync(filePath, lines, 'utf8');
}

/****************************************************************************************
 * CSV por causa => normal y formateado
 ****************************************************************************************/
function saveCauseCsv(filePath, infoModalLines, litigantesData) {
  const linesLit = litigantesData.map(r=>r.join(',')).join('\n');
  const finalText= infoModalLines.join('\n') + '\n\nLitigantes:\n'+ linesLit;
  fs.writeFileSync(filePath, finalText, 'utf8');
}

function saveFormateadoCsv(filePathForm, carat, tribunal, fIng, etapa, estAdm, estProc, litForm){
  const lines=[];
  lines.push(`${carat}`);
  lines.push(`Tribunales,${tribunal}`);
  lines.push(`Fecha de Ingreso,${fIng}`);
  litForm.forEach(l=> lines.push(l));
  lines.push(`Materia,`);
  lines.push(`Hitos Relevantes del Proceso,`);
  lines.push(`Etapa,${etapa}`);
  lines.push(`Estado Adm.,${estAdm}`);
  lines.push(`Estado Proc.,${estProc}`);
  const final= lines.join('\n');
  fs.writeFileSync(filePathForm, final,'utf8');

  // Crear la versión "VISUAL X" con ';'
  const dirName= path.dirname(filePathForm);
  const baseName= path.basename(filePathForm);
  const visualName= 'VISUAL '+ baseName;
  const filePathVisual= path.join(dirName, visualName);

  // Reemplazar comas por ;
  const visualContent= final.replace(/,/g,';');
  fs.writeFileSync(filePathVisual, visualContent,'utf8');
}

/****************************************************************************************
 * procesoCausa => principal (abre modal, descarga e-book, extrae litigantes, CSV formateado)
 ****************************************************************************************/
async function procesoCausa(page, causa, basePath, errorLogPath, log, refreshLinksIfNeeded) {
  log(`\n\n\n\n  >> procesoCausa(): RIT=${causa.rit}, Caratulado=${causa.caratulado}`);

  const safeRit = safeFileName(causa.rit);
  const safeCarat= safeFileName(causa.caratulado);
  const causeFolderPath= path.join(basePath, `${safeRit} -- ${safeCarat}`);
  if(!fs.existsSync(causeFolderPath)){
    fs.mkdirSync(causeFolderPath, { recursive:true });
  }

  if(!causa.onclick){
    const w=`[WARN] No se encontró "onclick" => RIT=${causa.rit}`;
    log(`    ${w}`);
    writeErrorLog(errorLogPath, w);
    return;
  }

  // Detectar "tipo" => suprema, apel, penal, etc. (opcional)
  // Te puedes basar en causa.tribunal o en RIT
  let isSuprema= false, isApel= false, isPenal= false;
  const lowTrib = (causa.tribunal||'').toLowerCase();
  if(lowTrib.includes('corte suprema')) isSuprema=true;
  else if(lowTrib.includes('c.a.') || lowTrib.includes('apelac')) isApel=true;
  else if(lowTrib.includes('juzgado de garantía') || lowTrib.includes('penal')) isPenal=true;
  // O detecta con "compValue" si lo guardaste en algún lado...

  // Reintentos modal
  let opened=false; let attempts=0;
  while(!opened){
    attempts++;
    log(`    [DEBUG] Intento #${attempts} para abrir modal => ${causa.rit}`);
    try {
      await page.evaluate(jsStr=>eval(jsStr), causa.onclick);
    } catch(err){
      const w2=`[WARN] Error onclick => ${err.message}`;
      log(`    ${w2}`);
      writeErrorLog(errorLogPath, w2);
    }

    const ok= await waitForModalOpened(page, errorLogPath, log, { timeout:15000 });
    if(ok){
      const { reserved, expired }= await checkIfCauseReservedOrExpired(page);
      if(expired){
        log(`    [INFO] Causa expirada => refrescar...`);
        await tryCloseAnyModal(page, log, errorLogPath);
        if(refreshLinksIfNeeded) await refreshLinksIfNeeded();
        continue;
      }
      opened=true;
      log(`    [INFO] Modal abierto (attempt ${attempts}).`);
    } else {
      if(attempts<3){
        log(`    [WARN] Falló abrir modal => Reintentar en 15s...`);
        await delay(15000);
      } else {
        log(`[ALERTA] 3 reintentos fallidos => user confirm...`);
        await waitUserConfirmation('Pulse Enter para reintentar, Ctrl+C para abort...');
        attempts=0;
      }
    }
  }
  await randomDelay(4000,9000);

  // Screenshot modal
  const scModalPath= path.join(causeFolderPath, 'modal.png');
  await page.screenshot({ path: scModalPath });
  log(`    Captura modal => ${scModalPath}`);

  // Revisar reservada
  const { reserved }= await checkIfCauseReservedOrExpired(page);
  if(reserved){
    log(`    [INFO] Causa reservada => no se extrae info ni e-book.`);
    await closeAnyActiveModal(page, log, errorLogPath);
    return;
  }

  // Extraer tabla => variables
  let infoModalLines=[];
  let litigantesData=[];

  let fechaIng='', etapa='', estAdm='', estProc='';
  let supremaCarat='', supremaFecha='', supremaEstadoProc='';
  let apelaCorte='', apelaFecha='', apelaEstadoRecur='', apelaEstadoProc='';
  let penalFechaIng='', penalEstado='', penalTrib='';

  // Table principal
  try {
    const table1= await page.evaluate(()=>{
      const mo= document.querySelector('.modal.in[style*="display: block"]');
      if(!mo) return null;
      const tab= mo.querySelector('table.table-titulos');
      if(!tab) return null;
      return [...tab.querySelectorAll('td')].map(td=> td.innerText.trim());
    });
    if(table1){
      // Guardo en infoModalLines
      table1.forEach(td=>{
        infoModalLines.push( parseTdCell(td) );
      });

      // Dependiendo de suprema, penal, etc. parseamos
      if(isSuprema){
        // Ejemplo "Libro :Civil / 51659 - 2024" => "Fecha :07/10/2024" => "Estado Procesal:Fallada"
        // Caratulado => "CAT ADMINISTRADORA..." 
        // Buscamos:
        table1.forEach(txt=>{
          if(txt.startsWith('Caratulado:')){
            supremaCarat= txt.replace('Caratulado:','').trim();
          }
          if(txt.startsWith('Fecha :')){
            supremaFecha= txt.replace('Fecha :','').trim();
          }
          if(txt.startsWith('Estado Procesal:')){
            supremaEstadoProc= txt.replace('Estado Procesal:','').trim();
          }
        });

      } else if(isApel){
        // Apel => "Libro :Civil - 473 - 2024", "Fecha :10/12/2024", "Estado Recurso:Vigente"
        // "Estado Procesal:Devuelto al Tribunal", "Corte: C.A. de Arica"
        // Caratulado lo sacamos de la tabla de result => c4.arr[3], ya lo tenemos en causa.caratulado.
        table1.forEach(txt=>{
          if(txt.startsWith('Fecha :')){
            apelaFecha= txt.replace('Fecha :','').trim();
          }
          if(txt.startsWith('Estado Recurso:')){
            apelaEstadoRecur= txt.replace('Estado Recurso:','').trim();
          }
          if(txt.startsWith('Estado Procesal:')){
            apelaEstadoProc= txt.replace('Estado Procesal:','').trim();
          }
          if(txt.startsWith('Corte:')){
            apelaCorte= txt.replace('Corte:','').trim();
          }
        });

      } else if(isPenal){
        // Ej: "RIT :Exhorto-1528-2024", "RUC :...", "Fecha Ingreso:21/10/2024", "Estado Actual:Concluida."
        // "Etapa:Inicio de la acción.", "Caratulado:MP C/ CRISTOPHER..."
        // "Tribunal:Juzgado de Garantía de Curicó"
        table1.forEach(txt=>{
          if(txt.startsWith('Fecha Ingreso:')){
            penalFechaIng= txt.replace('Fecha Ingreso:','').trim();
          }
          if(txt.startsWith('Estado Actual:')){
            penalEstado= txt.replace('Estado Actual:','').trim();
          }
          if(txt.startsWith('Tribunal:')){
            penalTrib= txt.replace('Tribunal:','').trim();
          }
        });

      } else {
        // Civil, Laboral: ya teníamos la heurística original => Ej. F. Ing.:XX, Etapa:XX, Estado Proc.:XX, etc.
        // No cambiamos nada
        table1.forEach(txt=>{
          if(txt.startsWith('F. Ing.:')){
            fechaIng= txt.split(':')[1].trim();
          } else if(isDateDDMMYYYY(txt) && !fechaIng){
            fechaIng= txt.trim();
          }
        });
      }
    } else {
      const w3=`[WARN] No se encontró table.table-titulos => RIT=${causa.rit}`;
      log(`    ${w3}`);
      infoModalLines.push('No Data Found in table');
    }
  } catch(err){
    const warnMsg=`[WARN] Error extrayendo tabla principal => ${err.message}`;
    log(`    ${warnMsg}`);
    // ...
  }

  // Litigantes
  try {
    // Detect penal
    const tribunalLower= (causa.tribunal||'').toLowerCase();
    let isPenal=false;
    if(tribunalLower.includes('garantía') || tribunalLower.includes('penal')){
      isPenal=true;
    }

      // Lógica normal => a[href^="#litigantes"]
      const linkLitig= await page.evaluate(()=>{
        const mo= document.querySelector('.modal.in[style*="display: block"]');
        if(!mo) return null;
        const a= mo.querySelector('a[href^="#litigantes"]');
        return a? a.getAttribute('href'):null;
      });

      await page.evaluate(sel=>{
        const mo= document.querySelector('.modal.in[style*="display: block"]');
        if(!mo) return;
        const link= mo.querySelector(`a[href="${sel}"]`);
        if(link){
          link.scrollIntoView({ block:'center' });
          link.click();
        }
      }, linkLitig);
      await delay(1000);
    
    if(isPenal){
      if(linkLitig){
        const penLitSel='#litigantesPen table.table-bordered';
        const penLitExists= await page.evaluate(sel=> !!document.querySelector(sel), penLitSel);
        if(penLitExists){
          await page.waitForSelector(penLitSel,{ visible:true, timeout:10000 });
          const scLitPen= path.join(causeFolderPath, `Litigantes PENAL - ${safeRit} -- ${safeCarat}.png`);
          await page.screenshot({ path: scLitPen });
          log(`    Captura litigantes penal => ${scLitPen}`);
  
          litigantesData= await page.evaluate(sel=>{
            const tb=document.querySelector(sel);
            if(!tb) return [];
            const out=[];
            const trs= tb.querySelectorAll('tbody tr');
            trs.forEach(tr=>{
              const tds= tr.querySelectorAll('td');
              if(tds.length>=2){
                let tipo= tds[0].innerText.trim();
                let nombre= tds[1].innerText.trim();
                let situ= (tds[2] && tds[2].innerText.trim()) || '';
                if(situ){
                  nombre+= ` (${situ})`;
                }
                out.push([tipo, nombre]); 
              }
            });
            return out;
          }, penLitSel);
          log(`    Se extrajeron ${litigantesData.length} litigantes penales.`);
        } else {
          log(`    [INFO] No se encontró #litigantesPen => sin litigantes penal.`);
        }
      } else {
        log(`    [INFO] No se encontró tab "litigantes".`);
      }
    } else {
      if(linkLitig){
        const tableSel= `${linkLitig} table.table-bordered`;
        await page.waitForSelector(tableSel,{ visible:true, timeout:10000 });

        const scLitig= path.join(causeFolderPath, `Litigantes - ${safeRit} -- ${safeCarat}.png`);
        await page.screenshot({ path: scLitig });
        log(`    Captura litigantes => ${scLitig}`);

        litigantesData= await page.evaluate(sel=>{
          const tb= document.querySelector(sel);
          if(!tb) return [];
          const out=[];
          const trs= tb.querySelectorAll('tbody tr');
          trs.forEach(tr=>{
            const tds= tr.querySelectorAll('td');
            const arr=[...tds].map(td=> td.innerText.trim());
            out.push(arr);
          });
          return out;
        }, tableSel);
        log(`    Se extrajeron ${litigantesData.length} filas => litigantes`);
      } else {
        log(`    [INFO] No se encontró tab "litigantes".`);
      }
    }
  } catch(err){
    const warnMsg=`[WARN] Error extrayendo litigantes => ${err.message}`;
    log(`    ${warnMsg}`);
    writeErrorLog(errorLogPath, warnMsg);
  }

  // E-Book
  await descargarEbook(page, log, errorLogPath, causeFolderPath, safeRit, safeCarat);

  // Cerrar modal
  await closeAnyActiveModal(page, log, errorLogPath);

  // CSV normal
  const causeCsvPath= path.join(causeFolderPath, `${safeRit} -- ${safeCarat}.csv`);
  saveCauseCsv(causeCsvPath, infoModalLines, litigantesData);
  log(`    CSV => ${causeCsvPath}`);

  // CSV formateado

  // Por defecto => Civil/laboral
  let finalCarat = causa.caratulado;
  let finalTrib  = causa.tribunal || 'No se pudo extraer el dato';
  let finalFIng  = causa.fecha    || 'No se pudo extraer el dato';
  let finalEtapa = etapa || '-';
  let finalAdm   = estAdm || '-';
  let finalProc  = estProc || '-';

  if(isSuprema){
    // "Caratulado:" => supremaCarat
    if(supremaCarat) finalCarat = supremaCarat;
    finalTrib = 'Corte Suprema';
    finalFIng = supremaFecha || '';
    finalEtapa= '-';
    finalAdm  = '-';
    finalProc = supremaEstadoProc || '';

  } else if(isApel){
    // Corte Apel => carat de la "fila" => ya lo tenemos en causa.caratulado
    finalCarat= causa.caratulado;
    finalTrib= apelaCorte || 'C.A. de ???';
    finalFIng= apelaFecha || '';
    finalEtapa= apelaEstadoRecur || ''; // "Estado Recurso"
    finalAdm= '-';
    finalProc= apelaEstadoProc || '';

  } else if(isPenal){
    // penalTrib, penalFechaIng, penalEstado
    // Penal => carat => (arr?)
    finalCarat= causa.caratulado;
    finalTrib= penalTrib || '';
    finalFIng= penalFechaIng || '';
    finalAdm= '-';
    finalProc= penalEstado || '-';
    finalEtapa= ''; // "Inicio de la acción"? si quieres
  }

  // Litigantes formateado
  const litigantesForm=[];
  if(isPenal){
    // Se asume => [tipo, "Nombre (Libre)"]
    for(const row of litigantesData){
      if(row.length===2){
        litigantesForm.push(`${row[0]},${row[1]}`);
      }
    }
  } else {
    // 4 col => [Suj, Rut, Persona, Nombre]
    // 6 col => ...
    for(const row of litigantesData){
      if(row.length===4){
        const [suj, r, pers, nom]= row;
        litigantesForm.push(`Sujeto,${suj}`);
        litigantesForm.push(`Rut,${r}`);
        litigantesForm.push(`Persona,${pers}`);
        litigantesForm.push(`Nombre,${nom}`);
        litigantesForm.push('');
      } else if(row.length===6){
        const [, , sujeto, rutLit, persona, nombre] = row;
        litigantesForm.push(`Sujeto,${sujeto}`);
        litigantesForm.push(`Rut,${rutLit}`);
        litigantesForm.push(`Persona,${persona}`);
        litigantesForm.push(`Nombre,${nombre}`);
        litigantesForm.push('');
      }
    }
  }

  const formCsvPath= path.join(causeFolderPath, `${safeRit} -- ${safeCarat} FORMATEADO.csv`);
  saveFormateadoCsv(
    formCsvPath,
    finalCarat,
    finalTrib,
    finalFIng,
    finalEtapa||'',
    finalAdm||'',
    finalProc||'',
    litigantesForm
  );
  log(`    CSV FORMATEADO => ${formCsvPath}`);

  log(`    [INFO] ProcesoCausa finalizado => RIT=${causa.rit}`);
}

/****************************************************************************************
 * Paginación => Modo 1
 ****************************************************************************************/
async function paginarResultados(page, log, errorLogPath, competenciaLabel, seleccionLabel, refreshLinksIfNeeded){
  let allRows=[];
  let keepGoing=true;
  let currentPage=1;
  let totalRecords=0;
  let lastRefreshTime=Date.now();

  while(keepGoing){
    try {
      await page.waitForFunction(()=>{
        const l= document.querySelector('#loadPreJuridica');
        return l && l.innerHTML.trim()==='';
      },{ timeout:30000 });
    } catch(err){
      log(`[WARN] #loadPreJuridica => ${err.message}`);
    }

    try {
      await page.waitForSelector('.imgLoad',{ visible:true, timeout:5000 });
      await page.waitForFunction(()=>{
        const loader= document.querySelector('.imgLoad');
        if(!loader) return true;
        return !loader.innerText.includes('Cargando');
      },{ timeout:30000 });
    } catch(err){
      log(`[INFO] Loader .imgLoad no apareció => ${err.message}`);
    }

    try {
      const rawTotal= await page.evaluate(()=>{
        const d= document.querySelector('.loadTotalJur b');
        if(!d) return 0;
        const tx= d.textContent.trim().replace(/\D+/g,'');
        return parseInt(tx,10)||0;
      });
      if(rawTotal>0) totalRecords= rawTotal;
    } catch(err){
      log(`[WARN] No se pudo leer totalRecords => ${err.message}`);
    }

    let pageData=[];
    try {
      pageData= await page.evaluate(()=>{
        const out=[];
        const trs= document.querySelectorAll('#verDetalleJuridica tr');
        trs.forEach(tr=>{
          const tds= tr.querySelectorAll('td');
          if(tds.length>=2 && !tr.querySelector('nav') && !tr.querySelector('.pagination')){
            const rowArr=[...tds].slice(1).map(td=>td.textContent.trim());
            out.push(rowArr);
          }
        });
        return out;
      });
    } catch(err){
      log(`[WARN] Error extrayendo filas => ${err.message}`);
    }

    const pageCount= pageData.length;
    allRows= allRows.concat(pageData);
    log(`    [INFO] Página ${currentPage}: ${pageCount} filas. (Acumulado=${allRows.length}, TotalRecords=${totalRecords||'??'})`);

    if(pageCount===0 && allRows.length===0){
      keepGoing=false; break;
    }
    if(totalRecords && allRows.length>=totalRecords){
      log(`    [INFO] Alcanzado totalRecords (${totalRecords}). Stop paginado.`);
      keepGoing=false; break;
    }

    const nextPageInfo= await page.evaluate(()=>{
      const liActive= document.querySelector('ul.pagination li.page-item.active');
      if(!liActive) return null;
      const nxt= liActive.nextElementSibling;
      if(!nxt) return null;
      const sp= nxt.querySelector('span.page-link[onclick^="paginaJur("]');
      return sp? sp.getAttribute('onclick'):null;
    });
    if(!nextPageInfo){
      keepGoing=false;
      break;
    }

    const now= Date.now();
    if((now-lastRefreshTime)>= 4*60*1000){
      log(`[INFO] >=4 min => refrescando...`);
      if(refreshLinksIfNeeded) await refreshLinksIfNeeded();
      lastRefreshTime= now;
    }

    try {
      await page.evaluate(fnStr=>eval(fnStr), nextPageInfo);
      currentPage++;
      await randomDelay(2000,5000);
    } catch(err){
      log(`[ERROR] Falló paginación => ${err.message}`);
      keepGoing=false;
    }
  }
  return allRows;
}

/****************************************************************************************
 * buscarYProcesar => Modo 1 => hace clic en "Buscar", pagina, etc.
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
  screenshotsSinResultadosPath,
  refreshLinksIfNeeded
){
  execLog(`>>> buscarYProcesar() => competencia="${competenciaLabel}", seleccionado="${seleccionLabel}"`);

  let attempts=0;
  while(true){
    attempts++;
    try {
      await page.waitForSelector('#btnConConsultaJur');
      await page.evaluate(()=>document.querySelector('#btnConConsultaJur')?.scrollIntoView());
      await delay(500);

      await page.click('#btnConConsultaJur');
      execLog(`Hizo clic en "Buscar" => ${competenciaLabel} - ${seleccionLabel}`);

      try {
        await page.waitForFunction(()=>{
          const l= document.querySelector('#loadPreJuridica');
          return l && l.innerHTML.trim()==='';
        },{ timeout:3000 });
      } catch{}

      await page.waitForFunction(()=>{
        const l= document.querySelector('#loadPreJuridica');
        return l && l.innerHTML.trim()==='';
      },{ timeout:30000 });
      execLog(`Loader finalizado => ${competenciaLabel} - ${seleccionLabel}`);

      // Screenshot
      const hasNoResults= await page.evaluate(()=>{
        const d=document.querySelector('#resultConsultaJuridica');
        if(!d) return true;
        return d.innerText.includes('No se han encontrado resultados');
      });

      let screenshotDir= hasNoResults? screenshotsSinResultadosPath: screenshotsConCausasPath;
      if(!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir,{ recursive:true });
      const scPath= path.join(screenshotDir, screenshotName);
      await page.screenshot({ path: scPath });
      execLog(`Captura => "${scPath}"`);

      if(hasNoResults){
        execLog(`Sin resultados => ${competenciaLabel} - ${seleccionLabel}`);
        writeLog(logPath, `[${new Date().toISOString()}] ${competenciaLabel}, ${seleccionLabel} => SIN RESULTADOS`);
        return { noResults:true, data:[] };
      }

      const allRows= await paginarResultados(page, execLog, logPath, competenciaLabel, seleccionLabel, refreshLinksIfNeeded);
      const total= allRows.length;
      if(total===0){
        execLog(`Sin resultados (paginados) => ${competenciaLabel} - ${seleccionLabel}`);
        writeLog(logPath, `[${new Date().toISOString()}] ${competenciaLabel}, ${seleccionLabel} => 0`);
        return { noResults:true, data:[] };
      }

      execLog(`Se encontraron ${total} resultados => ${competenciaLabel} - ${seleccionLabel}`);
      writeLog(logPath, `[${new Date().toISOString()}] ${competenciaLabel}, ${seleccionLabel} => ${total} resultados`);

      if(csvPath!=='NO_APLICA.csv'){
        appendResultsToCSV(csvPath, allRows, competenciaLabel, seleccionLabel);
      }
      return { noResults:false, data: allRows };

    } catch(err){
      if(attempts<3){
        execLog(`[WARN] Error en "Buscar" => Reintentar en 15s => ${err.message}`);
        await delay(15000);
      } else {
        execLog(`[ALERTA] 3 reintentos fallidos => Esperando confirm user...`);
        await waitUserConfirmation();
        attempts=0;
      }
    }
  }
}

/****************************************************************************************
 * modo1 => pjud "original"
 ****************************************************************************************/
async function modo1() {
  // Preguntamos
  const ansProc = await askQuestion(`¿Desea procesar causas? (1=Sí, 0=No): `);
  const doProcess = (ansProc.trim() === '1');

  const ansComp = await askQuestion(`¿Qué competencia? 0=Todas, 1=C.Suprema, 2=Apel, 3=Civil, 4=Laboral, 5=Penal, 6=Cobranza => `);

  // Logs
  const logPath = path.join(destino, 'consulta_log.txt');
  const errorLogPath = path.join(destino, 'errorLog.txt');
  const execLogPath = path.join(destino, 'exec_log.txt');
  fs.writeFileSync(execLogPath, '', 'utf8');
  const log = makeLogger(execLogPath);

  // Directorios
  const basePath = path.join(destino, 'Detalles Causas Encontradas');
  if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });

  const screenshotsCon = path.join(destino, 'Screenshots Búsquedas con Causas');
  if (!fs.existsSync(screenshotsCon)) fs.mkdirSync(screenshotsCon, { recursive: true });

  const screenshotsSin = path.join(destino, 'Screenshots Búsquedas sin Resultados');
  if (!fs.existsSync(screenshotsSin)) fs.mkdirSync(screenshotsSin, { recursive: true });

  const mainCsvPath = path.join(destino, 'Listado de Causas Encontradas.csv');
  if (!fs.existsSync(mainCsvPath)) {
    fs.writeFileSync(
      mainCsvPath,
      'Competencia,Seleccionado,RIT,RUC,Tribunal,Caratulado,Fecha Ingreso,Estado Causa,Fecha Ubic,Ubicacion\n',
      'utf8'
    );
  }

  let browser, page;
  try {
    browser = await puppeteer.launch({
      headless: true, // o false, según tus necesidades de depuración
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        // Opcionalmente puedes probar algunas banderas extra si deseas
        // '--disable-web-security',
        // '--allow-insecure-localhost',
        // '--allow-file-access-from-files',
      ]
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    log('Entrando sitio pjud.cl');

    await page.goto('https://oficinajudicialvirtual.pjud.cl/home/index.php', { waitUntil: 'domcontentloaded' });
    await tryCloseAnyModal(page, log, errorLogPath);

    // "Consulta causas"
    await delay(5000);
    await page.waitForSelector('button.dropbtn[onclick="accesoConsultaCausas();"]');
    await page.click('button.dropbtn[onclick="accesoConsultaCausas();"]');
    log('Clic en "Consulta causas"');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' });

    // "Búsqueda por Rut Persona Jurídica"
    await page.waitForSelector('a[href="#BusJuridica"]');
    await page.click('a[href="#BusJuridica"]');
    log('Clic en "Búsqueda por Rut Persona Jurídica"');

    // RUT, DV, YEAR
    log('DEBUG: Esperando input #rutJur');
    await page.waitForSelector('#rutJur', { visible: true });
    log('DEBUG: Escribiendo RUT, DV, Año');
    await page.click('#rutJur');
    await page.keyboard.type(rut, { delay: 50 });
    await page.type('#dvJur', dv);
    await page.type('#eraJur', year);

    await page.evaluate(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    });

    // Pequeña función para refrescar
    async function refreshLinksIfNeeded() {
      log('[REFRESH] Re-clic en "Buscar"...');
      await page.waitForSelector('#btnConConsultaJur');
      await page.click('#btnConConsultaJur');
      try {
        await page.waitForFunction(() => {
          const l = document.querySelector('#loadPreJuridica');
          return l && l.innerHTML.trim() === '';
        }, { timeout: 30000 });
      } catch {}
    }

    // Listado principal de competencias
    const competencias = [
      { value: '1', label: 'Corte Suprema',      seleccion: 'Suprema',               screenshot: 'Suprema.png' },
      { value: '2', label: 'Corte Apelaciones',  seleccion: 'C.A. de Santiago',       screenshot: 'CorteApel.png' },
      { value: '3', label: 'Civil',              seleccion: 'Civil',                 screenshot: 'Civil.png' },
      { value: '4', label: 'Laboral',            seleccion: 'Laboral',               screenshot: 'Laboral.png' },
      { value: '5', label: 'Penal',              seleccion: 'Penal',                 screenshot: 'Penal.png' },
      { value: '6', label: 'Cobranza',           seleccion: 'Cobranza',              screenshot: 'Cobranza.png' },
    ];

    let compsAProcesar = competencias;
    if (ansComp.trim() !== '0') {
      const found = competencias.find(c => c.value === ansComp.trim());
      if (found) compsAProcesar = [ found ];
    }

    // -------------------------------------------
    // Función para extraer las causas y procesarlas
    // -------------------------------------------
    async function extractAndProcessCausas(page, compValue) {
      // 1) Extraer filas de #verDetalleJuridica
      const causas = await page.evaluate(() => {
        const out = [];
        const rows = document.querySelectorAll('#verDetalleJuridica tr');
        rows.forEach(tr => {
          const tds = tr.querySelectorAll('td');
          if (tds.length >= 2 && !tr.querySelector('nav') && !tr.querySelector('.pagination')) {
            const link = tds[0].querySelector('a');
            const onclick = link ? link.getAttribute('onclick') : null;
            const arr = [...tds].slice(1).map(td => td.textContent.trim());
            out.push({ onclick, arr });
          }
        });
        return out;
      });

      // 2) Recorrer cada causa y llamar a procesoCausa
      for (const found of causas) {
        let RIT = '', RUC = '', Tribunal = '', Carat = '', Fecha = '', Estado = '';

        // Parseo según la competencia:
        if (compValue === '1') {
          // Corte Suprema
          // Ej: [Rol, (Tipo Recurso?), Carat, Fecha, Estado, 'Corte Suprema']
          if (found.arr.length >= 6) {
            [RIT, RUC, Carat, Fecha, Estado, Tribunal] = found.arr;
          } else {
            [RIT, Carat, Fecha, Estado] = found.arr;
            Tribunal = 'Corte Suprema';
          }
        } else if (compValue === '2') {
          // Corte Apelaciones
          // Ej: [Rol, Corte, Carat, FechaIng, Estado, ...]
          if (found.arr.length === 7) {
            [RIT, Tribunal, Carat, Fecha, Estado] = found.arr; // Adaptar si tienes 7 col
          } else if (found.arr.length === 6) {
            [RIT, Tribunal, Carat, Fecha, Estado] = found.arr;
          } else {
            [RIT, Carat, Fecha, Tribunal] = found.arr;
          }
        } else if (compValue === '5') {
          // Penal
          // Ej: [RIT, Tribunal, RUC, Carat, Fecha, Estado]
          if (found.arr.length === 6) {
            [RIT, Tribunal, RUC, Carat, Fecha, Estado] = found.arr;
          } else {
            [RIT, Tribunal, Carat, Fecha, Estado] = found.arr;
          }
        } else {
          // Civil, Laboral, Cobranza => '3','4','6'
          if (found.arr.length === 4) {
            [RIT, Fecha, Carat, Tribunal] = found.arr;
          } else if (found.arr.length === 5) {
            [RIT, Tribunal, Carat, Fecha, Estado] = found.arr;
          } else if (found.arr.length === 6) {
            [RIT, RUC, Tribunal, Carat, Fecha, Estado] = found.arr;
          }
        }

        const causaObj = {
          onclick: found.onclick,
          rit: RIT,
          ruc: RUC,
          tribunal: Tribunal,
          caratulado: Carat,
          fecha: Fecha,
          estado: Estado
        };

        log(`Procesando causa => RIT=${causaObj.rit}, Carat=${causaObj.caratulado}`);
        await procesoCausa(page, causaObj, basePath, errorLogPath, log, refreshLinksIfNeeded);

        // Esperamos un randomDelay entre causa y causa
        await randomDelay(5000, 10000);
      }
    }

    // ---------------------
    // Recorremos competencias
    // ---------------------
    for (const comp of compsAProcesar) {
      log(`\n### Procesando Competencia: "${comp.label}" (value=${comp.value}) ###`);
      await page.select('#jurCompetencia', comp.value);
      await delay(1000);

      if (comp.value === '2') {
        // Corte Apelaciones => #corteJur
        await page.waitForSelector('#corteJur');
        await page.evaluate(() => {
          const sel = document.querySelector('#jurCompetencia');
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForFunction(() => {
          const s = document.querySelector('#corteJur');
          return s && s.querySelectorAll('option').length > 1;
        }, { timeout: 10000 });

        const allOpts = await page.$$eval('#corteJur option', arr =>
          arr.map(o => ({ value: o.value, label: o.textContent.trim() }))
        );
        const dynamicOpts = allOpts.filter(o => o.value !== '0');
        log(`Cortes en Apelaciones: ${dynamicOpts.length}`);

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
            screenshotsCon,
            screenshotsSin,
            refreshLinksIfNeeded
          );

          // Sólo procesamos causas si la búsqueda arrojó resultados
          // y el usuario pidió "procesar" (doProcess = true)
          if (!resCorte.noResults && doProcess) {
            await extractAndProcessCausas(page, comp.value);
          }
        }

      } else if (['3', '4', '5', '6'].includes(comp.value)) {
        // Civil, Laboral, Penal, Cobranza => #jurTribunal
        await page.waitForSelector('#jurTribunal', { visible: true });
        await page.evaluate(() => {
          const sel = document.querySelector('#jurCompetencia');
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForFunction(() => {
          const s = document.querySelector('#jurTribunal');
          return s && s.querySelectorAll('option').length > 1;
        }, { timeout: 10000 });

        const allTrib = await page.$$eval('#jurTribunal option', arr =>
          arr.map(o => ({ value: o.value, label: o.textContent.trim() }))
        );
        const dynamicTrib = allTrib.filter(o =>
          o.value !== '' &&
          o.value !== '0' &&
          !o.label.toLowerCase().includes('seleccione tribunal')
        );
        log(`Tribunales en ${comp.label}: ${dynamicTrib.length}`);

        await randomDelay(5000, 10000);

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
            screenshotsCon,
            screenshotsSin,
            refreshLinksIfNeeded
          );

          if (!resTrib.noResults && doProcess) {
            await extractAndProcessCausas(page, comp.value);
          }
        }

      } else {
        // Corte Suprema => no tiene sub-select
        const screenshotName = comp.screenshot;
        const resSup = await buscarYProcesar(
          page,
          comp.label,
          comp.seleccion,
          screenshotName,
          logPath,
          mainCsvPath,
          log,
          screenshotsCon,
          screenshotsSin,
          refreshLinksIfNeeded
        );

        if (!resSup.noResults && doProcess) {
          await extractAndProcessCausas(page, comp.value);
        }
      }
    }

    log('\n>> Todas las consultas finalizadas (modo1). Cerrando navegador.');
    await browser.close();

  } catch (err) {
    console.error(`Error en modo1 => ${err.stack}`);
  }
}

/****************************************************************************************
 * modo2 => lee CSV [competencia, seleccion, rit] => parse => procesar
 ****************************************************************************************/
async function modo2() {
  if(!fs.existsSync(csvOrigen)){
    console.error(`[ERROR] CSV no existe => ${csvOrigen}`);
    return;
  }

  const lines= fs.readFileSync(csvOrigen,'utf8').split('\n').filter(l=>l.trim());
  if(!lines.length){
    console.error(`[ERROR] CSV vacío => ${csvOrigen}`);
    return;
  }

  const header= lines.shift();
  const delim= detectDelimiter(header);
  console.log(`[INFO] Delimitador detectado => ${delim}`);

  const causasLeidas= lines.map(line=>{
    const parts= line.split(delim).map(s=> s.trim());
    // Minimo => comp, sel, rit
    const comp= parts[0]||'';
    const sel = parts[1]||'';
    const rit = parts[2]||'';
    return { comp, sel, rit };
  });

  // Logs
  const logPath= path.join(destino,'consulta_log.txt');
  const errorLogPath= path.join(destino,'errorLog.txt');
  const execLogPath= path.join(destino,'exec_log.txt');
  fs.writeFileSync(execLogPath,'','utf8');
  const log= makeLogger(execLogPath);

  function mapCompetenciaValue(label) {
    const lower= label.toLowerCase();
    if(lower.includes('apel')) return '2';
    if(lower.includes('suprema')) return '1';
    if(lower.includes('civil')) return '3';
    if(lower.includes('laboral')) return '4';
    if(lower.includes('penal')) return '5';
    if(lower.includes('cobranza')) return '6';
    return '';
  }

  async function refreshLinksIfNeeded(){
    log('[REFRESH Modo2] Re-clic en "Buscar"...');
    await page.waitForSelector('#btnConConsultaJur');
    await page.click('#btnConConsultaJur');
    try {
      await page.waitForFunction(()=>{
        const l= document.querySelector('#loadPreJuridica');
        return l && l.innerHTML.trim()==='';
      },{ timeout:30000 });
    } catch{}
  }

  // findCauseByRIT => minimal paginación
  async function findCauseByRIT(page, ritTarget, log){
    let found=null;
    let keepGoing=true;
    let currentPage=1;

    while(keepGoing){
      // Esperar loader
      try {
        await page.waitForFunction(()=>{
          const loader= document.querySelector('#loadPreJuridica');
          return loader && loader.innerHTML.trim()==='';
        },{ timeout:30000 });
      } catch(err){
        log(`[WARN] Loader #loadPreJuridica => ${err.message}`);
      }

      // Esperar .imgLoad
      try {
        await page.waitForSelector('.imgLoad', { visible:true, timeout:5000 });
        await page.waitForFunction(()=>{
          const loaderEl= document.querySelector('.imgLoad');
          if(!loaderEl) return true;
          return !loaderEl.innerText.includes('Cargando');
        },{ timeout:30000 });
      } catch(err){
        log(`[INFO] Loader .imgLoad no apareció => ${err.message}`);
      }

      // Extraer filas
      const causas= await page.evaluate(()=>{
        const out=[];
        const trs= document.querySelectorAll('#verDetalleJuridica tr');
        trs.forEach(tr=>{
          const tds= tr.querySelectorAll('td');
          if(tds.length>=2 && !tr.querySelector('nav') && !tr.querySelector('.pagination')){
            const link= tds[0].querySelector('a');
            const onclick= link? link.getAttribute('onclick'):null;
            const arr=[...tds].slice(1).map(td=>td.textContent.trim());
            out.push({ onclick, arr });
          }
        });
        return out;
      });

      found= causas.find(c=> c.arr[0]=== ritTarget);
      if(found){
        log(`[INFO] RIT="${ritTarget}" encontrado en página ${currentPage}.`);
        return found;
      }

      // Siguiente
      const nextPageInfo= await page.evaluate(()=>{
        const liActive= document.querySelector('ul.pagination li.page-item.active');
        if(!liActive) return null;
        const nxt= liActive.nextElementSibling;
        if(!nxt) return null;
        const sp= nxt.querySelector('span.page-link[onclick^="paginaJur("]');
        return sp? sp.getAttribute('onclick'):null;
      });
      if(!nextPageInfo){
        keepGoing=false;
        break;
      }
      log(`[INFO] No se encontró RIT="${ritTarget}" en página ${currentPage}. Pasando a la siguiente...`);
      currentPage++;

      try {
        await page.evaluate(fnStr=>eval(fnStr), nextPageInfo);
        await delay(2000);
      } catch (err) {
        log(`[ERROR] Falló ejecutar paginación => ${err.message}`);
        keepGoing=false;
      }
    }
    log(`[WARN] No se encontró RIT="${ritTarget}" tras ${currentPage} pág(s).`);
    return null;
  }

  let browser, page;
  try {
    browser= await puppeteer.launch({
      headless:true,
      args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
    });
    page= await browser.newPage();
    await page.setViewport({ width:1920, height:1080 });
    log(`[Modo2] Entrando a oficinajudicialvirtual.pjud.cl`);

    await page.goto('https://oficinajudicialvirtual.pjud.cl/home/index.php',{ waitUntil:'domcontentloaded' });
    await tryCloseAnyModal(page, log, errorLogPath);

    // "Consulta causas"
    await delay(5000);
    await page.waitForSelector('button.dropbtn[onclick="accesoConsultaCausas();"]');
    await page.click('button.dropbtn[onclick="accesoConsultaCausas();"]');
    log('Clic en "Consulta causas"');
    await page.waitForNavigation({ waitUntil:'domcontentloaded' });

    // "Búsqueda por Rut Persona Jurídica"
    await page.waitForSelector('a[href="#BusJuridica"]');
    await page.click('a[href="#BusJuridica"]');
    log('Clic en "Búsqueda por Rut Persona Jurídica"');

    // RUT, DV, YEAR
    await page.waitForSelector('#rutJur',{ visible:true });
    await page.click('#rutJur');
    await page.keyboard.type(rut,{ delay:50 });
    await page.type('#dvJur', dv);
    await page.type('#eraJur', year);

    await page.evaluate(()=>{
      window.scrollTo({ top:0, left:0, behavior:'smooth' });
    });

    let currentComp='', currentSel='';

    for(const fila of causasLeidas){
      log(`\n[Modo2] => Competencia="${fila.comp}", Seleccion="${fila.sel}", RIT="${fila.rit}"`);

      const compValue= mapCompetenciaValue(fila.comp);
      if(!compValue){
        log(`[WARN] Competencia no reconocida => ${fila.comp}`);
        continue;
      }

      // Si cambio de competencia
      if(compValue!== currentComp){
        currentComp= compValue;
        currentSel='';

        // Seleccionar #jurCompetencia
        await page.select('#jurCompetencia', compValue);
        await delay(1000);

        if(compValue==='2'){
          // Apel => #corteJur
          await page.waitForSelector('#corteJur');
          await page.evaluate(()=>{
            document.querySelector('#jurCompetencia').dispatchEvent(new Event('change',{bubbles:true}));
          });
          await page.waitForFunction(()=>{
            const s= document.querySelector('#corteJur');
            return s && s.querySelectorAll('option').length>1;
          },{ timeout:10000 });
          await delay(2000);

        } else if(['3','4','5','6'].includes(compValue)){
          // civil/lab/penal/cobranza => #jurTribunal
          await page.waitForSelector('#jurTribunal',{ visible:true });
          await page.evaluate(()=>{
            document.querySelector('#jurCompetencia').dispatchEvent(new Event('change',{bubbles:true}));
          });
          await page.waitForFunction(()=>{
            const s= document.querySelector('#jurTribunal');
            return s && s.querySelectorAll('option').length>1;
          },{ timeout:10000 });
          await delay(2000);
        }
      }

      // Sub-corte/trib
      if(compValue==='2'){
        if(fila.sel!== currentSel){
          currentSel= fila.sel;
          const all= await page.$$eval('#corteJur option', arr=>
            arr.map(o=>({ val:o.value, txt:o.textContent.trim() }))
          );
          const found= all.find(o=> o.txt.toLowerCase().includes(fila.sel.toLowerCase()));
          if(!found){
            log(`[WARN] No encontré corte => ${fila.sel}`);
            continue;
          }
          await page.select('#corteJur', found.val);
          await delay(2000);
        }

      } else if(['3','4','5','6'].includes(compValue)){
        if(fila.sel!== currentSel){
          currentSel= fila.sel;
          const all2= await page.$$eval('#jurTribunal option', arr=>
            arr.map(o=>({ val:o.value, txt:o.textContent.trim() }))
          );
          const found2= all2.find(o=> o.txt.toLowerCase().includes(fila.sel.toLowerCase()));
          if(!found2){
            log(`[WARN] No encontré tribunal => ${fila.sel}`);
            continue;
          }
          await page.select('#jurTribunal', found2.val);
          await delay(2000);
        }
      } else {
        // suprema => no subselect
        currentSel= fila.sel;
      }

      // "Buscar" con reintentos
      let attemptsBuscar=0; let buscarOk=false;
      while(!buscarOk && attemptsBuscar<3){
        attemptsBuscar++;
        try {
          await page.waitForSelector('#btnConConsultaJur',{ timeout:5000 });
          await page.click('#btnConConsultaJur');

          try {
            await page.waitForFunction(()=>{
              const l=document.querySelector('#loadPreJuridica');
              return l && l.innerHTML.trim()!=='';
            },{ timeout:3000 });
          } catch{}
          await page.waitForFunction(()=>{
            const l= document.querySelector('#loadPreJuridica');
            return l && l.innerHTML.trim()==='';
          },{ timeout:30000 });

          buscarOk=true;
        } catch(err){
          log(`[WARN] Error al "Buscar" => ${err.message}, intento ${attemptsBuscar}/3`);
          await delay(2000);
        }
      }
      if(!buscarOk){
        log(`[ERROR] No se pudo hacer clic en "Buscar" tras 3 intentos => saltamos la causa RIT=${fila.rit}`);
        continue;
      }

      // find RIT
      const found= await findCauseByRIT(page, fila.rit, log);
      if(!found){
        log(`[WARN] No se encontró RIT=${fila.rit} => continuo...`);
        continue;
      }

      // Parse row => Penal => 6 col [RIT, RUC, Tribunal, Carat, Fecha, Estado]
      let RIT='', RUC='', Tribunal='', Carat='', Fecha='', Estado='';
      const arr = found.arr;

      // - Corte Suprema => compValue === '1'
      if (compValue === '1') {
      // Ejemplo de tabla suprema => [Rol, Tipo Recurso, Carat, Fecha, Estado, 'Corte Suprema']
      // O a veces: [51659-2024, (Civil) Casación..., CAT..., 07/10/2024, Fallada, Corte Suprema]
      // Ajusta a tu HTML real
      if (arr.length >= 6) {
          RIT     = arr[0];
          RUC     = arr[1];  // "Tipo Recurso" 
          Carat   = arr[2];
          Fecha   = arr[3];
          Estado  = arr[4];
          Tribunal= arr[5];
      } else {
          // fallback => parse normal
          [RIT, Carat, Fecha, Estado] = arr;
          Tribunal= 'Corte Suprema';
      }

      // - Corte Apelaciones => compValue === '2'
      } else if (compValue === '2') {
      // Ej: [Rol, Corte, Carat, FechaIng, EstadoCausa, FechaUbic, Ubic?] 
      // o según tu "thead"
      // Ajusta a tu HTML real 
      if (arr.length === 7) {
          RIT     = arr[0];  // p.e. Civil-473-2024
          Tribunal= arr[1];  // "C.A. de Arica"
          Carat   = arr[2];
          Fecha   = arr[3];
          Estado  = arr[4];  // "Devuelto al Tribunal"
          // ...
      } else if (arr.length === 6) {
          [RIT, Tribunal, Carat, Fecha, Estado] = arr;
      } else {
          // fallback
          [RIT, Carat, Fecha, Tribunal] = arr;
      }

      // - Penal => compValue === '5'
      } else if (compValue === '5') {
      if (arr.length === 6) {
          //log(found.arr);
            //  'Exhorto-1528-2024',
            //'Juzgado de Garantía de Curicó',
            //'2200158490-5',
            //'MP C/ CRISTOPHER ALEXANDER CUBILLOS URRA',
            //'21/10/2024',
            //'Concluida.'
            RIT      = found.arr[0];
            Tribunal = found.arr[1];
            RUC      = found.arr[2];
            Carat    = found.arr[3];
            Fecha    = found.arr[4];
            Estado   = found.arr[5];
      } else {
          // fallback
          [RIT, Tribunal, Carat, Fecha, Estado] = arr;
      }

      // - Civil, Laboral, Cobranza => compValue in ['3','4','6']
      } else {
      // p.e. [RIT, Fecha, Carat, Tribunal]
      if (arr.length === 4) {
          [RIT, Fecha, Carat, Tribunal] = arr;
      } else if (arr.length === 5) {
          [RIT, Tribunal, Carat, Fecha, Estado] = arr;
      } else if (arr.length === 6) {
          [RIT, RUC, Tribunal, Carat, Fecha, Estado] = arr;
      }
      }

      const causaObj={
        onclick: found.onclick,
        rit: RIT,
        ruc: RUC,
        tribunal: Tribunal,
        caratulado: Carat,
        fecha: Fecha,
        estado: Estado
      };

      // Llamar a procesoCausa
      const basePath= path.join(destino,'Detalles Causas Encontradas');
      if(!fs.existsSync(basePath)) fs.mkdirSync(basePath,{ recursive:true });

      log(`[Modo2] procesando => RIT=${causaObj.rit}`);
      await procesoCausa(page, causaObj, basePath, errorLogPath, log, refreshLinksIfNeeded);
      await randomDelay(3000,5000);
    }

    log('[Modo2] Finalizado. Cerrando navegador.');
    await browser.close();

  } catch(err){
    console.error(`Error en modo2 => ${err.stack}`);
  }
}

/****************************************************************************************
 * Lanzador principal
 ****************************************************************************************/
(async()=>{
  try {
// Solicitar la acción al usuario
const preguntaAction = await askQuestion(`¿Quieres buscar causas (1) o procesar un listado de causas desde un CSV (2)?: `);
const actionInput = preguntaAction.trim();

// Validar la acción y asignar el valor correspondiente
let action;
if(actionInput === '1'){
  action = '1';
} else if(actionInput === '2'){
  action = '2';
  // Solicitar la ruta del archivo CSV al usuario
  csvOrigen = await askQuestion('Por favor, ingresa la ruta del archivo CSV: ');
  
  // Validar que el archivo CSV exista
  if(!fs.existsSync(csvOrigen)){
    console.error(`\n[ERROR] El archivo CSV no existe en la ruta especificada: ${csvOrigen}`);
    process.exit(1); // Terminar el script si el CSV no existe
  }

  // Mostrar la ruta del CSV y pedir confirmación
  console.log(`\nCSV Origen: ${csvOrigen}`);
  const confirmacion = await askQuestion('¿Está correcta la ruta del CSV? (1=Sí, 0=No): ');
  if(confirmacion.trim() !== '1'){
    console.error('\n[INFO] Por favor, vuelve a iniciar el programa e ingresa la ruta correcta del CSV.');
    process.exit(0); // Terminar el script si el usuario no confirma
  }
} else {
  console.error('\n[ERROR] Acción inválida. El script se cerrará.');
  process.exit(1); // Terminar el script si la acción no es 1 ni 2
}

    if(action==='1'){
      await modo1();
    } else {
      await modo2();
    }
  } catch(err){
    console.error('Error en la ejecución:', err);
  }
})();