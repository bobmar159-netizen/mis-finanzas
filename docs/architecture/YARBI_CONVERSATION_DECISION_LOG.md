# Yarbi — Registro de Decisiones de Conversación

| ID | Decisión | Estado | Motivo y consecuencia |
|---|---|---|---|
| C-01 | Un solo cerebro Yarbi | Aprobada | FAST, STANDARD y DEEP comparten contrato; no habrá asistentes alternos. |
| C-02 | Chat como centro | Aprobada | CRM, Agenda y Finanzas aportan herramientas/contexto, no reemplazan la conversación. |
| C-03 | Contrato de bloques versionado | Aprobada | Evita HTML/model output ejecutable y permite renderer común Android/Web. |
| C-04 | Contenido y acción separados | Aprobada | Gemini puede proponer; backend autorizado decide ejecución. |
| C-05 | Historial separado de memoria | Aprobada | Conversar no equivale a guardar conocimiento empresarial. |
| C-06 | Voz deriva del mensaje canónico | Aprobada | Evita que voz y texto digan cosas diferentes. |
| C-07 | No fallback a bloque desconocido ejecutable | Aprobada | Se renderiza aviso seguro y texto alternativo. |
| C-08 | Streaming por eventos idempotentes | Aprobada | Permite reconectar sin duplicar contenido. |
| C-09 | Persistencia actual no se reinterpreta | Aprobada | `yarbi_conversation_messages` legacy no es el modelo final; migración posterior explícita. |
| C-10 | Estado visual entre pestañas se posterga | Aprobada | Requiere diseño y prueba propios; no se afirma resuelto. |
| C-11 | JPG se genera localmente por láminas | Aprobada | Mantiene legibilidad, privacidad y uso Android. |
| C-12 | NTP 111.011:2014 es piloto documental | Aprobada | Citas literales y vigencia se verifican, no se infieren. |
| C-13 | Gemini no ejecuta operaciones | Aprobada | Protege CRM, Agenda, Finanzas, WhatsApp y cobros. |

## Decisiones pendientes antes de Etapa 1

1. Política de retención, cifrado local y eliminación de historial.
2. Esquema remoto y migración no destructiva de conversaciones/bloques.
3. Transporte de streaming: SSE, fetch stream u otro protocolo compatible con
   Vercel y Capacitor, medido en Preview y Android.
4. Fuente oficial de TTS, permisos y tratamiento de interrupciones Android.
5. Formato final para previews y originales de Business Knowledge Engine.
6. Política de URLs/imágenes externas, tamaños y sanitización de documentos.
7. Estrategia de exportación JPG que no filtre datos o fuentes restringidas.

## Compatibilidad F03/F04

La propuesta conserva el enrutamiento FAST/STANDARD/DEEP de F03 y no modifica
el scope, provenance, confirmaciones ni la frontera SQL de F04. Los cambios
futuros deberán probar explícitamente que los bloques conversacionales no
pueden ejecutar ni saltarse las acciones protegidas de F04.

## Registro Etapa 0.1

| ID | Decisión/corrección | Motivo y fuente | Estado | Fase y aceptación |
|---|---|---|---|---|
| C-14 | Párrafos mediante `runs`, no `bold_text` sustituto | Auditoría independiente: se requieren marcas normal, negrita, cursiva y combinación, con validación estricta. | Aprobada documentalmente | Antes de Etapa 1: renderer valida esquema, rechaza HTML/JS/marcas desconocidas y usa fallback seguro. |
| C-15 | Escala tipográfica explícita y accesible | Auditoría independiente: faltaban jerarquía y requisitos móviles medibles. | Aprobada documentalmente | Antes de Etapa 1: revisión Web/Android de escala, contraste, espaciado y no sobreestructuración. |
| C-16 | Procedencia multimedia con coordenadas temporales | Auditoría independiente: BKE necesitaba localizar evidencia sin reprocesar archivos completos. | Aprobada documentalmente | Antes de BKE: validar PDF/Excel/imagen/video/audio, `start_ms`, `end_ms`, `frame_index` y SHA. |
| C-17 | Procesamiento BKE separado por dominio | Auditoría independiente: no confundir original local, análisis remoto y conocimiento aprobado. | Aprobada documentalmente | Antes de BKE: versionado, deduplicación SHA, modalidad y capacidades Gemini verificadas. |
| C-18 | Cifrado offline pendiente de decisión técnica | Auditoría independiente y revisión local de dependencias: Keystore y SQLCipher no son equivalentes; no hay SQLite/SQLCipher constatado. | Pendiente de inspección Android | Antes de historial offline: decisión de claves, retención, borrado, sincronización y conflictos. |
| C-19 | Puertas independientes por capacidad | Auditoría independiente: evitar bloquear Etapa 1 por BKE o cifrado aún no implementados. | Aprobada documentalmente | Etapa 1 sólo depende de C-14/C-15; BKE depende de C-16/C-17; offline depende de C-18. |
