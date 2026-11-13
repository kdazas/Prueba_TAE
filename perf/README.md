# Parte 3 – Prueba de carga de inicio de semestre

El diseño completo está en el documento de la prueba (Parte 3). Aquí está la versión ejecutable del diseño, [inicio-semestre.js](inicio-semestre.js), para k6. **No se ha ejecutado contra un ambiente real** y no se declara ninguna capacidad.

## Qué hace
- **Modelo abierto** (`ramping-arrival-rate`): llegan estudiantes por minuto aunque el sistema esté lento.
- **Perfil:** 0 → 600 llegadas/min en 1 min (pico de 10/s), 2 min de pico, desciende a 200/min en 3 min y termina en 3 min. **Exactamente 3.000 llegadas en 9 minutos.** El pico es un supuesto a validar con negocio.
- **Cada llegada es un estudiante distinto.** `setup()` detiene la prueba si hay menos estudiantes que llegadas.
- **Recorrido:** busca → piensa 3–8 s → intenta reservar. Solo reintenta ante `409 ESPACIO_OCUPADO` (máximo 3 intentos).
- **Clasificación de 409:** `ESPACIO_OCUPADO` es esperado; `LIMITE_RESERVAS` **no** (un estudiante nuevo no puede haber llegado al límite) y hace fallar la prueba.
- **Estrés:** `FACTOR=2` duplica las llegadas y exige el doble de estudiantes en los datos.

## Datos que hay que preparar
| Archivo | Contenido |
|---|---|
| `datos/estudiantes.json` | `[{ "id", "token" }]`, al menos 3.000 × FACTOR, creados con test-support. Tokens generados poco antes de la ejecución (duran 60 min) |
| `datos/espacios.json` | Los 4.500 espacios, ordenados de más a menos demandado |

Datos identificados por ejecución y limpieza verificable al terminar. **Auditoría final:** 0 espacios con reservas cruzadas y 0 estudiantes con más de 2 activas.

## Costos (cómo controlarlos)
- **Orden:** primero una corrida corta para validar datos y script; después la carga esperada; estrés o resistencia solo si hay una pregunta concreta que responder.
- **Recursos temporales:** QA representativo (3 réplicas, base de datos con 4.500 espacios) y generador de carga separado del agente compartido (VM o Azure Load Testing), creados solo para la ventana acordada e identificados por ejecución.
- **Presupuesto:** acordar el presupuesto, la duración máxima y un responsable antes de ejecutar. Estimar el costo del generador, las réplicas, la base de datos y la observabilidad según tarifas y duración; k6 no calcula la factura de Azure.
- **Apagado:** automático al terminar o al vencer el plazo, y revisión de recursos que hayan quedado encendidos. Una alerta de presupuesto **no** apaga recursos.
- **Integraciones:** Graph y correo con entornos de prueba o simulados, para no consumir cuotas ni enviar correos reales (simularlos no demuestra su capacidad).
- **Al cerrar:** comparar el costo estimado con el consumo real.

## Supuestos
- `GET /api/v1/espacios` existe (no está en el resumen de la API del caso).
- La API acepta fechas ISO 8601 con zona horaria `-05:00`.
