/* Pruebas de FORJA Luis. Correr:
 *   TZ=America/Mexico_City node --test test/
 * Solo datos inventados, salvo la estructura de las semillas del 20/10/2026.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEntorno } = require('./simulador');
const FC = require('../app/fin-calc.js');

const HOY = '2026-10-20';
const cuentas = () => [
  { id: 'efectivo', tipo: 'efectivo', ambito: 'personal', saldo_inicial: 400, fecha_saldo: HOY, activa: 'true' },
  { id: 'banco', tipo: 'banco', ambito: 'personal', saldo_inicial: 0, fecha_saldo: HOY, activa: 'true' },
  { id: 'nu', nombre: 'Nu', tipo: 'tarjeta', ambito: 'personal', saldo_inicial: 28282.34, fecha_saldo: HOY, activa: 'true' },
  { id: 'plata', nombre: 'Plata', tipo: 'tarjeta', ambito: 'personal', saldo_inicial: 2839.13, fecha_saldo: HOY, activa: 'true' },
];
const tarjetas = [{ id: 'nu', cuenta_id: 'nu', limite: 20800 }, { id: 'plata', cuenta_id: 'plata', limite: 1000 }];
const estados = [{ id: 'e1', tarjeta_id: 'nu', fecha_corte: '2026-10-16', saldo: 28282.34, minimo: 7109.96, fecha_limite: '2026-10-26', pago_sin_intereses: '' }];
const mov = (x) => Object.assign({ id: Math.random().toString(36).slice(2), fecha_efectiva: HOY, estado: 'confirmado', ambito: 'personal', moneda: 'MXN' }, x);

test('2 y 3 · Nu y Plata son deuda personal', () => {
  const d = FC.deudas(cuentas(), tarjetas, estados, [], HOY);
  assert.deepEqual(d.fichas.map(f => f.id).sort(), ['nu', 'plata']);
  assert.equal(d.total, 31121.47);
  const nu = d.fichas.find(f => f.id === 'nu');
  assert.equal(nu.sobreLimite, 7482.34);
  assert.equal(nu.diasParaLimite, 6);
  assert.equal(nu.estado, 'sin_abonos');
});

test('4 · un ingreso esperado no sube la liquidez confirmada', () => {
  const movs = [mov({ tipo: 'ingreso', monto: 2500, cuenta_destino: 'efectivo', estado: 'esperado', fecha_efectiva: '2026-10-22' })];
  const l = FC.liquidez(cuentas(), movs, HOY);
  assert.equal(l.confirmado, 400);
  assert.equal(l.esperado, 2500);
  movs[0].estado = 'confirmado';
  assert.equal(FC.liquidez(cuentas(), movs, HOY).confirmado, 2900);
});

test('5 · un traspaso entre cuentas propias no es ingreso ni gasto', () => {
  const movs = [mov({ tipo: 'traspaso', monto: 300, cuenta_origen: 'efectivo', cuenta_destino: 'banco' })];
  const l = FC.liquidez(cuentas(), movs, HOY);
  assert.equal(l.confirmado, 400);
  assert.equal(l.efectivo, 100);
  assert.equal(l.bancos, 300);
  assert.deepEqual(FC.flujo(movs, HOY, HOY), { ingresos: 0, gastos: 0, neto: 0 });
});

test('6 · una aportación a un proyecto no es venta ni gasto personal', () => {
  const movs = [mov({ tipo: 'aportacion', monto: 500, cuenta_origen: 'efectivo', ambito: 'proyecto:aserrin', proyecto_id: 'aserrin' })];
  const p = FC.proyecto({ id: 'aserrin' }, movs, []);
  assert.equal(p.inversion, 500);
  assert.equal(p.cobrado, 0);
  assert.equal(p.margenContribucion, 0);
  assert.equal(FC.flujo(movs, HOY, HOY).gastos, 0);
  assert.equal(FC.liquidez(cuentas(), movs, HOY).confirmado, -100, 'sí sale de tu efectivo');
});

test('7 · pagar la tarjeta baja la deuda sin contar otra vez como gasto', () => {
  const compra = mov({ tipo: 'gasto', categoria: 'Alimentación', monto: 200, cuenta_origen: 'nu' });
  const pago = mov({ tipo: 'pago_tarjeta', monto: 200, cuenta_origen: 'efectivo', cuenta_destino: 'nu' });
  const movs = [compra, pago];
  assert.equal(FC.flujo(movs, HOY, HOY).gastos, 200, 'el gasto se cuenta una sola vez');
  const nu = FC.deudas(cuentas(), tarjetas, estados, movs, HOY).fichas.find(f => f.id === 'nu');
  assert.equal(nu.saldo, 28282.34);
  assert.equal(nu.abonado, 200);
  assert.equal(nu.estado, 'abono_parcial');
  const interes = mov({ tipo: 'interes', monto: 50, cuenta_origen: 'nu' });
  const nu2 = FC.deudas(cuentas(), tarjetas, estados, movs.concat(interes), HOY).fichas.find(f => f.id === 'nu');
  assert.equal(nu2.saldo, 28332.34, 'el interés sube la deuda y se ve aparte');
});

test('un movimiento cancelado no cuenta en nada', () => {
  const movs = [mov({ tipo: 'gasto', monto: 100, cuenta_origen: 'efectivo', estado: 'cancelado' })];
  assert.equal(FC.liquidez(cuentas(), movs, HOY).confirmado, 400);
  assert.equal(FC.flujo(movs, HOY, HOY).gastos, 0);
});

test('proyecto: venta por cobrar, fijos y punto de equilibrio', () => {
  const movs = [
    mov({ tipo: 'aportacion', monto: 1000, proyecto_id: 'x', ambito: 'proyecto:x' }),
    mov({ tipo: 'gasto', monto: 300, naturaleza: 'fijo', proyecto_id: 'x', ambito: 'proyecto:x' }),
    mov({ tipo: 'gasto', monto: 200, naturaleza: 'variable', proyecto_id: 'x', ambito: 'proyecto:x' }),
    mov({ tipo: 'venta', monto: 600, proyecto_id: 'x', ambito: 'proyecto:x' }),
    mov({ tipo: 'venta', monto: 400, estado: 'esperado', proyecto_id: 'x', ambito: 'proyecto:x' })
  ];
  const p = FC.proyecto({ id: 'x' }, movs, [{ proyecto_id: 'x', producto: 'Bolsa 1 kg', costo_unitario: 20, precio: 50 }]);
  assert.equal(p.cobrado, 600);
  assert.equal(p.porCobrar, 400);
  assert.equal(p.margenContribucion, 800);
  assert.equal(p.utilidadEstimada, 500);
  assert.equal(p.capitalTrabajo, 1100);
  assert.equal(p.productos[0].equilibrio, 10);
});

/* ---------- servidor ---------- */

