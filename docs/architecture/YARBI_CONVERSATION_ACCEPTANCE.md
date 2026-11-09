# Yarbi — Matriz de Aceptación de Conversación

Las pruebas se implementarán en la Etapa 1; esta matriz no declara cobertura
actual. “Android real” requiere dispositivo físico, no WebView simulado.

| # | Caso | Preparación y acción | Resultado esperado | Evidencia / tipo | Riesgo |
|---:|---|---|---|---|---|
| 1 | Texto sencillo | FAST con dato sintético | Párrafo breve, sin acción | Unitario + integración | Sobreformato |
| 2 | Respuesta extensa | STANDARD simulado con bloques | Orden, títulos y estado final | Unitario renderer | Duplicación al reconectar |
| 3 | Lista CRM | Fixtures con prioridades distintas | Lista numerada con fuente y motivo | Integración | Mezcla de owners |
| 4 | Tabla comercial | Hechos financieros sintéticos | Totales y columnas accesibles | Unitario + integración | Cálculo no verificado |
| 5 | Cita PDF | Documento/version/página fixture | Cita y preview procedentes | Unitario | Afirmar contenido no literal |
| 6 | Imagen | Recurso permitido con alt | Imagen sin URL no confiable | Unitario Web/Android | Egress o XSS |
| 7 | Voz sincronizada | Transcripción y bloques sintéticos | Texto igual a segmentos TTS | Integración + Android real | Divergencia voz/texto |
| 8 | Streaming interrumpido | Cortar tras dos bloques | Estado `failed`, bloques previos visibles | Integración | Falsa completitud |
| 9 | Reconexión | Repetir eventos secuenciados | Sin bloque duplicado | Unitario protocolo | Reordenamiento |
| 10 | Nueva conversación | Owner A autenticado | ID nuevo y título provisional | Integración | Scope incorrecto |
| 11 | Renombrar | Conversación propia existente | Revisión y título actualizados | Integración | Lost update |
| 12 | Eliminar | Conversación propia + confirmación | Eliminación lógica, no reaparición | Integración | Borrado accidental |
| 13 | Recuperar historial | Mensajes paginados | Orden estable e idempotente | Integración | Mezcla local/nube |
| 14 | Aislamiento | Owners A/B mismos textos | Cero lectura cruzada | Integración | Bypass de scope |
| 15 | Offline | Caché propia precargada | Sólo contenido disponible, estado offline | Web + Android real | Mostrar datos antiguos como actuales |
| 16 | Bloque desconocido | Bloque versión futura | Fallback seguro, sin ejecución | Unitario renderer | XSS / caída |
| 17 | Acción CRM no autorizada | Acción sin autorización válida | Backend rechaza, UI informa | Integración | Efecto comercial |
| 18 | Mensaje incompleto | Evento final ausente | Conserva parcial marcado | Integración | Duplicación o engaño |

Para cada caso se retiene un artefacto sanitizado: payload sintético, versión de
esquema, respuesta renderizada o captura Android, y resultado de autorización.

## Puertas de aceptación por alcance

La Etapa 1 no empieza hasta comprobar inline runs combinables, rechazo de
HTML/JavaScript/marcas desconocidas, fallback textual seguro y la jerarquía
tipográfica accesible en Web y Android. Estos requisitos no dependen del BKE.

La aceptación de BKE exige referencias recuperables de PDF, Excel, imagen,
video y audio —incluidos `start_ms`, `end_ms` y `frame_index`—, SHA por versión,
deduplicación, reanudación y mediciones reales Android de recursos e
interrupciones. La aceptación de historial offline exige antes una decisión de
persistencia/cifrado, protección de claves, retención, eliminación,
sincronización, conflictos y búsqueda offline. Ninguna simulación local se
presentará como una validación de dispositivo Android físico.
