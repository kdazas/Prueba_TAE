// Forma de los datos según el resumen de la API del caso.

export type EstadoReserva = 'ACTIVA' | 'CANCELADA' | 'LIBERADA' | 'CUMPLIDA';

export type Rol = 'ESTUDIANTE' | 'PROFESOR';

export interface SolicitudReserva {
  espacioId: string;
  inicio: string; // ISO 8601 con zona horaria, ej. 2026-11-20T08:00:00-05:00
  fin: string;
}

export interface Reserva {
  id: string;
  estado: EstadoReserva;
}

export interface ErrorNegocio {
  codigo: 'LIMITE_RESERVAS' | 'ESPACIO_OCUPADO';
}

// SUPUESTO: POST /test-support/usuarios devuelve el usuario creado con un token válido por 60 min.
export interface UsuarioPrueba {
  id: string;
  email: string;
  rol: Rol;
  token: string;
}
