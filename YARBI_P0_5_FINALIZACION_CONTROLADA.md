# YARBI P0.5 — Finalización controlada

Fecha: 2026-11-05  
Alcance ejecutado: exclusivamente local. Resultado: **P0.5 COMPLETADA LOCALMENTE CON BLOQUEOS EXPLÍCITOS PARA PREVIEW/PRODUCCIÓN**.

## Resultado

P0.5 deja una base local y reversible para el contacto personal de Yarbi, sin crear un segundo agente ni mezclarlo con CRM comercial. Se preservó la fuente canónica P0.2I y la estabilización P0.3.1. No se desplegó, no se conectó Supabase remoto, no se ejecutaron migraciones, no se llamó a Gemini, no se envió WhatsApp y no se modificó Production.

La limitación de Functions no se resolvió por fuerza: el backend sigue teniendo 18 entrypoints y el modelo Vercel Other/Hobby identificado mantiene el bloqueo histórico de 12. La estrategia segura está documentada, pero su implementación requiere una fase propia de empaquetado de staging y regresiones contractuales.

## Protección y entorno

- P0.2I: **11/11 SHA-256 protegidos coinciden** después de P0.5.
- P0.3.1: **10/10 SHA-256 protegidos coinciden** después de P0.5.
- No se encontró repositorio Git en esta copia de trabajo; por ello no se creó rama ni se ejecutó operación Git destructiva.
- Espacio libre observado: aproximadamente 130 MB en `C:`; `D:` dispone de espacio suficiente para una futura compilación temporal. No se borraron APK, backups, `node_modules`, árboles históricos ni `.vercel/output`.

## Functions y estabilidad

- Inventario estático: **18 Functions** bajo `api/`.
- Bloqueante real: 18 excede el límite de 12 Functions documentado para el escenario Vercel Other/Hobby. No se alteró `vercel.json`, no se consolidaron handlers ni se contrató Vercel Pro.
- Estrategia recomendada: empaquetado de staging que agrupe rutas `assistant/*` mediante despacho interno y preserve URLs/métodos/contratos, sin fusionar inicialmente los límites críticos (`webhook`, `ai/process`, `supabase-secure`, `notion-proxy`, `send-whatsapp`). Ver [matriz de Functions](YARBI_P0_5_FUNCTION_MATRIX.md).
- Suite general local: se preservan **30 fallos heredados**, sin evidencia de que P0.5 haya agregado uno. Los 61 renglones de fallo impresos por el runner contienen esos 30 y su listado resumen repetido. Ver [matriz histórica](YARBI_P0_5_MATRIZ_FALLOS_HISTORICOS.md).

## WhatsApp personal: base local implementada

Se añadieron módulos independientes de las conversaciones comerciales:

| Componente | Función |
|---|---|
| `lib/yarbi-owner-personal-identity.js` | Normaliza E.164, compara identidades autorizadas con HMAC/tiempo constante y separa destinos personales de comerciales. |
| `lib/yarbi-owner-personal-conversation.js` | Reutiliza el cerebro central `yarbi-owner-conversation`; fuerza `execute:false` y prohíbe efectos comerciales. Las instrucciones propuestas requieren confirmación. |
| `lib/yarbi-owner-personal-audio.js` | Valida MIME, tamaño máximo de 16 MiB y duración de 10 minutos; crea solo referencias opacas temporales. |
| `lib/yarbi-webhook-log.js` | Sanitiza diagnósticos del webhook: no retiene cuerpo, teléfonos, perfiles ni valores extraídos. |
| `migrations/PROPOSED_20261105_yarbi_owner_personal_whatsapp.sql` | Propuesta local, sin ejecutar, para identidad, conversaciones, mensajes, eventos, idempotencia y referencias de audio con RLS de servicio. |

`api/webhook.js` recibió únicamente endurecimiento de logs: se eliminó el logging de payload completo y se redujeron eventos a referencias sanitizadas. El flujo comercial, la persistencia y los contratos HTTP no fueron rediseñados. La ruta personal no se conectó al webhook: hacerlo requiere primero aplicar y probar la migración propuesta en un entorno aislado y confirmar el campo de destino del proveedor.

## Voz y memoria

- Se preparó el diseño de voz en `YARBI_P0_5_VOICE_DESIGN.md`. La entrada queda limitada y aislada; no se añadió TTS ni proveedor nuevo.
- Las dos identidades autorizadas se resuelven al mismo `owner_key`, para que la futura conversación personal use el repositorio lógico de instrucciones existente.
- Toda instrucción de una conversación personal queda como propuesta local `confirmed:false`; no se persistió ni se creó un segundo sistema de memoria o entrenamiento.

## Pruebas y métricas

Pruebas focalizadas ejecutadas: **23/23 PASS**.

- Identidad personal y Business sintéticas resuelven el mismo contexto autorizado.
- Remitente no autorizado se rechaza únicamente en el destino personal; el destino comercial conserva su separación.
- Eventos duplicados usan una clave HMAC de idempotencia no reversible.
- El turno personal reutiliza el cerebro central sin CRM I/O y con `execute:false`.
- Instrucciones requieren confirmación; audio solo acepta medios acotados.
- Firma YCloud válida/inválida mantiene el contrato existente.
- Diagnósticos de webhook no conservan contenido, números, perfiles ni valores de extracción.
- Las tres pruebas de artefactos P0.2I pasaron como parte de la ejecución focalizada.

Métricas locales sintéticas (sin red):

| Medición | Muestras | Mediana | p95 |
|---|---:|---:|---:|
| Clasificación de identidad | 200 | 0.0179 ms | 0.0386 ms |
| Recuperación local de contexto/instrucción | 200 | 0.0062 ms | 0.0190 ms |
| Búsqueda local de candidatos | 200 | 0.0274 ms | 0.0616 ms |
| Procesamiento del turno personal | 100 | 0.2170 ms | 0.4197 ms |

Estas cifras no representan Supabase, Gemini, Vercel, cold starts, almacenamiento remoto ni producción.

## Brechas y siguiente paso

Las brechas, límites de proveedor y plan de activación quedan en [YARBI_P0_5_BRECHAS_PENDIENTES.md](YARBI_P0_5_BRECHAS_PENDIENTES.md). El siguiente paso mínimo seguro es una fase local de empaquetado en `D:` para probar la reducción de Functions sin modificar rutas públicas ni desplegar.

## Confirmación de aislamiento

Durante P0.5 no se tocó Production, Vercel, alias, Supabase remoto, CRM remoto, Agenda, WhatsApp, Notion, Calendar, Maps, Gemini, Meta Ads, voz externa ni APK. No hubo acciones comerciales ni datos reales en las pruebas.
