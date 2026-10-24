/**
 * FORJA · Luis · Apps Script
 *
 * App personal de Luis: finanzas, proyectos, disciplina, gym, comidas y peso.
 * Todo vive en UN libro: "LUIS_Personal". Este script no abre ningún libro
 * de la empresa: no hay aquí ids ni funciones que lo hagan.
 *
 * La clave vive en Propiedades del script (FORJA_CLAVE), nunca en el código.
 */

const ZONA = 'America/Mexico_City';

const HOJAS = {
  Habitos: ['id', 'nombre', 'nota', 'color', 'dias', 'creado', 'activo', 'orden'],
  Marcas: ['id', 'fecha', 'habito_id', 'origen'],
  Ejercicios: ['id', 'nombre', 'dia', 'esquema', 'descanso_s', 'nota', 'orden', 'activo'],
  Sesiones: ['id', 'fecha', 'dia', 'cerrada'],
  Series: ['id', 'sesion_id', 'fecha', 'ejercicio_id', 'n', 'kg', 'reps', 'reps_der', 'seg', 'seg_der', 'origen'],
  Alimentos: ['id', 'nombre', 'porcion', 'proteina', 'activo'],
  Comidas: ['id', 'fecha', 'alimento_id', 'nombre', 'porciones', 'proteina', 'origen'],
  Peso: ['id', 'fecha', 'kg'],
  Config: ['id', 'valor'],
  Archivo: ['id', 'tipo', 'fecha', 'json'],
  Ops: ['id', 'tipo', 'momento', 'resultado']
};
// Hojas que la app puede escribir con put/del. Archivo y Ops solo los toca el script.
const ESCRIBIBLES = ['Habitos', 'Marcas', 'Ejercicios',
  'Sesiones', 'Series', 'Alimentos', 'Comidas', 'Peso', 'Config'];
// Hojas que la app lee.
const LEGIBLES = ESCRIBIBLES;

/* ------------------------------------------------------------------ */
/* Instalación (a mano, una vez, desde el editor)                      */
/* ------------------------------------------------------------------ */

/** Crea LUIS_Personal con todas sus hojas y la clave. Repetirlo no borra nada. */
function instalar() {
  ENTORNO = 'produccion';
  const props = PropertiesService.getScriptProperties();
  let libro = props.getProperty('FORJA_LIBRO_ID') ? SpreadsheetApp.openById(props.getProperty('FORJA_LIBRO_ID')) : null;
  if (!libro) {
    libro = SpreadsheetApp.create('LUIS_Personal');
    props.setProperty('FORJA_LIBRO_ID', libro.getId());
  }
  prepararLibro(libro, todasLasHojas());
  sembrarFinanzas(libro);
  if (!props.getProperty('FORJA_CLAVE')) props.setProperty('FORJA_CLAVE', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('LUIS_Personal: ' + libro.getUrl());
  Logger.log('Clave para la app (cópiala una vez, no la compartas): ' + props.getProperty('FORJA_CLAVE'));
}

/**
 * Copia a LUIS_Personal el historial personal que hoy vive en FORJA_Personal:
 * hábitos, marcas, rutina, sesiones, series, alimentos, comidas, peso y Config.
 * NO copia las tareas diarias de la empresa : se quedan en su app.
 * Solo LEE FORJA_Personal, no lo modifica. Repetirlo no duplica (por id).
 */
function migrarDesdeForja() {
  ENTORNO = 'produccion';
  const origen = buscarLibro('FORJA_Personal');
  if (!origen) throw new Error('No encontré el libro FORJA_Personal en tu Drive');
  const destino = libroPersonal();
  const reporte = {};
  MIGRABLES.forEach(function (n) {
    const h = origen.getSheetByName(n);
    if (!h) { reporte[n] = { origen: 0, nota: 'no existe en el origen' }; return; }
    const todas = filas(h);
    const r = agregarFaltantes(destino.getSheetByName(n), HOJAS[n], todas) || {};
    r.origen = todas.length;
    reporte[n] = r;
  });
  Object.keys(reporte).forEach(function (k) { Logger.log(k + ': ' + JSON.stringify(reporte[k])); });
  return reporte;
}
const MIGRABLES = ['Habitos', 'Marcas', 'Ejercicios', 'Sesiones', 'Series', 'Alimentos', 'Comidas', 'Peso', 'Config'];

function buscarLibro(nombre) {
  const it = DriveApp.getFilesByName(nombre);
  while (it.hasNext()) {
    const f = it.next();
    if (f.getMimeType() === MimeType.GOOGLE_SHEETS) return SpreadsheetApp.openById(f.getId());
  }
  return null;
}

/** Copia de LUIS_Personal para el entorno de pruebas. No toca el original. */
function instalarPruebas() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FORJA_LIBRO_ID');
  if (!id) throw new Error('Primero corre instalar()');
  const sello = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd HH:mm');
  props.setProperty('FORJA_PRUEBAS_LIBRO_ID', DriveApp.getFileById(id).makeCopy('PRUEBAS ' + sello + ' · LUIS_Personal').getId());
  Logger.log('Entorno de pruebas listo (' + sello + ').');
}

