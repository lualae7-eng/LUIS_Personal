/* Simulador mínimo de Apps Script (SpreadsheetApp y compañía) para probar
 * apps-script/Codigo.gs sin tocar los Sheets reales.
 * Solo datos inventados. Correr con TZ=America/Mexico_City.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

class Rango {
  constructor(hoja, f, c, nf, nc) { Object.assign(this, { hoja, f, c, nf, nc }); }
  getValues() {
    const r = [];
    for (let i = 0; i < this.nf; i++) {
      const fila = this.hoja.d[this.f - 1 + i] || [];
      const out = [];
      for (let j = 0; j < this.nc; j++) { const v = fila[this.c - 1 + j]; out.push(v === undefined ? '' : v); }
      r.push(out);
    }
    return r;
  }
  setValues(v) {
    v.forEach((fila, i) => {
      const k = this.f - 1 + i;
      while (this.hoja.d.length <= k) this.hoja.d.push([]);
      fila.forEach((x, j) => { this.hoja.d[k][this.c - 1 + j] = x; });
    });
    return this;
  }
  setValue(x) { return this.setValues([[x]]); }
  getFormula() { return (this.hoja.formulas[this.f + ':' + this.c]) || ''; }
  setNumberFormat() { return this; }
}

class Hoja {
  constructor(nombre, d = []) { this.nombre = nombre; this.d = d.map(r => r.slice()); this.formulas = {}; }
  getName() { return this.nombre; }
  getLastRow() { return this.d.length; }
  getMaxRows() { return Math.max(1000, this.d.length); }
  appendRow(r) { this.d.push(r.slice()); return this; }
  getDataRange() { const nc = Math.max(1, ...this.d.map(r => r.length)); return new Rango(this, 1, 1, Math.max(1, this.d.length), nc); }
  getRange(f, c, nf = 1, nc = 1) { return new Rango(this, f, c, nf, nc); }
  deleteRow(i) { this.d.splice(i - 1, 1); }
  setFrozenRows() { return this; }
}

class Libro {
  constructor(nombre, hojas = {}) {
    this.nombre = nombre; this.id = 'libro-' + crypto.randomUUID();
    this.hojas = Object.entries(hojas).map(([n, d]) => new Hoja(n, d));
    if (!this.hojas.length) this.hojas.push(new Hoja('Hoja 1'));
  }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.hojas.find(h => h.nombre === n) || null; }
  getSheets() { return this.hojas.slice(); }
  insertSheet(n) { const h = new Hoja(n); this.hojas.push(h); return h; }
  deleteSheet(h) { this.hojas = this.hojas.filter(x => x !== h); }
}

const fmtFecha = (d, tz, patron) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).map(x => [x.type, x.value]));
  if (patron === 'yyyy-MM-dd') return `${p.year}-${p.month}-${p.day}`;
  if (patron === 'yyyy-MM-dd HH:mm' || patron === 'yyyy-MM-dd HH.mm') return `${p.year}-${p.month}-${p.day} 00:00`;
  if (patron === 'M/d/yyyy') return `${Number(p.month)}/${Number(p.day)}/${p.year}`;
  throw new Error('patrón no simulado: ' + patron);
};

/** FORJA_Personal inventado con la forma real de sus hojas (origen de la migración). */
function forjaDePrueba() {
  return new Libro('FORJA_Personal', {
    Habitos: [['id', 'nombre', 'nota', 'color', 'dias', 'creado', 'activo', 'orden'], ['h1', 'Leer', '', '', '1234567', '2026-09-01', 'true', 1]],
    Marcas: [['id', 'fecha', 'habito_id', 'origen'], ['m1', '2026-10-01', 'h1', 'app'], ['m2', '2026-10-02', 'h1', 'app']],
    Rituales: [['id', 'etiqueta', 'orden', 'activo'], ['r1', 'Tarea de la empresa', 1, 'true']],
    RitualesHechos: [['id', 'fecha', 'ritual_id', 'origen'], ['rh1', '2026-10-02', 'r1', 'app']],
    Ejercicios: [['id', 'nombre', 'dia', 'esquema', 'descanso_s', 'nota', 'orden', 'activo'], ['e1', 'Sentadilla', 'pierna', '4x8', 120, '', 1, 'true']],
    Sesiones: [['id', 'fecha', 'dia', 'cerrada'], ['s1', '2026-10-01', 'pierna', 'true']],
    Series: [['id', 'sesion_id', 'fecha', 'ejercicio_id', 'n', 'kg', 'reps', 'reps_der', 'seg', 'seg_der', 'origen'], ['x1', 's1', '2026-10-01', 'e1', 1, 60, 8, '', '', '', 'app']],
    Alimentos: [['id', 'nombre', 'porcion', 'proteina', 'activo'], ['a1', 'Huevo', '1 pza', 6, 'true']],
    Comidas: [['id', 'fecha', 'alimento_id', 'nombre', 'porciones', 'proteina', 'origen'], ['c1', '2026-10-01', 'a1', 'Huevo', 3, 18, 'app']],
    Peso: [['id', 'fecha', 'kg'], ['p1', '2026-10-01', 80]],
    Config: [['id', 'valor'], ['plan', 'pierna,empuje,tiron,brazos,torso,libre,off']]
  });
}

function crearEntorno({ origen = forjaDePrueba() } = {}) {
  const libros = { [origen.id]: origen };
  const abiertos = [];
  const props = {};
  const logs = [];
  const ctx = {
    console,
    Date, // mismo Date que las pruebas: si no, instanceof Date falla entre contextos
    SpreadsheetApp: {
      getActiveSpreadsheet: () => null,
      openById: id => { abiertos.push(id); return libros[id] || null; },
      create: n => { const l = new Libro(n); libros[l.id] = l; return l; }
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: fmtFecha, getUuid: () => crypto.randomUUID() },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType() { return this; }, getContent: () => s }) },
    Logger: { log: x => logs.push(String(x)) },
    DriveApp: {
      getFilesByName: n => {
        const l = Object.values(libros).filter(x => x.nombre === n);
        return { hasNext: () => l.length > 0, next: () => { const x = l.shift(); return { getId: () => x.id, getMimeType: () => 'application/vnd.google-apps.spreadsheet' }; } };
      },
      getFileById: id => ({
        makeCopy: nombre => {
          const o = libros[id];
          const c = new Libro(nombre, Object.fromEntries(o.hojas.map(h => [h.nombre, h.d])));
          libros[c.id] = c;
          return { getId: () => c.id };
        },
        setTrashed() {}
      })
    },
    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Codigo.gs'), 'utf8'), ctx, { filename: 'Codigo.gs' });
  // const/function de nivel superior no quedan en ctx: se exponen así.
  const fn = nombre => vm.runInContext(nombre, ctx);
  return {
    ctx, libros, props, logs, origen, abiertos,
    instalar: () => fn('instalar')(),
    correr: nombre => fn(nombre)(),
    get: params => JSON.parse(fn('doGet')({ parameter: params }).getContent()),
    post: cuerpo => JSON.parse(fn('doPost')({ postData: { contents: JSON.stringify(cuerpo) } }).getContent()),
    libro: (pruebas) => libros[pruebas ? props.FORJA_PRUEBAS_LIBRO_ID : props.FORJA_LIBRO_ID]
  };
}

module.exports = { crearEntorno, forjaDePrueba, Libro, Hoja };
