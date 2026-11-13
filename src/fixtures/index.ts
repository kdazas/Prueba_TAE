import { APIRequestContext, test as base, expect } from '@playwright/test';
import { env, asegurarAmbienteQA } from '../config/env';
import { ReservasApi } from '../api/ReservasApi';
import { TestSupportApi } from '../api/TestSupportApi';
import { Rol, UsuarioPrueba } from '../api/types';
import { GeneradorHorarios } from '../data/horarios';

type Fixtures = {
  api: APIRequestContext;
  testSupport: TestSupportApi;
  crearUsuario: (rol: Rol) => Promise<UsuarioPrueba>;
  estudiante: UsuarioPrueba;
  profesor: UsuarioPrueba;
  reservasDe: (usuario: UsuarioPrueba) => ReservasApi;
  horarios: GeneradorHorarios;
  reloj: { fijar: (ahora: Date) => Promise<void> };
};

export const test = base.extend<Fixtures>({
  // Cliente HTTP apuntando a la API.
  api: async ({ playwright }, use) => {
    const contexto = await playwright.request.newContext({ baseURL: env.apiUrl });
    await use(contexto);
    await contexto.dispose();
  },

  testSupport: async ({ api }, use) => {
    asegurarAmbienteQA();
    await use(new TestSupportApi(api));
  },

  // Crea usuarios nuevos para la prueba y los elimina al final, AUNQUE la prueba falle
  // (lo que va después de use() corre siempre). Cada usuario trae su propio token:
  // resuelve la cuenta compartida (Fallo B) y el token vencido (Fallo C).
  // allSettled: si falla el borrado de un usuario, igual intenta borrar los demás y luego avisa.
  crearUsuario: async ({ testSupport }, use) => {
    const creados: UsuarioPrueba[] = [];
    await use(async (rol) => {
      const usuario = await testSupport.crearUsuario(rol);
      creados.push(usuario);
      return usuario;
    });
    const resultados = await Promise.allSettled(creados.map((usuario) => testSupport.eliminarUsuario(usuario.id)));
    const fallos = resultados.flatMap((resultado, i) =>
      resultado.status === 'rejected' ? [`${creados[i].id}: ${String(resultado.reason)}`] : [],
    );
    if (fallos.length) throw new Error(`Falló la limpieza de usuarios: ${fallos.join('; ')}`);
  },

  // Atajo para el caso más común: un estudiante nuevo.
  estudiante: async ({ crearUsuario }, use) => {
    await use(await crearUsuario('ESTUDIANTE'));
  },

  profesor: async ({ crearUsuario }, use) => {
    await use(await crearUsuario('PROFESOR'));
  },

  // Devuelve el cliente de reservas con el token del usuario indicado.
  reservasDe: async ({ api }, use) => {
    await use((usuario) => new ReservasApi(api, usuario.token));
  },

  // Horarios sin choques con otras pruebas que corren en paralelo.
  horarios: async ({}, use, testInfo) => {
    await use(new GeneradorHorarios(testInfo.parallelIndex));
  },

  // Controla la hora del backend de QA. El reloj es GLOBAL: moverlo afecta a todo QA.
  // Por eso, fuera del mock, solo se permite si el equipo reservó una ventana exclusiva
  // (QA_RELOJ_EXCLUSIVO=1, la define la ejecución nocturna). Al terminar SIEMPRE restablece la hora.
  reloj: async ({ testSupport }, use) => {
    if (process.env.MOCK !== '1' && process.env.QA_RELOJ_EXCLUSIVO !== '1') {
      throw new Error('Mover el reloj global de QA requiere una ventana exclusiva reservada: defina QA_RELOJ_EXCLUSIVO=1');
    }
    await use({ fijar: (ahora) => testSupport.fijarReloj(ahora) });
    await testSupport.restablecerReloj();
  },
});

export { expect };
