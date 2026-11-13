import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';
import { ESPACIOS_PRUEBA } from './src/data/horarios';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Sin reintentos en el PR: un reintento que pasa esconde fallos reales.
  // En la nocturna se usa 1 reintento solo para DETECTAR pruebas inestables (quedan marcadas como "flaky").
  retries: process.env.EJECUCION === 'nocturna' ? 1 : 0,
  // Un espacio de prueba por worker: así dos pruebas en paralelo nunca reservan el mismo espacio.
  workers: ESPACIOS_PRUEBA.length,
  reporter: [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]],
  use: {
    baseURL: process.env.BASE_URL,
    // En la demo con el mock se guarda el trace de todas las pruebas, para poder mostrar cada llamada.
    trace: process.env.MOCK ? 'on' : 'retain-on-failure',
  },
  // Solo para la demostración local: con MOCK=1 Playwright levanta el mock de la API antes de las pruebas.
  webServer: process.env.MOCK === '1'
    ? {
        command: 'node mock-api/servidor.mjs',
        url: 'http://localhost:8000/salud',
        reuseExistingServer: !process.env.CI,
        env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('BUG_') || k === 'LIBERACION_CADA_MS')) as Record<string, string>,
      }
    : undefined,
  projects: [
    // Pruebas de API: en paralelo, sin navegador.
    { name: 'api', testDir: './tests/api' },

    // Pruebas de pantalla.
    { name: 'ui', testDir: './tests/ui', use: { ...devices['Desktop Chrome'] } },

    // Pruebas que mueven el reloj del backend. El reloj es GLOBAL, así que:
    // - corren de a una (workers: 1)
    // - empiezan cuando terminaron las demás (dependencies), para no alterar su hora
    // - timeout de 120 s: la liberación puede tardar hasta 90 s (el proceso corre cada minuto)
    //   y el timeout por defecto de Playwright (30 s) la cortaría
    { name: 'reloj', testDir: './tests/reloj', timeout: 120_000, workers: 1, dependencies: ['api', 'ui'] },
  ],
});
