import { APIResponse } from '@playwright/test';
import { test, expect } from '../../src/fixtures';

// Regla 1: un estudiante puede tener máximo 2 reservas activas al mismo tiempo. Los profesores no tienen límite.

async function esperarRechazoPorLimite(respuesta: APIResponse): Promise<void> {
  expect(respuesta.status(), await respuesta.text()).toBe(409);
  expect(await respuesta.json()).toMatchObject({ codigo: 'LIMITE_RESERVAS' });
}

test.describe('Regla 1: límite de reservas activas', { tag: ['@api', '@pr'] }, () => {
  test('un estudiante con 2 reservas activas no puede crear una tercera', async ({ estudiante, reservasDe, horarios }) => {
    const reservas = reservasDe(estudiante);
    await reservas.crearActiva(horarios.siguiente());
    await reservas.crearActiva(horarios.siguiente());

    const tercera = await reservas.crear(horarios.siguiente());

    await esperarRechazoPorLimite(tercera);
  });

  // Una condición de carrera no aparece siempre: se repite con estudiantes nuevos para aumentar
  // la probabilidad de detectarla. Pasar no demuestra que no exista; un fallo requiere investigar las respuestas y los datos.
  test('con 1 reserva activa, de dos solicitudes simultáneas solo se acepta una', async ({ crearUsuario, reservasDe, horarios }) => {
    const intentos = Number(process.env.INTENTOS_CONCURRENCIA ?? 5);

    expect(Number.isInteger(intentos) && intentos > 0, 'INTENTOS_CONCURRENCIA debe ser entero positivo').toBeTruthy();

    for (let intento = 1; intento <= intentos; intento++) {
      await test.step(`intento ${intento} de ${intentos}`, async () => {
        const reservas = reservasDe(await crearUsuario('ESTUDIANTE'));
        await reservas.crearActiva(horarios.siguiente());

        // Promise.all envía las dos solicitudes al mismo tiempo, sin esperar a que termine la primera.
        const [a, b] = await Promise.all([
          reservas.crear(horarios.siguiente()),
          reservas.crear(horarios.siguiente()),
        ]);

        // No sabemos cuál de las dos gana, así que ordenamos los códigos antes de comparar.
        const codigos = [a.status(), b.status()].sort();
        expect(codigos, 'Exactamente una de las dos solicitudes debe aceptarse').toEqual([201, 409]);
        const creada = await (a.status() === 201 ? a : b).json();
        expect(creada).toMatchObject({ estado: 'ACTIVA', id: expect.any(String) });
        expect(creada.id.trim()).not.toBe('');
        await esperarRechazoPorLimite(a.status() === 409 ? a : b);
      });
    }
  });
});
