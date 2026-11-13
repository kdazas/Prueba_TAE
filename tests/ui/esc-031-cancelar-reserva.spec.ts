import { test, expect } from '../../src/fixtures';
import { DetalleReservaPage } from '../../src/pages/DetalleReservaPage';
import { ESPERA_MAXIMA } from '../../src/config/slas';

// [ESC-031] Estudiante cancela una reserva – versión corregida de la prueba inestable de la Parte 4.
// - Fallo A: no se espera un tiempo fijo; se espera el estado CANCELADA con un presupuesto de espera explícito.
// - Fallo B: usuario propio para esta prueba (no la cuenta compartida).
// - Fallo C: token nuevo para esta prueba (no un storageState creado al inicio de la ejecución).
test.describe('[ESC-031] Cancelación de reserva desde la pantalla', { tag: ['@ui', '@pr'] }, () => {
  test('el estudiante cancela su reserva y la pantalla muestra "Cancelada"', async ({ page, estudiante, reservasDe, horarios }) => {
    // Preparación por API: rápida y sin depender de otras pantallas.
    const reservas = reservasDe(estudiante);
    const reserva = await reservas.crearActiva(horarios.siguiente());

    const detalle = new DetalleReservaPage(page);
    await detalle.iniciarSesionConToken(estudiante.token);
    await detalle.abrir(reserva.id);
    await expect(detalle.estado).toHaveText('Activa');

    await detalle.cancelar();

    // La cancelación es asíncrona (regla 4): primero se confirma en el backend…
    await reservas.esperarEstado(reserva.id, 'CANCELADA', ESPERA_MAXIMA.cancelacionMs);
    // …y luego se verifica lo que ve el usuario. SUPUESTO: la pantalla no se actualiza sola.
    await detalle.recargar();
    await expect(detalle.estado).toHaveText('Cancelada');
  });
});