function listo() {
  const e = crearEntorno();
  e.instalar();
  return { e, token: e.props.FORJA_CLAVE };
}
const PERSONALES = ['Habitos', 'Marcas', 'Ejercicios', 'Sesiones', 'Series', 'Alimentos', 'Comidas', 'Peso', 'Config'];

test('instalar crea un solo libro LUIS_Personal con todo, sin Rituales', () => {
  const { e } = listo();
  const l = e.libro();
  assert.equal(l.getName ? l.nombre : l.nombre, 'LUIS_Personal');
  const hojas = l.getSheets().map(h => h.getName());
  PERSONALES.concat(['Cuentas', 'Movimientos', 'Tarjetas', 'Proyectos', 'Tareas', 'Bitacora', 'Ops']).forEach(n => assert.ok(hojas.includes(n), n));
  assert.ok(!hojas.some(n => /ritual/i.test(n)));
});

test('siembra los datos del 20/10 sin inventar los pendientes', () => {
  const { e, token } = listo();
  const f = e.get({ token }).finanzas;
  assert.equal(f.Cuentas.find(c => c.id === 'efectivo').saldo_inicial, '400');
  assert.equal(f.Tarjetas.find(t => t.id === 'nu').tasa_anual, '');
  assert.equal(f.Movimientos[0].estado, 'esperado');
  assert.equal(f.Proyectos.length, 4);
  e.instalar();
  assert.equal(e.get({ token }).finanzas.Movimientos.length, 1, 'repetir instalar no duplica');
});