/** Respaldo con fecha de LUIS_Personal. Se puede programar a diario. */
function respaldar() {
  const id = PropertiesService.getScriptProperties().getProperty('FORJA_LIBRO_ID');
  if (id) DriveApp.getFileById(id).makeCopy('RESPALDO ' + Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd') + ' · LUIS_Personal');
}

/** Cambia la clave. La app pedirá la nueva. */
function nuevaClave() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('FORJA_CLAVE', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('Nueva clave: ' + props.getProperty('FORJA_CLAVE'));
}

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */

function doGet(e) {
  try {
    if (!claveOk(e.parameter.token)) return out({ ok: false, error: 'clave' });
    ENTORNO = e.parameter.entorno === 'pruebas' ? 'pruebas' : 'produccion';
    return out({ ok: true, fecha: fmt(hoy()), entorno: ENTORNO, leido: new Date().toISOString(),
      personal: leerPersonal(), finanzas: leerFinanzas() });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    const m = JSON.parse(e.postData.contents);
    if (!claveOk(m.token)) return out({ ok: false, error: 'clave' });
    ENTORNO = m.entorno === 'pruebas' ? 'pruebas' : 'produccion';
    const ops = Array.isArray(m.ops) ? m.ops : [];
    const resultados = ops.map(function (op) {
      try {
        return Object.assign({ id: op.id || null, ok: true }, aplicar(op) || {});
      } catch (err) {
        return { id: op.id || null, ok: false, error: String(err && err.message || err) };
      }
    });
    return out({ ok: true, resultados: resultados });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (_) { /* sin lock */ }
  }
}

function aplicar(op) {
  switch (op.tipo) {
    case 'put': return op.libro === 'finanzas' ? ponerFin(op) : ponerFila(op.hoja, op.fila);
    case 'del': return op.libro === 'finanzas' ? borrarFin(op) : borrarFila(op.hoja, op.ref);
    case 'exportar': return exportarExcel(op.resumen || {});
    default: throw new Error('operación no disponible: ' + op.tipo);
  }
}

function claveOk(t) {
  const clave = PropertiesService.getScriptProperties().getProperty('FORJA_CLAVE');
  return !!clave && t === clave;
}

let ENTORNO = 'produccion';
function libroPersonal() {
  const k = ENTORNO === 'pruebas' ? 'FORJA_PRUEBAS_LIBRO_ID' : 'FORJA_LIBRO_ID';
  const id = PropertiesService.getScriptProperties().getProperty(k);
  if (!id) throw new Error(ENTORNO === 'pruebas' ? 'falta correr instalarPruebas()' : 'falta correr instalar()');
  return SpreadsheetApp.openById(id);
}
/** Finanzas y lo personal comparten el mismo libro. */
function libroFinanzas() { return libroPersonal(); }

function todasLasHojas() {
  const r = {};
  Object.keys(HOJAS).forEach(function (k) { r[k] = HOJAS[k]; });
  Object.keys(HOJAS_FIN).forEach(function (k) { if (!r[k]) r[k] = HOJAS_FIN[k]; });
  return r;
}

function leerPersonal() {
  const libro = libroPersonal();
  const r = {};
  LEGIBLES.forEach(function (n) { r[n] = filas(libro.getSheetByName(n)); });
  return r;
}

/* ------------------------------------------------------------------ */
/* Escritura personal: put (alta o cambio por id) y del (baja por id)  */
/* ------------------------------------------------------------------ */

function ponerFila(nombre, fila) {
  if (ESCRIBIBLES.indexOf(nombre) < 0) throw new Error('hoja no permitida: ' + nombre);
  if (!fila || !fila.id) throw new Error('fila sin id');
  const h = libroPersonal().getSheetByName(nombre);
  const cab = HOJAS[nombre];
  const valores = cab.map(function (c) { return texto(fila[c]); });
  const n = buscarId(h, fila.id);
  if (n) h.getRange(n, 1, 1, cab.length).setValues([valores]);
  else h.appendRow(valores);
  return { hoja: nombre };
}

function borrarFila(nombre, ref) {
  if (ESCRIBIBLES.indexOf(nombre) < 0) throw new Error('hoja no permitida: ' + nombre);
  const h = libroPersonal().getSheetByName(nombre);
  const n = buscarId(h, ref);
  if (n) h.deleteRow(n);
  return { hoja: nombre, borrada: !!n };
}
function filas(h) {
  const v = h.getDataRange().getValues();
  if (v.length < 2) return [];
  const cab = v[0].map(String);
  const r = [];
  for (let i = 1; i < v.length; i++) {
    if (!String(v[i][0]).trim()) continue;
    const o = {};
    cab.forEach(function (c, j) { o[c] = v[i][j] instanceof Date ? fmt(v[i][j]) : v[i][j]; });
    r.push(o);
  }
  return r;
}

function buscarId(h, id) {
  const n = h.getLastRow();
  if (n < 2) return 0;
  const ids = h.getRange(2, 1, n - 1, 1).getValues();
  const buscado = String(id);
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === buscado) return i + 2;
  return 0;
}

