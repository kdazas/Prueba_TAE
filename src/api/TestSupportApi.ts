import { APIRequestContext, expect } from '@playwright/test';
import { Rol, UsuarioPrueba } from './types';

// Cliente de los endpoints que SOLO existen en QA.
// SUPUESTOS: crear usuario devuelve 201 con su token; eliminar es DELETE /usuarios/{id}
// y borra también sus reservas; el reloj recibe la hora en formato ISO 8601.
export class TestSupportApi {
  constructor(private readonly request: APIRequestContext) {}

  async crearUsuario(rol: Rol): Promise<UsuarioPrueba> {
    const respuesta = await this.request.post('/api/v1/test-support/usuarios', { data: { rol } });
    expect(respuesta.status(), `No se pudo crear el usuario de prueba: ${await respuesta.text()}`).toBe(201);
    const usuario: UsuarioPrueba = await respuesta.json();
    expect(usuario.id, 'Identificador de usuario de prueba').toEqual(expect.any(String));
    expect(usuario.id.length).toBeGreaterThan(0);
    expect(usuario.token, 'Token de usuario de prueba').toEqual(expect.any(String));
    expect(usuario.token.length).toBeGreaterThan(0);
    expect(usuario.rol).toBe(rol);
    return usuario;
  }

  async eliminarUsuario(id: string): Promise<void> {
    const respuesta = await this.request.delete(`/api/v1/test-support/usuarios/${id}`);
    // Supuesto: eliminación síncrona 200/204; 202 requiere seguimiento adicional.
    expect([200, 204], `No se pudo eliminar el usuario ${id}: ${await respuesta.text()}`).toContain(respuesta.status());
  }

  async fijarReloj(ahora: Date): Promise<void> {
    const respuesta = await this.request.post('/api/v1/test-support/reloj', {
      data: { ahora: ahora.toISOString() },
    });
    expect(respuesta.ok(), `No se pudo fijar el reloj: ${await respuesta.text()}`).toBeTruthy();
  }

  async restablecerReloj(): Promise<void> {
    const respuesta = await this.request.delete('/api/v1/test-support/reloj');
    expect([200, 204], `No se pudo restablecer el reloj: ${await respuesta.text()}`).toContain(respuesta.status());
  }
}
