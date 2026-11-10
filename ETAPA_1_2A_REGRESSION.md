# Regresión y builds — Etapa 1.2A

## Builds reproducibles locales

| Comando | Resultado |
| --- | --- |
| `npm run build:frontend:web` | BUILD_OK |
| `YARBI_ANDROID_API_ORIGIN=https://yarbi-preview.invalid; npm run build:frontend:android` | BUILD_OK |
| `npm run test:frontend:unified` | 4 PASS |

El build no realizó despliegues ni llamadas de red. La variable Android fue un origen HTTPS sintético local; no contiene credenciales ni apunta a Production.

## Cambios generados

El build Web actualizó el identificador de release de `runtime-config.js` y `service-worker.js`; esos cambios acompañan a la fuente para que la caché no sirva una versión previa del módulo actualizado.

## Límites

No se hizo prueba física Android, ni prueba multi-pestaña. Esas comprobaciones siguen asignadas a 1.2C y 1.2B respectivamente.