/** Agrega en un solo bloque las filas cuyo id no existe. No pisa lo que ya está. */
function agregarFaltantes(h, cab, nuevas) {
  const n = h.getLastRow();
  const ya = {};
  if (n > 1) h.getRange(2, 1, n - 1, 1).getValues().forEach(function (r) { ya[String(r[0])] = true; });
  const faltan = nuevas.filter(function (f) { return f.id && !ya[String(f.id)]; });
  if (faltan.length) {
    h.getRange(n + 1, 1, faltan.length, cab.length).setValues(faltan.map(function (f) {
      return cab.map(function (c) { return texto(f[c]); });
    }));
  }
  return { nuevas: faltan.length, ya_estaban: nuevas.length - faltan.length };
}

function texto(x) {
  return x === undefined || x === null ? '' : String(x);
}

function num(x) {
  if (typeof x === 'number') return x;
  const n = Number(String(x || '').replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function hoy() {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

function dias(d) {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((hoy() - a) / 86400000);
}

function fmt(d) {
  return Utilities.formatDate(d, ZONA, 'yyyy-MM-dd');
}

/** "2026-10-07" → mediodía de ese día en Morelia (nunca el día anterior). */
function fechaLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return s ? new Date(s) : new Date();
}

/** Acepta Date, "yyyy-mm-dd" o "M/d/yyyy". */
function aFecha(x) {
  if (x instanceof Date) return isNaN(x) ? null : x;
  const s = String(x || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(y, Number(m[1]) - 1, Number(m[2]));
  }
  return null;
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
/* ================================================================== */
/* Finanzas personales y proyectos                                   */
/* ================================================================== */

const HOJAS_FIN = {
  Cuentas: ['id', 'nombre', 'tipo', 'ambito', 'saldo_inicial', 'fecha_saldo', 'activa', 'notas'],
  Movimientos: ['id', 'fecha_efectiva', 'fecha_registro', 'tipo', 'categoria', 'monto', 'moneda', 'cuenta_origen',
    'cuenta_destino', 'ambito', 'proyecto_id', 'descripcion', 'comprobante', 'estado', 'naturaleza', 'grupo_id', 'origen'],
  Tarjetas: ['id', 'cuenta_id', 'dia_corte', 'dias_corte_antes_limite', 'dia_limite', 'limite', 'tasa_anual', 'notas'],
  EstadosTarjeta: ['id', 'tarjeta_id', 'fecha_corte', 'saldo', 'minimo', 'pago_sin_intereses', 'fecha_limite',
    'intereses', 'comisiones', 'conciliado', 'fuente', 'notas'],
  Convenios: ['id', 'tarjeta_id', 'fecha', 'condiciones', 'pagos', 'estado'],
  Presupuestos: ['id', 'periodo', 'categoria', 'limite', 'tipo', 'confirmado', 'escenario', 'notas'],
  Proyectos: ['id', 'nombre', 'estado', 'fecha_inicio', 'fecha_fin', 'permiso_estado', 'notas'],
  ProyectoProductos: ['id', 'proyecto_id', 'producto', 'costo_unitario', 'precio', 'inventario', 'notas'],
  Tareas: ['id', 'fecha', 'titulo', 'prioridad', 'proyecto_id', 'obligacion_id', 'hecha', 'subtarea_de', 'creada'],
  Bitacora: ['momento', 'operacion', 'hoja', 'id', 'antes', 'despues'],
  Ops: ['id', 'tipo', 'momento', 'resultado']
};
const FIN_ESCRIBIBLES = ['Cuentas', 'Movimientos', 'Tarjetas', 'EstadosTarjeta', 'Convenios', 'Presupuestos',
  'Proyectos', 'ProyectoProductos', 'Tareas'];
const TIPOS_MOV = ['ingreso', 'gasto', 'traspaso', 'pago_tarjeta', 'interes', 'comision', 'aportacion',
  'prestamo_ambito', 'devolucion_capital', 'retiro_utilidad', 'venta'];
const ESTADOS_MOV = ['esperado', 'programado', 'confirmado', 'conciliado', 'cancelado'];

function prepararLibro(libro, hojas) {
  Object.keys(hojas).forEach(function (nombre) {
    let h = libro.getSheetByName(nombre);
    if (!h) h = libro.insertSheet(nombre);
    if (h.getLastRow() === 0) h.appendRow(hojas[nombre]);
    h.getRange(1, 1, h.getMaxRows(), hojas[nombre].length).setNumberFormat('@');
    h.setFrozenRows(1);
  });
  ['Hoja 1', 'Sheet1'].forEach(function (n) {
    const h = libro.getSheetByName(n);
    if (h && libro.getSheets().length > 1) libro.deleteSheet(h);
  });
}

/** Datos que dio Luis el 20/10/2026. Lo que no dio queda vacío (= pendiente). */
function sembrarFinanzas(libro) {
  const f = '2026-10-20';
  const meter = function (n, filas) { agregarFaltantes(libro.getSheetByName(n), HOJAS_FIN[n], filas); };
  meter('Cuentas', [
    { id: 'efectivo', nombre: 'Efectivo', tipo: 'efectivo', ambito: 'personal', saldo_inicial: 400, fecha_saldo: f, activa: 'true', notas: 'Todo el efectivo disponible al 20/10' },
    { id: 'nu', nombre: 'Nu', tipo: 'tarjeta', ambito: 'personal', saldo_inicial: 28282.34, fecha_saldo: f, activa: 'true', notas: 'Saldo reportado en la app de Nu' },
    { id: 'plata', nombre: 'Plata', tipo: 'tarjeta', ambito: 'personal', saldo_inicial: 2839.13, fecha_saldo: f, activa: 'true', notas: 'Saldo reportado' }
  ]);
  meter('Tarjetas', [
    { id: 'nu', cuenta_id: 'nu', dia_corte: '', dias_corte_antes_limite: 10, dia_limite: 26, limite: 20800, tasa_anual: '', notas: 'Corte: 10 días naturales antes de la fecha límite. Alerta de posible bloqueo por verificar' },
    { id: 'plata', cuenta_id: 'plata', dia_corte: 29, dias_corte_antes_limite: '', dia_limite: '', limite: 1000, tasa_anual: '', notas: 'Fecha límite y mínimo pendientes' }
  ]);
  meter('EstadosTarjeta', [
    { id: 'nu:2026-10-16', tarjeta_id: 'nu', fecha_corte: '2026-10-16', saldo: 28282.34, minimo: 7109.96, pago_sin_intereses: '', fecha_limite: '2026-10-26', intereses: '', comisiones: '', conciliado: 'false', fuente: 'App de Nu, 20/10/2026', notas: 'Sin abonos registrados' },
    { id: 'plata:2026-10-29', tarjeta_id: 'plata', fecha_corte: '2026-10-29', saldo: 2839.13, minimo: '', pago_sin_intereses: '', fecha_limite: '', intereses: '', comisiones: '', conciliado: 'false', fuente: 'Reportado 20/10/2026', notas: 'Próximo corte' }
  ]);
  meter('Movimientos', [
    { id: 'semilla-sueldo-2026-10-22', fecha_efectiva: '2026-10-22', fecha_registro: f, tipo: 'ingreso', categoria: 'Sueldo del negocio familiar',
      monto: 2500, moneda: 'MXN', cuenta_origen: '', cuenta_destino: 'efectivo', ambito: 'personal', proyecto_id: '', descripcion: 'Trabajo en el negocio familiar',
      comprobante: '', estado: 'esperado', naturaleza: '', grupo_id: '', origen: 'semilla' }
  ]);
  meter('Presupuestos', [
    { id: 'p-renta-alimentacion', periodo: 'mensual', categoria: 'Vivienda y alimentación', limite: 6000, tipo: 'obligatorio', confirmado: 'false', escenario: 'base', notas: 'Estimado. Fecha y monto exacto de renta pendientes' }
  ]);
  meter('Proyectos', [
    { id: 'aserrin', nombre: 'Aserrín de colores · Día de Muertos', estado: 'investigacion', fecha_inicio: '', fecha_fin: '2026-11-02', permiso_estado: 'no_aplica', notas: 'Cliente potencial: La Michoacana (por identificar formalmente). Escuelas y organizadores de altares' },
    { id: 'alimentos-tzintzuntzan', nombre: 'Venta de alimentos · Tzintzuntzan', estado: 'planeacion', fecha_inicio: '2026-11-01', fecha_fin: '2026-11-02', permiso_estado: 'pendiente', notas: 'Producto, permisos y ubicación pendientes' },
    { id: 'micheladas-tzintzuntzan', nombre: 'Micheladas · Tzintzuntzan', estado: 'condicionado', fecha_inicio: '2026-11-01', fecha_fin: '2026-11-02', permiso_estado: 'sin_documentos', notas: 'Condicionado a permisos municipales. No autorizado sin documentos' },
    { id: 'navidad', nombre: 'Ventas navideñas', estado: 'planeacion', fecha_inicio: '', fecha_fin: '2026-12-24', permiso_estado: 'no_aplica', notas: '' }
  ]);
}

function leerFinanzas() {
  const libro = libroFinanzas();
  const r = {};
  FIN_ESCRIBIBLES.forEach(function (n) { r[n] = filas(libro.getSheetByName(n)); });
  return r;
}

/** Valida en el servidor antes de escribir. Devuelve el mensaje de error o ''. */
function validarFin(hoja, f) {
  if (!f || !f.id) return 'fila sin id';
  if (f.ambito && !/^(personal|proyecto:[a-z0-9-]+)$/.test(f.ambito)) return 'ámbito inválido: ' + f.ambito;
  if (hoja === 'Movimientos') {
    if (TIPOS_MOV.indexOf(f.tipo) < 0) return 'tipo inválido: ' + f.tipo;
    if (ESTADOS_MOV.indexOf(f.estado) < 0) return 'estado inválido: ' + f.estado;
    if (!(num(f.monto) > 0)) return 'el monto debe ser mayor que 0';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.fecha_efectiva))) return 'fecha inválida';
    if (!f.ambito) return 'falta el ámbito';
    if ((f.tipo === 'traspaso' || f.tipo === 'pago_tarjeta') && (!f.cuenta_origen || !f.cuenta_destino || f.cuenta_origen === f.cuenta_destino)) {
      return 'un traspaso necesita cuenta de origen y de destino distintas';
    }
    if (['aportacion', 'devolucion_capital', 'retiro_utilidad', 'venta', 'prestamo_ambito'].indexOf(f.tipo) >= 0 && !f.proyecto_id) {
      return 'este tipo de movimiento necesita un proyecto';
    }
  }
  return '';
}

