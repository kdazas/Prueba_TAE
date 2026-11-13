import { Locator, Page, expect } from '@playwright/test';

// Page Object de la pantalla de detalle de una reserva.
// Las pruebas hablan en términos de negocio ("cancelar", "estado") y los localizadores viven solo aquí:
// si cambia la pantalla, se corrige en un solo lugar.
// SUPUESTOS: la pantalla expone data-testid="estado-reserva" (el mismo del Fallo A), un botón
// "Cancelar reserva" y un diálogo de confirmación con el botón "Confirmar".
export class DetalleReservaPage {
  readonly estado: Locator;
  private readonly botonCancelar: Locator;
  private readonly botonConfirmar: Locator;

  constructor(private readonly page: Page) {
    this.estado = page.getByTestId('estado-reserva');
    this.botonCancelar = page.getByRole('button', { name: 'Cancelar reserva' });
    this.botonConfirmar = page.getByRole('dialog').getByRole('button', { name: 'Confirmar' });
  }

  // SUPUESTO: el frontend lee el token de sessionStorage. Así no se automatiza la pantalla del SSO.
  async iniciarSesionConToken(token: string): Promise<void> {
    await this.page.addInitScript((t) => window.sessionStorage.setItem('reservas.token', t), token);
  }

  async abrir(reservaId: string): Promise<void> {
    await this.page.goto(`/reservas/${reservaId}`);
    await expect(this.estado).toBeVisible();
  }

  async cancelar(): Promise<void> {
    await this.botonCancelar.click();
    await this.botonConfirmar.click();
  }

  async recargar(): Promise<void> {
    await this.page.reload();
  }
}
