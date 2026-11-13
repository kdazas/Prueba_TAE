# Pruebas automatizadas – Plataforma de Reservas de Espacios Académicos

Base de un framework en **Playwright + TypeScript** para la prueba técnica de Especialista de Automatización de Pruebas (Parte 2).

- **2.1 Revisión del PR:** [docs/parte-2.1-revision-pr.md](docs/parte-2.1-revision-pr.md)
- **2.2 Framework y las dos pruebas pedidas:** este repositorio.

> No existe una aplicación disponible. Para poder **ejecutar** las pruebas incluí un **mock de la API** ([mock-api/servidor.mjs](mock-api/servidor.mjs)) que imita el contrato del caso. No forma parte del framework: solo sirve para demostrar el diseño. El mock no valida el SSO, el vencimiento real del token ni el proceso real del backend.

---

## Cómo ejecutarlo

Requisitos: Node.js 20 o superior.

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

| Comando | Qué hace |
|---|---|
| `npm run demo` | Levanta el mock y ejecuta las pruebas de API y luego la de reloj |
| `npm run demo:paralelo` | Pruebas de API ×5 repeticiones con 4 workers: en paralelo, en cualquier orden y repetidas |
| `npm run demo:ui` | Modo visual de Playwright contra el mock |
| `npm run report` | Abre el último reporte HTML (con el trace de cada llamada) |
| `npm run test:pr` | Conjunto del pull request (`@pr`): API + UI, sin reloj y sin reintentos |
| `npm run test:nocturna` | Todo (el reloj al final), con 1 reintento para **detectar** pruebas inestables |
| `npm run test:reloj` | Solo las pruebas que mueven el reloj (fuera del mock requiere `QA_RELOJ_EXCLUSIVO=1`) |
| `npm run typecheck` | Verificación de tipos |

**Inyectar defectos en el mock** para comprobar que las pruebas fallan cuando deben:

```bash
BUG_SIN_LIMITE=1 npm run demo           # fallan: "no puede crear una tercera" y "dos simultáneas"
BUG_CARRERA=1 npm run demo              # falla solo: "dos solicitudes simultáneas"
BUG_LIBERA_TODO=1 npm run demo          # falla: liberación (gracias a la reserva de control)
LIBERACION_CADA_MS=60000 npm run demo   # liberación con el ciclo real de 60 s
```

La prueba de UI no corre contra el mock porque no hay frontend; queda escrita para ejecutarse contra QA.

---

## Estructura

```
src/
  config/env.ts               URLs y ambiente desde variables de entorno; guardián "solo QA"
  config/slas.ts              Tiempos del caso y presupuestos de espera de las pruebas
  api/types.ts                Tipos del contrato (estados, solicitudes, errores)
  api/ReservasApi.ts          Cliente de reservas para un usuario (token propio, esperas por estado)
  api/TestSupportApi.ts       Cliente de /test-support (usuarios y reloj), con respuestas verificadas
  data/horarios.ts            Generador de horarios sin choques entre workers
  fixtures/index.ts           Usuario por prueba, limpieza, reloj con ventana exclusiva y restablecimiento
  pages/DetalleReservaPage.ts Page Object de la pantalla de detalle
tests/
  api/regla-1-limite-reservas.spec.ts           PRUEBA 1: límite de 2 activas, incluida la concurrencia
  reloj/regla-3-liberacion-sin-checkin.spec.ts  PRUEBA 2: liberación sin check-in con reloj controlado
  ui/esc-031-cancelar-reserva.spec.ts           Ejemplo de UI con Page Object ([ESC-031] corregida)
mock-api/servidor.mjs         Mock de la API, solo para la demostración
perf/                         Prueba de carga k6 de inicio de semestre (Parte 3), con datos y costos
docs/                         Revisión del PR generado con IA (Parte 2.1)
azure-pipelines.yml           Pipeline de PR y nocturna
```

---

## Decisiones de diseño

