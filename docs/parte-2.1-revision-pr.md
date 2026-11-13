# Parte 2.1 – Revisión del pull request generado con IA

**Veredicto: ❌ Solicito cambios. No aprobaría este PR.**

El problema de fondo no es de estilo: **varias pruebas no pueden fallar o no prueban la regla que dicen probar**. Si se integran, el equipo creería que el límite de reservas, la liberación y las notificaciones están cubiertos cuando no lo están. Una prueba que siempre da verde es peor que no tener prueba, porque da confianza falsa.

Gravedad: 🔴 Bloqueante · 🟠 Alta · 🟡 Media

---

## 🔴 Bloqueantes

### 1. Credenciales escritas en el código
- **Qué:** `USER` y `PASS` están en el archivo de pruebas, con un dominio institucional real.
- **Por qué importa:** al hacer commit quedan en el historial de git aunque se borren después. Cualquiera con acceso al repositorio las ve.
- **Corrección:** si las credenciales fueran reales, revocarlas o rotarlas; el ejemplo del enunciado no demuestra una exposición real. Usar usuarios creados con `POST /api/v1/test-support/usuarios`; si se necesita algún secreto, debe venir de las variables secretas del pipeline o de Key Vault, nunca del código.

### 2. La prueba de liberación nunca puede fallar
- **Qué:** el `expect` está dentro de un `try/catch` que atrapa el error y solo hace `console.log`.
- **Por qué importa:** si la reserva nunca se libera, la prueba igual queda en **verde**.
- **Corrección:** quitar el `try/catch`. Si el estado no es el esperado, la prueba debe fallar.

### 3. "Crear tres reservas" no verifica la regla (mal oráculo)
- **Qué:** `expect(res.status()).toBeLessThan(500)` acepta 201, 400, 401 y 409. Además, la petición no envía token.
- **Por qué importa:** si la regla está rota y acepta la tercera reserva (201), la prueba pasa. Si no hay sesión y todo responde 401, también pasa. No distingue el resultado correcto del incorrecto.
- **Corrección:** autenticar con un estudiante creado para la prueba y verificar exactamente `201`, `201` y `409` con `codigo: "LIMITE_RESERVAS"`.

### 4. La prueba de notificación simula lo que dice probar
- **Qué:** `page.route(...).fulfill({ enviado: true })` responde con un mock la llamada de notificaciones.
- **Por qué importa:** si el servicio de correo está caído, la prueba sigue pasando. Además, según la regla 5, **el correo lo envía el backend**, no el navegador, y el endpoint `/api/v1/notificaciones` **no está documentado en el resumen de la API**: parece inventado por la IA. Es posible que el mock nunca se active y que el texto "Notificación enviada" aparezca de todos modos.
- **Corrección:** verificar la notificación en un buzón de prueba de QA o mediante un endpoint de test-support acordado con backend, en la ejecución nocturna. Los mocks sirven para aislar la pantalla de un servicio externo, no para verificar ese servicio.

### 5. La prueba de liberación no prueba la regla
- **Qué:** espera 15 minutos reales desde que **empieza la prueba**, pero la regla cuenta 15 minutos desde la **hora de inicio de la reserva** (que es el 20 de noviembre). Además, el proceso de liberación corre cada minuto, así que a los 15:00 exactos puede no haber corrido, y la página no se recarga antes de leer el estado.
- **Por qué importa:** la prueba no ejercita la regla 3; suma 15 minutos a la suite y es inestable por diseño. Es la razón del `timeout` de 20 minutos.
- **Corrección:** usar `POST /api/v1/test-support/reloj` para fijar la hora del backend en "inicio + 16 min" y consultar el estado por API hasta que sea `LIBERADA`, con un máximo de ~90 s. Restablecer el reloj al terminar, aunque la prueba falle. Como el reloj es global, ejecutarla en un grupo separado, en serie y en una ventana exclusiva de QA. Con un reloj por contexto (p. ej., un encabezado por solicitud) podría correr en paralelo.

### 6. Las pruebas dependen unas de otras
- **Qué:** `let reservaId` se declara fuera de las pruebas; la de liberación usa el valor de "crear tres reservas". Además, la sesión del test `login` no pasa a las demás: cada prueba recibe un contexto de navegador aislado y sin la sesión anterior.
- **Por qué importa:** si se ejecuta una prueba sola, en otro orden o en paralelo, falla. Si la tercera reserva responde 409, no trae `id` y `reservaId` queda `undefined`.
- **Corrección:** cada prueba crea sus propios datos (usuario, reserva) mediante fixtures que también los limpian. La sesión se prepara con un token fresco por prueba, no en un test de login.

