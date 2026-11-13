// MOCK DE LA API – SOLO PARA DEMOSTRACIÓN.
// No es la aplicación real: imita el contrato descrito en el caso para poder ejecutar las pruebas en local.
//
// Interruptores para inyectar defectos y comprobar que las pruebas los detectan:
//   BUG_SIN_LIMITE=1   el límite de 2 reservas no se aplica
//   BUG_CARRERA=1      el límite se verifica y se guarda en dos pasos (condición de carrera)
//   BUG_LIBERA_TODO=1  el proceso libera también reservas que siguen dentro de la ventana de check-in
//   LIBERACION_CADA_MS cada cuánto corre el proceso de liberación (real: 60000; demo: 5000)

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PUERTO = Number(process.env.PUERTO_MOCK ?? 8000);
const LIBERACION_CADA_MS = Number(process.env.LIBERACION_CADA_MS ?? 5000);
const VENTANA_CHECKIN_MS = 15 * 60_000;
const MAX_RESERVAS_ESTUDIANTE = 2;

const usuarios = new Map();  // token -> usuario
const reservas = new Map();  // id -> reserva
let relojFijo = null;        // si está fijado, el backend usa esta hora (congelada)

const ahora = () => relojFijo ?? Date.now();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function responder(res, status, cuerpo) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(cuerpo === undefined ? '' : JSON.stringify(cuerpo));
}

async function leerCuerpo(req) {
  let datos = '';
  for await (const parte of req) datos += parte;
  return datos ? JSON.parse(datos) : {};
}

function usuarioAutenticado(req) {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '');
  return usuarios.get(token);
}

const activasDe = (usuarioId) =>
  [...reservas.values()].filter((r) => r.usuarioId === usuarioId && r.estado === 'ACTIVA').length;

const seCruzan = (a, b) => a.inicio < b.fin && b.inicio < a.fin;

// Regla 3: proceso que libera reservas sin check-in pasados 15 minutos desde el inicio.
setInterval(() => {
  for (const r of reservas.values()) {
    const vencida = ahora() > r.inicio + VENTANA_CHECKIN_MS;
    const empezo = ahora() >= r.inicio;
    if (r.estado === 'ACTIVA' && !r.checkin && (vencida || (process.env.BUG_LIBERA_TODO && empezo))) {
      r.estado = 'LIBERADA';
    }
  }
}, LIBERACION_CADA_MS);

const rutas = [
  ['GET', /^\/salud$/, (req, res) => responder(res, 200, { ok: true })],

  // --- test-support (solo QA) ---
  ['POST', /^\/api\/v1\/test-support\/usuarios$/, async (req, res) => {
    const { rol } = await leerCuerpo(req);
    const usuario = { id: randomUUID(), email: `prueba-${Date.now()}@pruebas.local`, rol, token: randomUUID() };
    usuarios.set(usuario.token, usuario);
    responder(res, 201, usuario);
  }],
  ['DELETE', /^\/api\/v1\/test-support\/usuarios\/([\w-]+)$/, (req, res, [id]) => {
    for (const [token, u] of usuarios) if (u.id === id) usuarios.delete(token);
    for (const [rid, r] of reservas) if (r.usuarioId === id) reservas.delete(rid);
    responder(res, 204);
  }],
  ['POST', /^\/api\/v1\/test-support\/reloj$/, async (req, res) => {
    relojFijo = new Date((await leerCuerpo(req)).ahora).getTime();
    responder(res, 200, { ahora: new Date(relojFijo).toISOString() });
  }],
  ['DELETE', /^\/api\/v1\/test-support\/reloj$/, (req, res) => {
    relojFijo = null;
    responder(res, 204);
  }],

  // --- reservas ---
  ['POST', /^\/api\/v1\/reservas$/, async (req, res, _, usuario) => {
    const { espacioId, inicio, fin } = await leerCuerpo(req);
    const nueva = { espacioId, inicio: new Date(inicio).getTime(), fin: new Date(fin).getTime() };
    if (!espacioId || Number.isNaN(nueva.inicio) || Number.isNaN(nueva.fin) || nueva.fin <= nueva.inicio) {
      return responder(res, 422, { detalle: 'Solicitud inválida' });
    }

    // Regla 1 (con defectos opcionales para la demostración).
    const activas = activasDe(usuario.id);
    if (process.env.BUG_CARRERA) await esperar(50); // la verificación y el guardado quedan separados
    if (usuario.rol === 'ESTUDIANTE' && !process.env.BUG_SIN_LIMITE && activas >= MAX_RESERVAS_ESTUDIANTE) {
      return responder(res, 409, { codigo: 'LIMITE_RESERVAS' });
    }

    // Regla 2.
    const ocupado = [...reservas.values()].some(
      (r) => r.espacioId === espacioId && r.estado === 'ACTIVA' && seCruzan(r, nueva),
    );
    if (ocupado) return responder(res, 409, { codigo: 'ESPACIO_OCUPADO' });

    const reserva = { id: randomUUID(), usuarioId: usuario.id, ...nueva, estado: 'ACTIVA', checkin: false };
    reservas.set(reserva.id, reserva);
    responder(res, 201, { id: reserva.id, estado: reserva.estado });
  }],
  ['GET', /^\/api\/v1\/reservas\/([\w-]+)$/, (req, res, [id], usuario) => {
    const r = reservas.get(id);
    if (!r || r.usuarioId !== usuario.id) return responder(res, 404, { detalle: 'No existe' });
    responder(res, 200, { id: r.id, estado: r.estado });
  }],
  // Regla 4: cancelación asíncrona (responde 202 y cambia el estado unos segundos después).
  ['DELETE', /^\/api\/v1\/reservas\/([\w-]+)$/, (req, res, [id], usuario) => {
    const r = reservas.get(id);
    if (!r || r.usuarioId !== usuario.id) return responder(res, 404, { detalle: 'No existe' });
    setTimeout(() => { if (r.estado === 'ACTIVA') r.estado = 'CANCELADA'; }, 1000 + Math.random() * 2000);
    responder(res, 202);
  }],
  ['POST', /^\/api\/v1\/reservas\/([\w-]+)\/checkin$/, (req, res, [id], usuario) => {
    const r = reservas.get(id);
    if (!r || r.usuarioId !== usuario.id) return responder(res, 404, { detalle: 'No existe' });
    const dentroDeVentana = ahora() >= r.inicio && ahora() <= r.inicio + VENTANA_CHECKIN_MS;
    if (r.estado !== 'ACTIVA' || !dentroDeVentana) return responder(res, 422, { detalle: 'Fuera de la ventana de check-in' });
    r.checkin = true;
    responder(res, 200, { id: r.id, estado: r.estado });
  }],
];

const servidor = http.createServer(async (req, res) => {
  try {
    const ruta = new URL(req.url, 'http://localhost').pathname;
    for (const [metodo, patron, manejar] of rutas) {
      const coincide = req.method === metodo && ruta.match(patron);
      if (!coincide) continue;
      const publica = ruta === '/salud' || ruta.includes('/test-support/');
      const usuario = usuarioAutenticado(req);
      if (!publica && !usuario) return responder(res, 401, { detalle: 'No autenticado' });
      return await manejar(req, res, coincide.slice(1), usuario);
    }
    responder(res, 404, { detalle: 'Ruta no encontrada' });
  } catch (error) {
    responder(res, 500, { detalle: String(error) });
  }
});

servidor.listen(PUERTO, () => console.log(`Mock de la API en http://localhost:${PUERTO}`));