function ponerFin(op) {
  const nombre = op.hoja, f = op.fila;
  if (FIN_ESCRIBIBLES.indexOf(nombre) < 0) throw new Error('hoja no permitida: ' + nombre);
  const err = validarFin(nombre, f);
  if (err) throw new Error(err);
  const libro = libroFinanzas();
  const h = libro.getSheetByName(nombre);
  const cab = HOJAS_FIN[nombre];
  const n = buscarId(h, f.id);
  const antes = n ? h.getRange(n, 1, 1, cab.length).getValues()[0] : null;
  const valores = cab.map(function (c) { return texto(f[c]); });
  if (n) h.getRange(n, 1, 1, cab.length).setValues([valores]); else h.appendRow(valores);
  bitacora(libro, 'put', nombre, f.id, antes, valores);
  return { hoja: nombre };
}

function borrarFin(op) {
  if (FIN_ESCRIBIBLES.indexOf(op.hoja) < 0) throw new Error('hoja no permitida: ' + op.hoja);
  if (op.hoja === 'Movimientos' && !op.confirmado) throw new Error('borrar un movimiento requiere confirmación; mejor márcalo como cancelado');
  const libro = libroFinanzas();
  const h = libro.getSheetByName(op.hoja);
  const n = buscarId(h, op.ref);
  if (!n) return { borrada: false };
  const antes = h.getRange(n, 1, 1, HOJAS_FIN[op.hoja].length).getValues()[0];
  h.deleteRow(n);
  bitacora(libro, 'del', op.hoja, op.ref, antes, null);
  return { borrada: true };
}

