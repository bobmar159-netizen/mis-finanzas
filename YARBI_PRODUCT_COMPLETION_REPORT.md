# YARBI — Sprint de finalización funcional

Fecha: 2026-11-05  
Ámbito: `D:\YARBI_PRODUCT_COMPLETION_20261105` exclusivamente local.  
Resultado: **IMPLEMENTACIÓN LOCAL COMPLETADA CON PENDIENTES EXTERNOS EXPLÍCITOS**.

## Resultado funcional

Se implementaron mejoras reales y acotadas sobre el cerebro existente, sin sustituir V4 ni los módulos de memoria, CRM o WhatsApp personal.

| Área | Implementación | Estado |
|---|---|---|
| FAST_LOCAL | Resuelve FAQ operativas naturales de alta confianza (ayuda, búsqueda, entrenamiento, memoria) sin proveedor y con `execute:false`. Las referencias, correcciones y lenguaje no determinista continúan por V4/Gemini. | PASS local |
| Contexto y caché | Caché asíncrona efímera, con clave hasheada y scope por propietario/contacto; comparte lecturas simultáneas y expira en 15 segundos. La vinculación canónica de un mensaje a un contacto invalida las entradas que contienen ese contacto. | PASS local |
| Búsqueda de clientes | Buscador determinista reutilizable por propietario: nombre, teléfono parcial, distrito/dirección, servicio, instalación, historial, cotización, estado, pendientes, rasgos y fechas. Aplica normalización, sinónimos, ranking, filtros y deduplicación por `contact_id`. | PASS local |
| Conversación | Se conservan V4, continuidad, correcciones, negaciones y preguntas naturales existentes. FAST_LOCAL solo se activa en FAQ inequívocas; una búsqueda natural siguió usando el proveedor simulado y resolvió el cliente correcto. | PASS local |
| Memoria e instrucciones | Se reutilizan los entrypoints existentes de Instrucciones, Entrenar Yarbi y Memoria. La nueva superficie no guarda correcciones automáticamente ni crea una segunda memoria. | PASS local |
| WhatsApp personal | Se reutiliza P0.5: identidades HMAC autorizadas, conversación separada del CRM, idempotencia, audio acotado y `commercial_effects_allowed:false`. No se registró número ni se preparó ningún envío real. | PASS local |
| Interfaz | Se añadió un panel compacto **Funciones de Yarbi**: búsqueda local autorizada, entrada a Instrucciones, Entrenar Yarbi, Memoria y estado explícito de WhatsApp personal de prueba. No rediseña CRM, Agenda ni Bandeja. | PASS local |

## Archivos modificados o añadidos

- `lib/yarbi-fast-local.js`: FAQ conservadoras y respuesta rápida sin proveedor.
- `lib/yarbi-scoped-cache.js`: caché aislada, hash de claves, coalescencia e invalidación.
- `lib/yarbi-client-search.js`: motor de búsqueda enriquecida y owner-scoped.
- `lib/yarbi-owner-conversation.js`: integración de FAST_LOCAL antes del proveedor, sin cambiar la ruta V4 restante.
- `lib/yarbi-owner-reference-candidates.js`: caché posterior a la validación del scope canónico.
- `api/ai/process.js`: invalida entradas de candidatos al enlazar un mensaje canónico con su contacto.
- `frontend/yarbi-product-completion-ui.js`: panel visible y buscador local aislado.
- `frontend/index.html`: carga aditiva del panel antes de la Bandeja del propietario.
- `tests/product-completion.test.js`: pruebas sintéticas de FAQ, conversación, caché, búsqueda, UI y WhatsApp personal.
- `scripts/measure-product-completion-performance.cjs`: medición reproducible local.
- `dist/web/` y `dist/android-www/`: regenerados desde la única fuente `frontend/`.

## Pruebas ejecutadas

| Batería | Resultado |
|---|---:|
| FAST_LOCAL, conversación, candidatos, WhatsApp personal, entrenamiento, dossier y señales de Agenda | 45/45 PASS |
| Build web + Android y pruebas de frontend unificado/product completion | 9/9 PASS |
| Regresión ampliada CRM/Agenda/memoria/referencias | 72 PASS / 15 FAIL heredados |

Los 15 fallos de la batería ampliada están **demostrados como preexistentes**: la misma selección sobre `D:\YARBI_P06_STAGING_20261105` produjo exactamente 14 PASS / 15 FAIL. Incluyen pruebas que buscan `api/assistant/*` cuando el candidato P0.6 los reubicó en `api_handlers/assistant/*`, además de aserciones históricas de `yarbi-regression`. No se cambiaron routers, handlers validados ni pruebas para esconderlos.

## Rendimiento local sintético

Mismo fixture y consulta, 300 muestras; no mide red, Supabase, Vercel, cold starts ni Gemini.

| Ruta | p50 | p95 |
|---|---:|---:|
| Búsqueda directa sin caché | 1.9352 ms | 2.2300 ms |
| Búsqueda con caché caliente aislada | 0.0063 ms | 0.0146 ms |

Evidencia: `scripts/product-completion-performance.json`.

## Integridad y aislamiento

- El staging P0.6 no fue modificado: los 11/11 hashes P0.2I comprobados en `D:\YARBI_P06_STAGING_20261105` coincidieron.
- Los módulos V4 disponibles en ambos árboles (`yarbi-gemini-owner-understanding.js` y `yarbi-semantic-hardening.js`) coinciden byte a byte con el staging.
- No hay referencias literales a `https://misfinanzas-backend.vercel.app` en el nuevo `frontend/`.
- No hubo despliegue, Vercel, Supabase remoto, migraciones, APK, llamadas Gemini, WhatsApp, Notion, Calendar, Maps ni datos reales.
- La prueba de UI verifica que el panel no contiene `fetch` ni URL HTTP: solo consulta el índice local que ya esté disponible y exige propietario autenticado.

## Pendientes reales

1. Conectar el motor de búsqueda a una ruta server-side owner-scoped requiere una fase aparte con el contrato del índice remoto y, si corresponde, una migración de índices local propuesta; no se inventó un endpoint ni se consultó Supabase.
2. FAST_LOCAL evita llamadas únicamente para FAQ de alta confianza. La comprensión de clientes, seguimiento, correcciones y temporalidad sigue dependiendo del recorrido V4/Gemini cuando esté autorizado.
3. La activación de WhatsApp personal requiere aplicar y validar su migración propuesta en un entorno aislado, configurar un número dedicado y probar un proveedor; nada de ello se realizó.
4. Los 15 fallos heredados de empaquetado/pruebas P0.6 deben resolverse sin volver a exponer funciones físicas ni disfrazar la cobertura de routers.

## Cómo probar localmente

1. Desde esta carpeta, ejecutar `npm run build:frontend:web`.
2. Servir `dist/web/` con un servidor estático local y un backend mock de mismo origen; no abrirlo como Production.
3. Abrir la aplicación y pulsar **Funciones de Yarbi**. Las opciones de Instrucciones y Entrenar Yarbi reutilizan los modales existentes. La búsqueda devuelve solo registros locales con `owner_id` coincidente con el propietario autenticado disponible en runtime.
4. Para Android, definir un origen HTTPS aislado explícito y ejecutar `npm run build:frontend:android`; el build rechaza un origen ausente.

Los SHA-256 de artefactos nuevos y modificados constan en `YARBI_PRODUCT_COMPLETION_SHA256SUMS.txt`.
