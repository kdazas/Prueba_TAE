import { APIRequestContext, APIResponse, expect } from '@playwright/test';
import { EstadoReserva, Reserva, SolicitudReserva } from './types';
import { ESPERA_MAXIMA } from '../config/slas';

// Cliente de la API de reservas para UN usuario (usa su token en cada llamada).
export class ReservasApi {
  constructor(
    private readonly request: APIRequestContext,
    private readonly token: string,
  ) {}

  private get headers() {
    return { Authorization: `Bearer ${this.token}` };
  }

  // Devuelve la respuesta tal cual, para que la prueba pueda verificar 201 o 409.
  crear(solicitud: SolicitudReserva): Promise<APIResponse> {
    return this.request.post('/api/v1/reservas', { data: solicitud, headers: this.headers });
  }

  // Atajo para preparar datos: crea la reserva y exige que quede ACTIVA.
  async crearActiva(solicitud: SolicitudReserva): Promise<Reserva> {
    const respuesta = await this.crear(solicitud);
    expect(respuesta.status(), `No se pudo crear la reserva: ${await respuesta.text()}`).toBe(201);
    const reserva: Reserva = await respuesta.json();
    expect(reserva.id, 'La reserva creada debe tener un identificador').toEqual(expect.any(String));
    expect(reserva.id.length).toBeGreaterThan(0);
    expect(reserva.estado).toBe('ACTIVA');
    return reserva;
  }

  async obtenerEstado(id: string): Promise<EstadoReserva> {
    const respuesta = await this.request.get(`/api/v1/reservas/${id}`, { headers: this.headers });
    expect(respuesta.status()).toBe(200);
    const reserva: Reserva = await respuesta.json();
    return reserva.estado;
  }

  cancelar(id: string): Promise<APIResponse> {
    return this.request.delete(`/api/v1/reservas/${id}`, { headers: this.headers });
  }

  checkin(id: string): Promise<APIResponse> {
    return this.request.post(`/api/v1/reservas/${id}/checkin`, { headers: this.headers });
  }

  // Espera una condición de negocio en vez de un tiempo fijo (solución del Fallo A):
  // consulta el estado varias veces y termina apenas llega al esperado.
  async esperarEstado(id: string, esperado: EstadoReserva, timeoutMs: number): Promise<void> {
    await expect
      .poll(() => this.obtenerEstado(id), {
        message: `La reserva ${id} no llegó a ${esperado} en ${timeoutMs} ms`,
        timeout: timeoutMs,
        intervals: [500, 1_000, 2_000],
      })
      .toBe(esperado);
  }

  // Cancela y espera a que la cola la procese (regla 4: la API responde 202 y el estado cambia después).
  async cancelarYEsperar(id: string): Promise<void> {
    const respuesta = await this.cancelar(id);
    expect(respuesta.status()).toBe(202);
    await this.esperarEstado(id, 'CANCELADA', ESPERA_MAXIMA.cancelacionMs);
  }
}
