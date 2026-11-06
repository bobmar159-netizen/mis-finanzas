# YARBI — F04: Preview aislado de lectura financiera

**Estado:** `PREVIEW_AISLADO_DESPLEGADO — VALIDACIÓN FUNCIONAL AUTENTICADA PENDIENTE`

## Deployment verificado

- Proyecto Vercel aislado: `yarbi-preview-candidate-20261105` (`prj_XLJfUU1Kbz921OtThefimBy3XQIJ`).
- Deployment Preview: `dpl_DHs2k3aLKSvpH71QRMiTHEPpV8nU`.
- URL: `https://yarbi-preview-candidate-20261105-m5aiw4gk9-omar-dfc4.vercel.app`.
- Estado observado por catálogo de Vercel: `READY`.
- Entorno observado: Preview (`target: null`); no es un deployment Production y no tiene alias público.
- Proyecto Supabase configurado para este Preview: el conjunto de variables de Preview contiene las referencias requeridas para el proyecto aislado. Los valores no se leyeron ni se registraron.

## Alcance verificado

- Se desplegó el candidato de F04 con la lectura financiera del expediente, sin activar importación real de Notion ni escrituras de cobranzas.
- No se ejecutó autenticación, no se consultaron contactos, movimientos, Agenda ni datos personales.
- No se realizaron llamadas a Supabase, Gemini, Notion, WhatsApp, Meta, Calendar ni otros proveedores desde las pruebas de esta anotación.
- No hubo cambios en `misfinanzas-backend`, sus alias, su deployment Production ni su configuración.

## Limitaciones y siguiente comprobación

- El estado de configuración se comprobó por presencia de claves de Preview, no por descifrado de valores: la correspondencia exacta de URL, referencia y secretos sigue `NOT PROVEN` desde el deployment.
- La funcionalidad CRM/finanzas debe verificarse con un usuario y fixtures sintéticos autenticados antes de declarar el Preview funcional.
- El CLI de Vercel creó un bypass temporal de Automation Protection al realizar la verificación técnica. Debe revocarse desde la configuración de protección del **proyecto aislado** antes de continuar con pruebas de acceso. No se conserva ni se imprime su secreto.

## Producción

`MisFinanzasPro`, Supabase Production, Vercel Production, APK y los servicios comerciales permanecen sin cambios.
