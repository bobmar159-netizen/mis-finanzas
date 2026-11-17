# Yarbi — Natural Document Intelligence: resultado local

**Estado:** implementación local lista para revisión; todavía no lista para uso
en APK/Preview.

## Qué quedó integrado

- El chat de texto y Gemini Live comparten el mismo tutor documental. La entrada
  de Live conserva hasta ocho turnos recientes y llega por la herramienta
  síncrona `get_approved_knowledge`; Live recibe el resultado antes de responder.
- El intérprete Gemini resuelve preguntas naturales y referencias contextuales.
  No redacta una respuesta sin evidencia. Se conservan cifras, unidades y
  códigos; si se alteran o resultan ambiguos, Yarbi pide confirmación.
- Gemini File Search quedó conectado como recuperador remoto para PDFs aprobados.
  Usa stores por propietario/documento, verifica autorización y copia completa
  antes de subir, y verifica que el documento aparezca antes de marcarlo listo.
  La clave solo se usa en backend. La búsqueda local existente queda como
  alternativa offline, no como segundo chat.
- Las referencias de numeral se descartan si no aparecen en el fragmento citado.
  Se admite página solo cuando Gemini entrega metadatos de página; la cita
  literal debe coincidir con el extracto remoto o el índice local.
- Los PDFs históricos que ya estaban aprobados pero no conservan el binario
  muestran una acción para elegir el original. La ficha se vincula solo si tamaño
  y SHA-256 coinciden; no se duplica ni se reprocesa su extracción.
- Corregido un fallo de estado: una indexación fallida ya no queda mostrada como
  “en curso”; queda como fallida y se puede reintentar.
- El tope de esta vía es 50 MB decimales, conforme al límite de procesamiento de
  documentos consultado. PDF mayores siguen en la ruta local existente.

## Decisiones basadas en documentación Google

File Search realiza indexación semántica administrada y devuelve citas; la lista
oficial consultada incluye `gemini-3.5-flash-lite`. Gemini procesa PDFs con
visión nativa para texto, tablas, imágenes y diagramas. File Search no admite
audio/video ni está disponible como herramienta nativa de Gemini Live. Live sí
permite Function Calling síncrono para `gemini-3.8-live`; por eso Yarbi hace el
puente con su herramienta actual y el backend consulta File Search.

Fuentes: [File Search](https://ai.google.dev/gemini-api/docs/file-search),
[procesamiento de documentos](https://ai.google.dev/gemini-api/docs/document-processing),
[Gemini Live](https://ai.google.dev/gemini-api/docs/live-api) y
[herramientas Live](https://ai.google.dev/gemini-api/docs/live-api/tools).

## Validación

- **63/63 PASS** en pruebas focalizadas de File Search, recuperación documental,
  continuidad Live/chat, normas, aislamiento, citas, abstención y regresiones.
- **12 formatos de consulta** cubiertos con salida Gemini sintética: pregunta
  exacta, sin palabra clave, paráfrasis, coloquial, error de voz, incompleta,
  referencia contextual, comparación, tabla, diagrama, ausencia de evidencia y
  cifras ambiguas. Esto verifica el contrato y los guardas, no la calidad real del
  proveedor.
- Benchmark CPU local con 500 secciones y 32 consultas: **p50 30.92 ms, p95
  39.46 ms**. No mide HTTP, Gemini, Preview ni Android.
- `node --check`: handlers, adaptador y tests PASS. `git diff --check`: PASS.
- Los tests usan destinos y respuestas sintéticos. No se llamó a Gemini,
  Supabase, Vercel, WhatsApp ni servicios comerciales.

## Lo que falta antes de probarlo en el teléfono

1. Aplicar en un Supabase de Preview aislado la migración propuesta para la
   biblioteca y la tabla privada de stores. No se ejecutó ninguna migración.
2. Configurar en **ese mismo Preview** la clave server-side existente, el backup
   de conocimiento y `YARBI_GEMINI_FILE_SEARCH_ENABLED=true`; definir
   `GEMINI_FILE_SEARCH_MODEL` si el modelo conversacional configurado no es
   compatible. El servicio queda apagado si falta cualquiera de estas piezas.
3. Probar carga reanudable y CORS de Google desde el navegador/WebView, preguntas
   reales sobre PDFs sintéticos, citas de tablas/diagramas y eliminación del
   store. No se demostró con mocks.
4. Construir Web/Android y validar físicamente el A54; no se hizo build ni APK.

La migración está en
`migrations/PROPOSED_20261115_yarbi_knowledge_backup.sql`; **no está aplicada**.
El PDF original se conserva localmente y se entrega una vez a File Search cuando
la función se habilite. El respaldo Supabase propuesto guarda texto, metadatos y
embeddings, no el PDF binario. Google retiene las embeddings del store hasta que
se borren o se depreque el modelo; la referencia temporal al archivo crudo se
elimina a las 48 horas según la documentación consultada. La indexación puede
generar costos; almacenamiento y embeddings en consulta se muestran gratuitos en
la tabla oficial vigente consultada.

## Estado del repositorio

- Rama aislada: `codex/yarbi-core-domain`.
- Base de este trabajo: `0833feb5982219208b684d08a96a242e3d2b0559`.
- No se creó commit, no se modificó `main`, no se desplegó y no se tocó
  Production.
- El worktree contiene archivos de trabajo sin seguimiento previos; en
  particular `.gradle-user-home/` se dejó intacto.

Ver la matriz requisito/evidencia en
`YARBI_NATURAL_DOCUMENT_INTELLIGENCE_TRACEABILITY.md` y los hashes en
`YARBI_NATURAL_DOCUMENT_INTELLIGENCE_SHA256SUMS.txt`.