**1. Cada prueba crea sus propios datos y los limpia al terminar, aunque falle.**
La fixture `crearUsuario` crea usuarios con `/test-support/usuarios` y los elimina después de `use()`, que se ejecuta también cuando la prueba falla. Si falla el borrado de un usuario, igual intenta borrar los demás y luego informa el error. Cada usuario trae su propio token: evita la cuenta compartida (Fallo B de la Parte 4) y el token vencido a mitad de la ejecución (Fallo C). Un cierre forzado del proceso sí puede dejar residuos; por eso los datos de prueba deben poder identificarse y depurarse.

**2. Los horarios no chocan entre workers.**
`GeneradorHorarios` asigna **un espacio de prueba por worker** (`parallelIndex` es único entre los workers que corren a la vez) y un día futuro aleatorio. La cantidad de workers se calcula a partir de los espacios (`workers: ESPACIOS_PRUEBA.length`), así no pueden desalinearse. Las fechas llevan zona horaria (`-05:00`).

**3. Se espera una condición, nunca un tiempo fijo.**
`esperarEstado()` usa `expect.poll`: consulta el estado y termina apenas llega al esperado. Los límites (`ESPERA_MAXIMA`) son presupuestos de prueba: 15 s para la cancelación (el caso dice que *normalmente* tarda menos de 10 s; no es un SLA acordado) y 90 s para la liberación (el proceso corre cada minuto). No hay `waitForTimeout` en el framework. Superar un presupuesto exige investigar la causa (cola, ambiente, contrato).

**4. El reloj del backend es global: sus pruebas se aíslan.**
- Corren en el proyecto `reloj`, con `workers: 1` y **después** de `api` y `ui` (`dependencies`).
- Tienen **timeout de 120 s**: la liberación puede tardar hasta 90 s y el timeout por defecto de Playwright (30 s) las cortaría.
- Fuera del mock, la fixture `reloj` **se niega a mover la hora** si no está definida `QA_RELOJ_EXCLUSIVO=1`, que declara una ventana exclusiva reservada con QA. Se verifica antes de tocar QA. El pipeline la define en la nocturna.
- La fixture restablece el reloj siempre al terminar.
- Se fija en la **hora actual** y no en una fecha lejana, para afectar solo reservas que empiezan en los próximos minutos.

> **Sobre "correr en paralelo":** la prueba de liberación no depende del orden ni de otras pruebas (crea sus propios datos y restablece el reloj) y se puede repetir. Lo que no puede es correr **al mismo tiempo que otra prueba que mueva el reloj**, porque `/test-support/reloj` cambia la hora de todo el backend. Serializar solo este grupo es lo que garantiza que no se afecten entre sí. Para paralelizarlas haría falta un reloj por contexto (por ejemplo, un encabezado por solicitud) o un backend con base de datos y reloj propios por worker; ninguno existe en el caso, así que queda como propuesta.

**5. La prueba de liberación tiene un grupo de control.**
Se crean dos reservas: una queda 1 minuto fuera de la ventana de check-in (debe pasar a `LIBERADA`) y otra queda dentro (debe seguir `ACTIVA`). Sin el control, un defecto que libere reservas antes de tiempo pasaría desapercibido. La de control tiene 2 minutos de margen por si el reloj del backend sigue avanzando después de fijarlo.

**6. La concurrencia se prueba enviando las solicitudes al mismo tiempo, varias veces.**
`Promise.all` envía dos solicitudes simultáneas; se espera exactamente `[201, 409]` (ordenados, porque no se sabe cuál gana): la aceptada debe quedar `ACTIVA` y la rechazada debe ser `LIMITE_RESERVAS`. Se repite con estudiantes nuevos (`INTENTOS_CONCURRENCIA`, 5 por defecto) porque una condición de carrera aparece con cierta probabilidad: si la prueba pasa no demuestra que no exista; si falla, hay que investigar las respuestas y los datos.

