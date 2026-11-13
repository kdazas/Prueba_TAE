// Tiempos del caso. El nombre SLA se conserva por compatibilidad: cancelación es un tiempo habitual, no un SLA acordado.
// Si una regla cambia, se cambia aquí y no en cada prueba.
export const SLA = {
  cancelacionMs: 10_000,     // Regla 4: la cancelación se procesa normalmente en menos de 10 s
  ventanaCheckinMin: 15,     // Regla 3: 15 minutos para hacer check-in
  cicloLiberacionMs: 60_000, // Regla 3: el proceso de liberación corre cada minuto
};

// Presupuestos de espera de las pruebas. Superarlos exige investigar la causa;
// no demuestra por sí solo un defecto de rendimiento.
export const ESPERA_MAXIMA = {
  cancelacionMs: SLA.cancelacionMs + 5_000,
  liberacionMs: SLA.cicloLiberacionMs + 30_000,
};