test('migrarDesdeForja copia todo lo personal, deja fuera las tareas de la empresa y no toca el origen', () => {
  const { e, token } = listo();
  const antes = JSON.stringify(e.origen.hojas.map(h => h.d));
  e.correr('migrarDesdeForja');
  e.correr('migrarDesdeForja');
  const p = e.get({ token }).personal;
  assert.equal(p.Marcas.length, 2, 'sin duplicar al repetir');
  assert.equal(p.Series[0].kg, '60');
  assert.equal(p.Comidas[0].proteina, '18');
  assert.equal(p.Peso[0].kg, '80');
  assert.equal(p.Config[0].valor, 'pierna,empuje,tiron,brazos,torso,libre,off');
  assert.ok(!('Rituales' in p) && !('RitualesHechos' in p));
  assert.ok(!e.libro().getSheetByName('Rituales'));
  assert.equal(JSON.stringify(e.origen.hojas.map(h => h.d)), antes, 'FORJA_Personal intacto');
});

test('el script solo abre LUIS_Personal y sus copias', () => {
  const { e, token } = listo();
  e.correr('instalarPruebas');
  e.abiertos.length = 0;
  e.get({ token });
  e.get({ token, entorno: 'pruebas' });
  e.post({ token, ops: [{ id: 'a', tipo: 'put', hoja: 'Peso', fila: { id: 'p9', fecha: HOY, kg: 79 } }] });
  const propios = [e.props.FORJA_LIBRO_ID, e.props.FORJA_PRUEBAS_LIBRO_ID];
  assert.ok(e.abiertos.every(id => propios.includes(id)), JSON.stringify(e.abiertos));
  const codigo = require('fs').readFileSync(require('path').join(__dirname, '../apps-script/Codigo.gs'), 'utf8');
  assert.doesNotMatch(codigo, /contable|lual/i);
});

test('las operaciones de la empresa no existen aquí', () => {
  const { e, token } = listo();
  ['venta', 'ingreso', 'gasto', 'abono', 'cobro', 'importar'].forEach(tipo => {
    const r = e.post({ token, ops: [{ id: 'o-' + tipo, tipo, monto: 1 }] }).resultados[0];
    assert.equal(r.ok, false, tipo);
  });
  assert.match(e.post({ token, ops: [{ id: 'r', tipo: 'put', hoja: 'Rituales', fila: { id: 'x' } }] }).resultados[0].error, /no permitida/);
});

test('escribe y valida finanzas con bitácora', () => {
  const { e, token } = listo();
  const put = fila => e.post({ token, ops: [{ id: 'x' + Math.random(), tipo: 'put', libro: 'finanzas', hoja: 'Movimientos', fila: Object.assign({ id: 'z', fecha_efectiva: HOY, tipo: 'gasto', monto: 10, ambito: 'personal', estado: 'confirmado', cuenta_origen: 'efectivo' }, fila) }] }).resultados[0];
  assert.ok(put({}).ok);
  assert.equal(e.libro().getSheetByName('Bitacora').d.length, 2);
  assert.match(put({ ambito: 'lual' }).error, /ámbito/);
  assert.match(put({ monto: 0 }).error, /monto/);
  assert.match(put({ estado: 'pagado' }).error, /estado/);
  assert.match(put({ tipo: 'traspaso', cuenta_origen: 'efectivo', cuenta_destino: 'efectivo' }).error, /distintas/);
  assert.match(put({ tipo: 'aportacion' }).error, /proyecto/);
  const borrar = e.post({ token, ops: [{ id: 'd1', tipo: 'del', libro: 'finanzas', hoja: 'Movimientos', ref: 'semilla-sueldo-2026-10-22' }] }).resultados[0];
  assert.match(borrar.error, /confirmación/);
});

test('pruebas trabaja sobre una copia y no toca producción', () => {
  const { e, token } = listo();
  e.correr('instalarPruebas');
  const r = e.post({ token, entorno: 'pruebas', ops: [{ id: 'f1', tipo: 'put', libro: 'finanzas', hoja: 'Movimientos', fila: { id: 'mp', fecha_efectiva: HOY, tipo: 'gasto', monto: 5, ambito: 'personal', estado: 'confirmado', cuenta_origen: 'efectivo' } }] });
  assert.ok(r.resultados[0].ok, JSON.stringify(r));
  assert.equal(e.libro().getSheetByName('Movimientos').d.length, 2);
  assert.equal(e.libro(true).getSheetByName('Movimientos').d.length, 3);
});

test('clave equivocada no lee nada', () => {
  const { e } = listo();
  assert.deepEqual(e.get({ token: 'mala' }), { ok: false, error: 'clave' });
});