**7. Verificaciones exactas.**
Se verifican el código y el cuerpo esperados (`409` + `LIMITE_RESERVAS`; `201` + `id` + `ACTIVA`), no rangos como `< 500`. También se verifican las respuestas de test-support (crear usuario, eliminarlo y restablecer el reloj): si fallan, la prueba lo informa en vez de seguir en silencio.

**8. Reintentos y etiquetas.**
`retries: 0` en el PR (un reintento que pasa esconde fallos); `retries: 1` en la nocturna solo para que Playwright marque las pruebas como *flaky* y se investiguen. Las etiquetas `@pr` y `@nocturna` definen qué corre en cada momento. Reporte JUnit en `test-results/junit.xml` para Azure DevOps.

**9. Page Objects para la UI; la preparación se hace por API.**
`DetalleReservaPage` concentra los localizadores (`getByRole`, `getByTestId`). La prueba de UI crea la reserva por API y usa la pantalla solo para lo que quiere verificar. La sesión se inyecta con el token del usuario de prueba: no se automatiza la pantalla del SSO.

---

## Integración continua (Azure DevOps)

[azure-pipelines.yml](azure-pipelines.yml) se ejecuta de dos formas:

| Cuándo | Qué lo dispara | Qué corre |
|---|---|---|
| **Cada pull request** | Política de rama de `main` (*Build validation*), que bloquea el merge si falla | `npm run test:pr`: pruebas `@pr` de API y UI, sin reintentos, máximo 15 min |
| **Cada noche** (02:00 Bogotá) | `schedules` del pipeline | `npm run test:nocturna` con `QA_RELOJ_EXCLUSIVO=1` (ventana reservada): todo, incluido el reloj, con 1 reintento para detectar inestables |

En ambos casos publica los resultados JUnit en la pestaña *Tests* de Azure DevOps y guarda el reporte HTML con los traces, también cuando fallan. El pipeline está escrito con supuestos (nombre del pool y del grupo de variables); no se ejecutó porque no hay acceso a su Azure DevOps.

---

## Supuestos

| Tema | Supuesto |
|---|---|
| Usuarios de prueba | `POST /test-support/usuarios {rol}` responde `201` con `{id, email, rol, token}`; el token dura 60 min |
| Borrado | `DELETE /test-support/usuarios/{id}` responde 200/204 y elimina también sus reservas |
| Reloj | `POST /test-support/reloj {ahora}` acepta ISO 8601; `DELETE` lo restablece con 200/204; puede quedar congelado o seguir avanzando (la prueba tolera ambos) |
| Ventana exclusiva | El equipo reserva con QA una ventana para mover el reloj (la nocturna de las 02:00) |
| Autenticación API | `Authorization: Bearer <token>`; los endpoints de test-support están protegidos a nivel de ambiente (solo QA) |
| Autenticación UI | El frontend lee el token de `sessionStorage['reservas.token']` |
| Liberación | El proceso revisa todas las reservas en cada pasada |
| Espacios | QA tiene espacios dedicados a pruebas: `ESPACIOS_PRUEBA` (uno por worker) y `ESPACIO_RELOJ_A/B` |
| Horarios | Se puede reservar de 07:00 a 22:00, con anticipación de hasta ~60 días |
| UI | `data-testid="estado-reserva"`, botón "Cancelar reserva" y diálogo con "Confirmar"; la pantalla no se actualiza sola (si debiera actualizarse sola, la prueba no recargaría) |

---

## Limitaciones y siguientes pasos

- **Reloj global en un QA compartido:** incluso en la ventana exclusiva, mover el reloj puede afectar reservas que empiezan en los próximos minutos. Lo ideal es acordar con backend un reloj por contexto.
- **Ambiente del PR:** el ambiente debe tener desplegada la versión del PR; si QA tiene otra versión, no se valida el cambio. El pipeline todavía no despliega una versión temporal.
- **Pendientes:** prueba de notificaciones contra un buzón de prueba y lint con `eslint-plugin-playwright` (prohibir `waitForTimeout` y `test.only`).
