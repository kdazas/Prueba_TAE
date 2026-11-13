import { SolicitudReserva } from '../api/types';

// SUPUESTO: en QA hay espacios dedicados a pruebas automatizadas, uno por worker.
export const ESPACIOS_PRUEBA = (process.env.ESPACIOS_PRUEBA ?? 'PRUEBA-01,PRUEBA-02,PRUEBA-03,PRUEBA-04').split(',');

// Distribuye horarios dentro de una ejecución:
// - Cada worker usa su propio espacio (parallelIndex es único entre los workers que corren a la vez).
// - El día futuro aleatorio reduce coincidencias; no reemplaza el aislamiento entre ejecuciones.
export class GeneradorHorarios {
  readonly espacioId: string;
  private dia: Date;
  private siguienteHora = 7;

  constructor(parallelIndex: number) {
    if (parallelIndex >= ESPACIOS_PRUEBA.length) {
      throw new Error(`Hay ${ESPACIOS_PRUEBA.length} espacios de prueba para ${parallelIndex + 1} workers`);
    }
    this.espacioId = ESPACIOS_PRUEBA[parallelIndex];
    this.dia = new Date();
    this.dia.setUTCDate(this.dia.getUTCDate() + 2 + Math.floor(Math.random() * 50));
  }

  // Cada llamada devuelve la hora siguiente: 07:00-08:00, 08:00-09:00, ...
  // SUPUESTO: se puede reservar de 07:00 a 22:00; al llegar al final del día pasa al día siguiente.
  siguiente(): SolicitudReserva {
    if (this.siguienteHora + 1 > 22) {
      this.dia = new Date(this.dia.getTime() + 24 * 60 * 60 * 1000);
      this.siguienteHora = 7;
    }
    const solicitud = {
      espacioId: this.espacioId,
      inicio: this.horaBogota(this.siguienteHora),
      fin: this.horaBogota(this.siguienteHora + 1),
    };
    this.siguienteHora++;
    return solicitud;
  }

  // Formato ISO con zona horaria de Bogotá. padStart evita el error "T010:00" del PR revisado.
  private horaBogota(hora: number): string {
    const fecha = this.dia.toISOString().slice(0, 10); // AAAA-MM-DD
    return `${fecha}T${String(hora).padStart(2, '0')}:00:00-05:00`;
  }
}
