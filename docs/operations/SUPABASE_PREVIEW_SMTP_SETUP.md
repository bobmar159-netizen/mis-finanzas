# Supabase SMTP para Yarbi Preview

**Propósito:** recuperar el acceso por correo a la aplicación de Preview sin desactivar autenticación ni tocar Production.

## Destino que debe verificarse antes de guardar

- Proyecto Supabase Preview: ref `uevilhbstnmmdlgyshlv`.
- URL Preview: `https://uevilhbstnmmdlgyshlv.supabase.co`.
- Vercel Preview: proyecto `yarbi-preview-candidate-20261105`.
- No aplicar estos cambios a `misfinanzas-backend`, Production ni a otro proyecto.

Los datos anteriores identifican el destino previsto según el roadmap local; quien opere el Dashboard debe volver a comprobar el project ref en la URL y el encabezado del proyecto antes de cambiar ajustes.

## Antes de configurar

1. Elegir un proveedor transaccional que ofrezca SMTP y confirmar que el propietario controla la cuenta.
2. Crear una identidad de envío dedicada a autenticación, por ejemplo un remitente en un subdominio de auth. El dominio y la dirección concretos los define el propietario con el proveedor.
3. Completar en el proveedor la verificación de dominio y los registros SPF/DKIM; añadir DMARC según la política del dominio.
4. Obtener host, puerto, usuario, contraseña SMTP y dirección/nombre remitente directamente desde el panel del proveedor. No enviar estos valores a Codex, chat, tickets, código fuente, navegador ni variables frontend.
5. Mantener habilitada la confirmación de correo. No desactivar confirmaciones para esquivar el límite.

## Configuración en el Dashboard

1. Abrir Supabase Dashboard y seleccionar el proyecto cuyo ref sea exactamente `uevilhbstnmmdlgyshlv`.
2. Ir a **Authentication → Emails → SMTP Settings** (la etiqueta puede variar ligeramente en el Dashboard).
3. Activar el proveedor SMTP personalizado e introducir los datos entregados por el proveedor, directamente en el formulario seguro del Dashboard.
4. Guardar y comprobar que la configuración quede asociada solo a Preview.
5. Revisar **Authentication → URL Configuration**: la URL de sitio y la lista de redirect URLs deben permitir únicamente los orígenes Preview que realmente se usarán. Añadir el deployment URL temporal solo mientras se pruebe; no abrir comodines amplios ni incluir Production por comodidad.
6. Revisar **Authentication → Sign In / Providers** y conservar email OTP/magic link y confirmación habilitados.
7. No aumentar límites para ocultar reintentos repetidos. Con SMTP personalizado, Supabase documenta un límite inicial de 30 mensajes por hora; modificarlo solo si el proveedor y el caso de uso lo justifican.

## Prueba posterior, con un solo envío

1. Confirmar primero en Supabase que el proyecto seleccionado es Preview y que SMTP muestra estado habilitado, sin copiar secretos.
2. En Yarbi Preview solicitar un único enlace para la cuenta autorizada.
3. Comprobar la entrega en la bandeja y en los eventos del proveedor. No compartir el enlace ni OTP.
4. Abrir el enlace desde el mismo origen Preview que inició la solicitud. Comprobar que el callback vuelve a ese origen y que Cuenta de Yarbi indica sesión activa.
5. Solo después ejecutar las pruebas autenticadas de Gemini Live y File Search con el PDF sintético.
6. Si falla, conservar el código de error y hora; revisar eventos del proveedor y los logs de Auth del proyecto Preview. No solicitar enlaces en bucle.

## Criterios de seguridad y reversión

- No crear, usar ni asumir un usuario sintético como identidad del propietario.
- No copiar la clave SMTP a Vercel: Supabase Auth envía estos correos desde su propio servicio.
- No poner secretos en el cliente ni incluirlos en un APK.
- No modificar `external_email_enabled`, confirmaciones, usuarios, contraseñas, credenciales Gemini o ajustes de Production como atajo.
- Para revertir, desactivar el SMTP personalizado únicamente en el proyecto Preview y restaurar los ajustes de envío previos documentados por el propietario. No borrar usuarios ni sesiones como parte de la reversión.

## Referencias oficiales

- [Supabase: Send emails with custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase: Rate limits](https://supabase.com/docs/guides/auth/rate-limits)
- [Supabase: Test auth flows](https://supabase.com/docs/guides/auth/testing-auth-flows)