function bitacora(libro, operacion, hoja, id, antes, despues) {
  libro.getSheetByName('Bitacora').appendRow([new Date().toISOString(), operacion, hoja, String(id),
    antes ? JSON.stringify(antes) : '', despues ? JSON.stringify(despues) : '']);
}

/**
 * Espejo en Excel: FORJA_Control_Financiero_Personal.xlsx en tu Drive.
 * La versión anterior se renombra con fecha; no se borra.
 */
function exportarExcel(resumen) {
  const datos = leerFinanzas();
  const tmp = SpreadsheetApp.create('tmp-forja-export');
  const hoja = function (nombre, filasDatos) {
    const h = tmp.insertSheet(nombre);
    if (filasDatos.length) h.getRange(1, 1, filasDatos.length, filasDatos[0].length).setValues(filasDatos);
    return h;
  };
  const tabla = function (nombreHoja, cab) {
    return [cab].concat(datos[nombreHoja].map(function (r) { return cab.map(function (c) { return texto(r[c]); }); }));
  };
  hoja('Dashboard', [['Indicador', 'Valor', 'Nota']].concat((resumen.filas || []).map(function (r) { return [texto(r[0]), texto(r[1]), texto(r[2])]; })));
  hoja('Movimientos', tabla('Movimientos', HOJAS_FIN.Movimientos));
  hoja('Presupuesto', tabla('Presupuestos', HOJAS_FIN.Presupuestos));
  hoja('Tarjetas', tabla('Tarjetas', HOJAS_FIN.Tarjetas));
  hoja('Proyectos', tabla('Proyectos', HOJAS_FIN.Proyectos));
  hoja('Cuentas', tabla('Cuentas', HOJAS_FIN.Cuentas));
  hoja('Calendario', tabla('Tareas', HOJAS_FIN.Tareas));
  hoja('Conciliacion', tabla('EstadosTarjeta', HOJAS_FIN.EstadosTarjeta));
  hoja('Metadatos', [['clave', 'valor'], ['generado', new Date().toISOString()], ['entorno', ENTORNO],
    ['fuente', 'LUIS_Personal (' + libroFinanzas().getId() + ')'],
    ['movimientos', String(datos.Movimientos.length)], ['version_app', texto(resumen.version)]]);
  tmp.deleteSheet(tmp.getSheetByName('Hoja 1') || tmp.getSheets()[0]);
  SpreadsheetApp.flush();
  const blob = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + tmp.getId() + '/export?format=xlsx', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  }).getBlob();
  const nombre = (ENTORNO === 'pruebas' ? 'PRUEBAS ' : '') + 'FORJA_Control_Financiero_Personal.xlsx';
  const previos = DriveApp.getFilesByName(nombre);
  while (previos.hasNext()) {
    const v = previos.next();
    v.setName(nombre.replace('.xlsx', ' · anterior ' + Utilities.formatDate(v.getLastUpdated(), ZONA, 'yyyy-MM-dd HH.mm') + '.xlsx'));
  }
  const archivo = DriveApp.createFile(blob.setName(nombre));
  DriveApp.getFileById(tmp.getId()).setTrashed(true);
  return { url: archivo.getUrl(), nombre: nombre, filas: datos.Movimientos.length };
}

