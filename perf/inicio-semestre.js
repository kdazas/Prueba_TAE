// Prueba de carga – Inicio de semestre (Parte 3). Ver perf/README.md (diseño, datos y costos).
// Es un diseño ejecutable: NO se ha corrido contra un ambiente real.
//
//   k6 run -e API_URL=https://... -e FECHA=2027-01-25 perf/inicio-semestre.js
//   k6 run -e FACTOR=2 ...   → estrés al doble (requiere el doble de estudiantes en los datos)
//
// SUPUESTOS: existe GET /api/v1/espacios (búsqueda; no aparece en el resumen de la API del caso);
// los datos se preparan antes con test-support: datos/estudiantes.json (id, token) con al menos
// tantos estudiantes como llegadas, y datos/espacios.json ordenado de más a menos demandado.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate } from 'k6/metrics';
import exec from 'k6/execution';

const API = __ENV.API_URL || 'http://localhost:8000';
const FECHA = __ENV.FECHA || '2027-01-25';
const FACTOR = Number(__ENV.FACTOR || 1);

const estudiantes = new SharedArray('estudiantes', () => JSON.parse(open('./datos/estudiantes.json')));
const espacios = new SharedArray('espacios', () => JSON.parse(open('./datos/espacios.json')));

const reservasCreadas = new Counter('reservas_creadas');
const espacioOcupado = new Rate('espacio_ocupado');               // 409 ESPACIO_OCUPADO: esperado, se reintenta
const limiteInesperado = new Counter('limite_inesperado');        // 409 LIMITE_RESERVAS: NO esperado (estudiante nuevo)
const estudianteSinReserva = new Rate('estudiante_sin_reserva');  // no logró reservar tras 3 intentos
const sinDatos = new Counter('llegadas_sin_estudiante');          // faltan estudiantes en los datos

// Un 409 es una respuesta de negocio, no un error técnico: no cuenta en http_req_failed.
// Los 409 se clasifican aparte (espacio_ocupado / limite_inesperado).
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 409));

const escalar = (n) => Math.round(n * FACTOR);

// Perfil (llegadas por MINUTO): apertura, pico sostenido y descenso.
// Total exacto = 300 + 1.200 + 1.200 + 300 = 3.000 llegadas en 9 minutos (× FACTOR).
// El pico (600/min = 10/s) es un supuesto a validar con negocio y datos de semestres anteriores.
export const options = {
  scenarios: {
    inicio_semestre: {
      executor: 'ramping-arrival-rate', // modelo ABIERTO: llegan aunque el sistema esté lento
      startRate: 0,
      timeUnit: '1m',
      preAllocatedVUs: escalar(200),
      maxVUs: escalar(1200),
      stages: [
        { duration: '1m', target: escalar(600) }, // se abren las reservas: 0 → 600/min
        { duration: '2m', target: escalar(600) }, // pico sostenido
        { duration: '3m', target: escalar(200) }, // desciende
        { duration: '3m', target: 0 },            // termina
      ],
    },
  },
  thresholds: {
    'http_req_duration{endpoint:crear_reserva,status:201}': ['p(95)<1000', 'p(99)<2000'],
    'http_req_duration{endpoint:buscar_espacios}': ['p(95)<800'],
    http_req_failed: ['rate<0.01'],     // 5xx, timeouts y 429 (los 429 también se miran aparte)
    checks: ['rate>0.99'],
    limite_inesperado: ['count==0'],    // un estudiante nuevo nunca debería chocar con el límite
    llegadas_sin_estudiante: ['count==0'],
    dropped_iterations: ['count==0'],   // si k6 no pudo lanzar llegadas, el resultado no es válido
  },
};

export function setup() {
  const llegadas = escalar(3000);
  if (estudiantes.length < llegadas) {
    throw new Error(`Se necesitan ${llegadas} estudiantes distintos y hay ${estudiantes.length}`);
  }
}

const pausa = (min, max) => sleep(min + Math.random() * (max - min));

// Demanda desigual: pocos espacios muy pedidos. Elevar al cubo concentra la elección en los primeros.
const espacioSegunDemanda = () => espacios[Math.floor(espacios.length * Math.pow(Math.random(), 3))];

function franjaAleatoria() {
  const hora = 7 + Math.floor(Math.random() * 13);
  const dosDigitos = (n) => String(n).padStart(2, '0');
  return { inicio: `${FECHA}T${dosDigitos(hora)}:00:00-05:00`, fin: `${FECHA}T${dosDigitos(hora + 1)}:00:00-05:00` };
}

export default function () {
  // Cada llegada es un estudiante DISTINTO: nunca se reutiliza una cuenta.
  const indice = exec.scenario.iterationInTest;
  if (indice >= estudiantes.length) {
    sinDatos.add(1);
    return;
  }
  const estudiante = estudiantes[indice];
  const headers = { Authorization: `Bearer ${estudiante.token}`, 'Content-Type': 'application/json' };
  const franja = franjaAleatoria();

  const busqueda = http.get(`${API}/api/v1/espacios?inicio=${franja.inicio}&fin=${franja.fin}`, {
    headers,
    tags: { endpoint: 'buscar_espacios' },
  });
  check(busqueda, { 'búsqueda responde 200': (r) => r.status === 200 });
  pausa(3, 8); // el estudiante mira los resultados

  let reservo = false;
  for (let intento = 1; intento <= 3 && !reservo; intento++) {
    const respuesta = http.post(
      `${API}/api/v1/reservas`,
      JSON.stringify({ espacioId: espacioSegunDemanda(), ...franja }),
      { headers, tags: { endpoint: 'crear_reserva' } },
    );
    const codigo = respuesta.status === 409 ? respuesta.json('codigo') : null;

    if (codigo === 'LIMITE_RESERVAS') limiteInesperado.add(1);
    espacioOcupado.add(codigo === 'ESPACIO_OCUPADO');

    check(respuesta, {
      'crear: 201 con estado ACTIVA, o 409 ESPACIO_OCUPADO': (r) =>
        (r.status === 201 && r.json('estado') === 'ACTIVA') || codigo === 'ESPACIO_OCUPADO',
    });

    if (respuesta.status === 201) {
      reservo = true;
      reservasCreadas.add(1);
    } else if (codigo === 'ESPACIO_OCUPADO') {
      pausa(2, 5); // elige otro espacio
    } else {
      break; // cualquier otra respuesta no se reintenta
    }
  }
  estudianteSinReserva.add(!reservo);
}