---

## 🟠 Altas

### 7. La configuración oculta problemas
- `retries: 3`: una prueba que falla tres veces y pasa a la cuarta sale verde; un defecto intermitente (p. ej. una condición de carrera en el límite) quedaría oculto. → `retries: 0` en el PR; `retries: 1` en la nocturna solo para **detectar** pruebas inestables.
- `workers: 1`: esconde la dependencia entre pruebas y el uso de datos compartidos (el Fallo B de la Parte 4 no aparecería) y hace todo más lento. → Varios workers con `fullyParallel: true`.
- `timeout: 20 min` por prueba: una prueba colgada bloquea el único agente de CI durante 20 minutos. → 30 s para las pruebas rápidas y 120 s para liberación, cuyo polling admite 90 s.

### 8. Datos fijos y un error en las fechas
- **Qué:** siempre `ML-512` el `2026-11-20`, sin zona horaria. El texto `` `T0${8 + i}:00` `` genera `T010:00` cuando `i = 2` (y `fin` lo genera desde `i = 1`), que no es una hora válida.
- **Por qué importa:** la tercera reserva puede rechazarse por formato y no por el límite (y la prueba pasa igual por el punto 3). En la segunda ejecución los horarios ya están ocupados (409 `ESPACIO_OCUPADO`), y después del 20 de noviembre la fecha queda en el pasado. Sin zona horaria, 08:00 puede interpretarse como UTC (03:00 en Bogotá).
- **Corrección:** generar fechas futuras relativas a hoy, con zona `-05:00`, y horarios únicos por prueba.

### 9. Automatiza la pantalla del SSO institucional
- **Qué:** la prueba `login` escribe usuario y contraseña en la pantalla de inicio de sesión.
- **Por qué importa:** depende del SSO externo además de nuestra integración; puede pedir MFA o captcha. Es el mismo patrón del módulo Login actual: 22 % de ejecuciones con falla y 0 defectos.
- **Corrección:** las pruebas se autentican con un token; solo una prueba de humo usa el SSO real antes de salir a producción.

### 10. Cancela "la primera reserva que aparezca"
- **Qué:** `getByRole('button', { name: 'Cancelar' }).first()`.
- **Por qué importa:** el resultado depende de los datos que haya en QA; si la lista está vacía falla, y en paralelo puede cancelar la reserva de otra prueba. Tampoco verifica que la reserva quedó `CANCELADA` (la cancelación es asíncrona).
- **Corrección:** crear la reserva propia por API, cancelar **esa** y esperar el estado `CANCELADA` con un presupuesto de prueba inicial de 15 s; los 10 s habituales no son un SLA acordado.

---

## 🟡 Medias

11. **Localizadores frágiles:** `//div[2]/form/div[1]/input`, `.badge` y `text=Ingresar` se rompen con cualquier cambio de diseño. → `getByLabel`, `getByRole`, `getByTestId('estado-reserva')`.
12. **Esperas fijas:** `waitForTimeout(5000)` es lento cuando sobra e inestable cuando falta. → Esperar una condición, p. ej. `await expect(page).toHaveURL(/mis-reservas/)`.
13. **Lectura sin espera automática:** `textContent()` lee una sola vez. → `await expect(locator).toHaveText('Liberada')`.
14. **URL completa en la prueba:** → `baseURL` en la configuración y rutas relativas.
15. **Nombres que describen la acción y no la regla:** "crear tres reservas" → "un estudiante no puede tener más de 2 reservas activas".

---

## Mensaje para la persona que abrió el PR

> Gracias por avanzar con esto; usar IA para acelerar está bien y lo vamos a seguir haciendo. El problema es que el código **se ve** correcto pero varias pruebas no pueden fallar, y eso es difícil de notar si no se revisa con cuidado. Para la próxima te propongo:
>
> 1. **Darle contexto a la IA:** las reglas de negocio, el contrato de la API y las convenciones del framework (fixtures, usuario por prueba). Sin eso inventa cosas, como el endpoint de notificaciones.
> 2. **Pedirle que liste sus supuestos** y verificarlos contra el contrato.
> 3. **Hacer fallar cada prueba a propósito** antes de abrir el PR: cambiar el valor esperado o romper la regla. Si sigue en verde, la prueba no sirve.
> 4. **Correrlas en paralelo y repetidas** (`--workers=4 --repeat-each=5`) para descubrir dependencias y datos compartidos.
> 5. **Nunca poner credenciales en el código ni pegarlas en la IA.**
>
> Lo que entra al repositorio es responsabilidad de quien lo sube, no de la herramienta. Si quieres, lo corregimos juntos.
