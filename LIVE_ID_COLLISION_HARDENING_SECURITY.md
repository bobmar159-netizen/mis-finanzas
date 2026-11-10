# Seguridad de identidad Live

## Hallazgo corregido

La versión previa construía IDs mediante reemplazo de caracteres y truncamiento. Esa transformación no era inyectiva: entradas distintas podían terminar con el mismo ID, provocar deduplicación incorrecta o seleccionar el mismo nodo DOM.

La versión v2 usa componentes con marca de tipo, longitud y codificación hexadecimal de cada unidad UTF-16. La construcción es inequívoca dentro del modelo de strings JavaScript y no depende de delimitadores interpretables. No se usa un hash finito como supuesta garantía absoluta; no se requiere digest porque el valor completo se conserva.

## Protección evaluada

| Riesgo | Resultado |
| --- | --- |
| `/` frente a `_` | PASS: IDs distintos |
| Prefijos de 96/40 caracteres iguales | PASS: no hay truncamiento |
| Unicode, espacios y caracteres especiales | PASS: representación segura y distinta |
| Mayúsculas/minúsculas | PASS: preservadas |
| Separadores internos | PASS: longitudes explícitas evitan ambigüedad |
| Rol distinto | PASS: forma parte de la tupla |
| Sesiones distintas con mismo turno | PASS: forma parte de la tupla |
| Ausente / null / vacío | PASS: se distinguen explícitamente |
| Callback repetido | PASS local: una sola entrada para la misma tupla |
| Dos pestañas o procesos | NOT PROVEN: el mapa de finalización no es compartido |

## Fronteras preservadas

No se modificaron autenticación, endpoints, Supabase, Gemini Live, VAD, AudioWorklet, micrófono, Barge-in, producción ni credenciales. La clave se limita a IDs y deduplicación de mensajes Live ya recibidos.

## Persistencia

Antes de confirmar la finalización, `persistTimelineMessage` relee la entrada desde la línea de tiempo local. Un fallo local de almacenamiento retorna fallo al finalizador, que conserva el borrador para recuperación. La sincronización remota posterior continúa usando el ID estable; no se afirma atomicidad distribuida sin una restricción o RPC compartida demostrada.

## Deuda histórica VAD

La suite conserva un fallo histórico del hash VAD (`D2A360…` esperado frente a `024125…` observado) ya presente en F03. No se cambió el bloque, ni se alteró la expectativa para forzar aprobación. La comparación de fallos históricos confirma que no se añadió ningún fallo nuevo.
