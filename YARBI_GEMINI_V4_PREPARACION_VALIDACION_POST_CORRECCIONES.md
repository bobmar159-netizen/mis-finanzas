# Yarbi — preparación de validación V4 post-correcciones

## Resultado

**PREPARACION_LOCAL_COMPLETADA — 16 SOLICITUDES PREPARADAS, 0 EJECUTADAS.**

Esta fase fue exclusivamente local. No hubo llamadas a Gemini, redes externas, despliegues, cambios en Producción, acceso a CRM/Agenda/WhatsApp ni acciones comerciales. V4 continúa aislado y no está conectado al endpoint comercial.

## Batería nueva

Se creó una batería separada de los 32 casos históricos. Usa identificadores sintéticos (`ENTIDAD_*`, `SERVICIO_*`, `ZONA_*`) y no contiene personas, teléfonos, clientes ni conversaciones reales.

| Fixtures | Familia | Casos | Resultado esperado |
| --- | --- | ---: | --- |
| `F3PC-01`–`F3PC-04` | Corrección explícita | 4 | Reemplazo por la misma dimensión, con menciones independientes permitidas. |
| `F3PC-05`–`F3PC-07` | Temporal | 3 | Pasado verificable, presente verificable y abstención segura para futuro no resoluble. |
| `F3PC-08`–`F3PC-10` | Continuidad | 3 | Reutiliza solo antecedente estructurado disponible; sin selección automática. |
| `F3PC-11`–`F3PC-12` | Negación independiente | 2 | La entidad/servicio negado no se usa; las menciones independientes verificadas permanecen utilizables. |
| `F3PC-13`–`F3PC-14` | Identificación y servicio | 2 | Restricciones explícitas, sin resolver clientes. |
| `F3PC-15`–`F3PC-16` | Ambigüedad | 2 | Abstención y solicitud de aclaración. |

Las expectativas viven en el fixture/evaluador, no en el prompt de una eventual llamada a Gemini.

### Contexto fijo y verificable

Todos los casos temporales llevan:

- Fecha/hora de referencia: `2026-11-04T12:00:00-05:00`
- Zona horaria: `America/Lima`
- Antecedentes de continuidad: solo `active_constraints` sintéticas cuando el caso lo requiere.

La referencia temporal futura conserva una salida de aclaración: no se transforma en fecha absoluta ni se inventa información que no está en el contrato actual.

## Corrección local adicional encontrada

Durante el preflight, una corrección temporal explícita en pasado era bloqueada porque la guardia reconocía `no era`, pero no `no fue`.

Se ajustó de forma acotada la detección de lenguaje de corrección para aceptar `no fue`. No se añadieron diccionarios amplios, campos, acciones ni permisos. La condición sigue requiriendo mención negada verificable, mención afirmada de la misma dimensión, procedencia y pareja no ambigua.

## Pruebas locales

| Suite | Resultado |
| --- | --- |
| Suites previas del diagnóstico forense | 70/70 PASS |
| Contrato de la batería post-correcciones | 1/1 PASS |
| Los 16 recorridos sintéticos V4 → hardener → V1 → V3 o abstención segura | 16/16 PASS |
| Total ejecutado en este preflight | **87/87 PASS** |
| Red / acciones comerciales | **0 / 0** |

En los tres casos de abstención segura, el adaptador V4 → V1 rechaza la conversión deliberadamente; `v1` y `v3` quedan `not_applicable`. No es una falla: evita convertir ambigüedad o futuro no verificable en una consulta accionable.

## Telemetría preparada

La evidencia sanitizada distingue por fixture:

- interpretación sintética recibida;
- normalización estricta;
- hardener V4;
- adaptador V4 → V1;
- normalización V1;
- hardening V3;
- resultado semántico o abstención esperada.

No guarda prompts completos, respuestas de proveedor, valores de entidades, credenciales ni información personal.

## Runner de Preview preparado

Archivo: `scripts/run-gemini-v4-post-corrections-validation.cjs`

El runner prepara exactamente **16 solicitudes**, una por fixture, con estas garantías previstas:

- cero reintentos automáticos;
- `execute_false: true`;
- owner sintético autenticado requerido en una futura fase;
- proyecto aislado previsto: `uevilhbstnmmdlgyshlv`;
- sin handlers comerciales ni consultas a clientes;
- endpoint futuro dedicado: `/api/diagnostics/gemini-v4-post-corrections-validation`.

Por seguridad no contiene cliente HTTP ni puede ejecutar Gemini hoy.

```powershell
node .\scripts\run-gemini-v4-post-corrections-validation.cjs
```

El modo siguiente permanece bloqueado incluso si se solicita manualmente:

```powershell
node .\scripts\run-gemini-v4-post-corrections-validation.cjs --execute
```

Resultado esperado actual: `EXECUTION_DISABLED_PENDING_EXPLICIT_AUTHORIZATION`. Para habilitar una ejecución futura harán falta una autorización explícita, un deployment Preview aislado de una ruta dedicada y una revisión nueva de aislamiento. Esta fase no los crea ni los despliega.

## Riesgos y pendientes

1. **NOT PROVEN:** cómo responderá Gemini a estos 16 casos; no se llamó al proveedor.
2. **NOT PROVEN:** el porcentaje posterior a correcciones. Las pruebas locales validan el pipeline, no la calidad del modelo.
3. **PENDIENTE:** incorporar a una ruta Preview aislada una representación mínima del contexto temporal y antecedente estructurado, sin tocar rutas comerciales.
4. **PENDIENTE:** autorización expresa para una batería real de máximo 16 solicitudes, sin reintentos.

## Archivos creados/modificados

| Archivo | Motivo |
| --- | --- |
| `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-post-corrections-fixtures.js` | 16 fixtures nuevos, contexto temporal fijo y estados sintéticos. |
| `scripts/test-yarbi-v4-post-corrections-local.cjs` | Prueba de los 16 recorridos sintéticos. |
| `scripts/yarbi-v4-post-corrections-local-evidence.json` | Telemetría local sanitizada por etapa. |
| `scripts/run-gemini-v4-post-corrections-validation.cjs` | Runner de preparación; ejecución explícitamente bloqueada. |
| `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-understanding-polarity-proposal.js` | Reconocimiento acotado de corrección temporal explícita (`no fue`). |

## Hashes

| Artefacto | SHA-256 |
| --- | --- |
| Fixtures post-correcciones | `227536f92a3b4e16f0f0d28d8ca8c4cda5c8b6b1b3e1fe6ee3cc0801fc8fdc56` |
| Pruebas locales post-correcciones | `28af9f458a08612152f8c4882990262cba3c6b7018224e50253446c4f704db09` |
| Evidencia local sanitizada | `2464e7e01e72c4a5ebf68697779a64cb97e6d306b601638db34515bd5b0b2017` |
| Runner preparado | `848086aa191871f8106dda1782f0b70924c66c181d18205e34236827a998c795` |
| Hardener V4 actualizado | `bde3923915eaf6a359d9382a87ca898bfc8e6e7f360c57a583a50cf41ff0bcaf` |
| Informe | Se entrega fuera del propio archivo para preservar su hash. |

