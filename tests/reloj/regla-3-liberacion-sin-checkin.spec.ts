import { test, expect } from '../../src/fixtures';
import { ESPERA_MAXIMA, SLA } from '../../src/config/slas';
import { SolicitudReserva } from '../../src/api/types';

// Regla 3: si no se hace check-in dentro de los 15 minutos siguientes al inicio, la reserva se libera.
// La liberación la hace un proceso del backend que corre cada minuto.
//
// En vez de esperar 15 minutos reales, movemos el reloj del backend con /test-support/reloj.
// SUPUESTO: QA tiene dos espacios reservados para estas pruebas. Como el proyecto "reloj" corre
// con un solo worker y en una ventana exclusiva, no hay otra prueba usándolos al mismo tiempo.
const ESPACIO_A = process.env.ESPACIO_RELOJ_A ?? 'PRUEBA-RELOJ-A';
const ESPACIO_B = process.env.ESPACIO_RELOJ_B ?? 'PRUEBA-RELOJ-B';

function sumarMinutos(fecha: Date, minutos: number): Date {
  return new Date(fecha.getTime() + minutos * 60_000);
}

function reservaDeUnaHora(espacioId: string, inicio: Date): SolicitudReserva {
  return { espacioId, inicio: inicio.toISOString(), fin: sumarMinutos(inicio, 60).toISOString() };
}

test.describe('Regla 3: liberación automática sin check-in', { tag: ['@api', '@reloj', '@nocturna'] }, () => {
  // `reloj` va primero: así su verificación de ventana exclusiva ocurre antes de tocar QA.
  test('se libera la reserva sin check-in pasados 15 minutos, y no la que sigue dentro de la ventana', async ({
    reloj,
    estudiante,
    reservasDe,
  }) => {
    const reservas = reservasDe(estudiante);

    // Partimos de la hora actual (no de una fecha lejana): así solo se afectan reservas que empiezan
    // en los próximos minutos. Aun así, mover el reloj global afecta a QA: por eso la ventana exclusiva.
    const t0 = new Date();
    t0.setSeconds(0, 0);
    await reloj.fijar(t0);

    const inicioA = sumarMinutos(t0, 10);
    const inicioB = sumarMinutos(t0, 13);
    const reservaA = await reservas.crearActiva(reservaDeUnaHora(ESPACIO_A, inicioA));
    const reservaB = await reservas.crearActiva(reservaDeUnaHora(ESPACIO_B, inicioB));

    // Nueva hora = inicio de A + 16 min.
    // A queda 1 min FUERA de la ventana; B queda en el minuto 13, DENTRO de la ventana.
    // B tiene 2 min de margen por si el reloj del backend sigue avanzando mientras esperamos.
    await reloj.fijar(sumarMinutos(inicioA, SLA.ventanaCheckinMin + 1));

    await test.step('la reserva fuera de la ventana pasa a LIBERADA', async () => {
      await reservas.esperarEstado(reservaA.id, 'LIBERADA', ESPERA_MAXIMA.liberacionMs);
    });

    await test.step('la reserva dentro de la ventana sigue ACTIVA (grupo de control)', async () => {
      // Si A ya se liberó, el proceso corrió con la nueva hora: si B hubiera debido liberarse, ya lo estaría.
      expect(await reservas.obtenerEstado(reservaB.id)).toBe('ACTIVA');
    });

    await test.step('el check-in se rechaza en la liberada y se acepta en la que sigue activa', async () => {
      expect((await reservas.checkin(reservaA.id)).status()).toBe(422);
      expect((await reservas.checkin(reservaB.id)).status()).toBe(200);
    });
  });
});
