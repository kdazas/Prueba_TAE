import 'dotenv/config';

// Toda la configuración sale de variables de entorno (.env en local, variables del pipeline en CI).
// Así no hay URLs ni credenciales escritas dentro de las pruebas.
export const env = {
  testEnv: process.env.TEST_ENV ?? 'qa',
  baseUrl: process.env.BASE_URL ?? 'http://localhost:4200',
  apiUrl: process.env.API_URL ?? 'http://localhost:8000',
};

// Los endpoints /test-support solo existen en QA. Este guardián evita llamarlos por error en otro ambiente.
export function asegurarAmbienteQA(): void {
  if (env.testEnv !== 'qa') {
    throw new Error(`Los endpoints test-support solo existen en QA (TEST_ENV=${env.testEnv})`);
  }
}

