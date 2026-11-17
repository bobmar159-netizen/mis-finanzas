# Yarbi — inteligencia documental natural con Gemini

## Diseño integrado

El chat escrito y la voz de Gemini Live conservan una sola interfaz y un solo
orquestador de conocimiento. El texto enviado y la transcripción final de Live
entran al mismo recorrido: contexto reciente → comprensión de la intención →
recuperación documental → respuesta breve → citas comprobadas.

Para PDF, Gemini File Search es el recuperador administrado principal cuando
está habilitado. Cada archivo aprobado se indexa una vez; el chat no transmite
de nuevo el PDF en cada consulta. La extracción local, BM25 y embeddings
existentes siguen disponibles sin conexión o si File Search no está operativo.
No son dos conversaciones ni dos fuentes de verdad: la biblioteca local conserva
el archivo y el índice existente, y el backend restringe las colecciones
remotas a las fuentes aprobadas del propietario autenticado.

Gemini Live no admite File Search como herramienta nativa. Yarbi reutiliza su
Function Calling síncrono `get_approved_knowledge`: la herramienta llama al
orquestador documental, este recupera y verifica evidencia y devuelve la
respuesta a Live. Así Live no debe contestar sobre una norma antes de recibir
la evidencia. Se conserva la sesión/voz existente; no se introduce otro chat,
pipeline de conversación, VAD ni reproducción.

La API de procesamiento de documentos de Gemini puede interpretar texto,
tablas, imágenes y diagramas incluidos en PDF. File Search también admite PNG y
JPEG como fuentes independientes cuando el store usa `models/gemini-embedding-2`;
Google limita esas imágenes a 4096 × 4096 píxeles. Yarbi valida el encabezado,
MIME, dimensiones y SHA-256 antes de pedir la sesión de carga, y limita el
original de imagen a 40 MiB. Solo permite indexar una fuente aprobada con sus
secciones respaldadas y su scope autenticado. El archivo se conserva en el
dispositivo y se carga una vez al store del propietario. File Search no admite
audio ni video; estos requieren un extractor/transcriptor explícito y aprobado.
No se declara OCR/transcripción universal ni índice de esos medios sin ejecutar
ese extractor y conservar evidencia textual vinculada a la fuente.

## Flujo de un PDF

1. El navegador valida PDF, tamaño, bytes y SHA-256; extrae texto por página y
   guarda el original como `Blob` en IndexedDB antes de que PDF.js pueda
   transferir su `ArrayBuffer` al worker.
2. El propietario revisa y aprueba la fuente. La copia local permanece en el
   dispositivo. El respaldo de secciones en Supabase es independiente del
   original: la propuesta actual no sube el PDF a Supabase.
3. Solo con File Search habilitado, sesión autenticada, respaldo Supabase
   completo y fuente aprobada, el backend crea un store privado por propietario
   y PDF. La clave Google queda en servidor. El cliente usa una URL temporal de
   carga emitida por Google, nunca recibe la API key. Se asocia el SHA-256 al
   documento y el estado no pasa a listo hasta que el backend comprueba que el
   documento aparece en el store.
4. En cada pregunta, el intérprete usa el mensaje y el contexto reciente para
   expresarla con claridad. El backend obtiene exclusivamente los stores activos
   y listos del dueño autenticado y consulta Interactions con File Search.
5. Yarbi exige citas de esas fuentes. La referencia de numeral/sección se
   muestra solo si aparece en el fragmento citado; la página se muestra cuando
   Gemini la devuelve. La cita literal se presenta únicamente si se valida
   contra el fragmento del proveedor o la copia local. Si falta evidencia, se
   abstiene y pide una aclaración concreta.
6. Chat escrito y `get_approved_knowledge` de Live invocan la misma ruta. No se
   crean acciones comerciales por una pregunta documental.

Los documentos aprobados antes de conservar el `Blob` pueden tener solo texto
extraído. Para habilitar su análisis visual, la ficha ofrece “Elegir PDF original
para Gemini”: el archivo seleccionado debe tener el mismo tamaño y SHA-256. Se
enlaza a la ficha aprobada existente, sin duplicarla ni volver a extraerla. Si
no se conserva el original, la búsqueda local permanece disponible.

## Configuración por entorno

La función está **deshabilitada por defecto**. Configurar cada ambiente por
separado (local, Preview o Production); no hay fallback de un ambiente a otro.

| Variable | Estado | Uso |
|---|---|---|
| `GEMINI_API_KEY` o la convención ya existente `GEMINI_KEY` | Reutilizada, solo servidor | Clave de Google para la pasarela Gemini/File Search. Nunca debe ir al bundle web ni a Android. |
| `GEMINI_MODEL` (o `GEMINI_CHAT_MODEL`) | Reutilizada | Modelo actual del orquestador y valor por defecto de File Search; el backend rechaza modelos que no figuren en su lista de compatibilidad. |
| `YARBI_GEMINI_FILE_SEARCH_ENABLED` | Nueva | `true` solo para activar File Search en ese ambiente. Si falta o no es `true`, las operaciones de File Search devuelven error controlado; queda la búsqueda local. |
| `GEMINI_FILE_SEARCH_MODEL` | Nueva, opcional | Modelo explícito compatible con File Search. Si no se define, se usa `GEMINI_MODEL`. No se acepta un modelo arbitrario. |
| `YARBI_KNOWLEDGE_BACKUP_ENABLED` | Existente, separada | Debe estar activa para que se complete el respaldo de conocimiento que valida la subida. |
| `APP_ORIGIN` | Existente | Origen permitido por la pasarela, según la configuración actual. |

La subida se rechaza si falta la tabla de respaldo, la clave, la flag, el modelo
compatible, la sesión del dueño, la aprobación o la copia completa en la
cuenta. La migración
`migrations/PROPOSED_20261115_yarbi_knowledge_backup.sql` sigue siendo propuesta:
**no se aplicó remotamente**. La inspección de solo lectura confirmó que existe
el proyecto Vercel `yarbi-preview-candidate-20261105` y que tiene variables
Preview cuyos nombres incluyen `GEMINI_API_KEY`, `SUPABASE_URL`, las claves
públicas/secretas de Supabase y algunas flags de Preview. No se revelaron
valores. La URL/ref de Supabase exige reautenticación 2FA y no pudo comprobarse;
las flags `YARBI_KNOWLEDGE_BACKUP_ENABLED` y
`YARBI_GEMINI_FILE_SEARCH_ENABLED` no aparecieron en la lista visible. La
vinculación local `.vercel/project.json` sigue correspondiendo a
`misfinanzas-backend`. Por tanto, no se aplicó migración ni se activó File
Search; el bloqueo es verificar el destino aislado y completar sus variables
sin confundirlo con el proyecto comercial.

## Límites y operación

- Límite de subida de esta integración: 50 MB decimales por PDF, acorde al límite
  documentado de PDF de 50 MB/1000 páginas; el límite también evita exceder el
  límite del documento de File Search.
- PNG/JPEG usa `models/gemini-embedding-2`, requiere dimensiones verificadas de
  hasta 4096 × 4096 y tiene límite local Yarbi de 40 MiB. WebP/HEIC siguen
  disponibles solo por las rutas locales/extractores que sí los soporten; no se
  envían a File Search.
- Cargas anteriores sin `Blob` requieren seleccionar una vez el PDF original.
- La carga/resumable URL no incluye la clave Google, pero es una URL temporal
  sensible; la interfaz no la registra ni la persiste como secreto.
- Una avería remota usa el índice local como alternativa sin cambiar de proyecto,
  propietario, Supabase o entorno.
- Borrar una fuente intenta eliminar su store Gemini y respaldo antes de borrar
  la ficha local. Si no se puede confirmar el borrado remoto, la ficha local se
  conserva para reintentar.
- File Search guarda una representación indexada hasta eliminarla según la
  operación de Google; la API Files temporal tiene otra retención. Confirmar la
  política, costos y retención vigentes del proyecto Google antes de habilitarlo
  en Preview o Production.
- La documentación oficial indica que el objeto crudo temporal de una subida se
  elimina a las 48 horas, mientras las embeddings del store
  permanecen hasta eliminación manual o deprecación del modelo. El costo ocurre
  al indexar las embeddings y en tokens normales de modelo; almacenamiento y
  embeddings de consulta figuran como gratuitos en la tabla oficial consultada.
- Se usa REST `v1beta/interactions` mediante el `fetch` ya usado por el backend;
  no se añadió otro SDK de Google ni un servicio de búsqueda paralelo.
- La carga directa desde el navegador depende de que la URL de carga permita
  CORS en el entorno/dispositivo objetivo. Los mocks locales no demuestran esa
  compatibilidad real.
- La respuesta sigue siendo generativa: las pruebas pueden comprobar la
  validación de referencias, pero no demuestran fidelidad para todas las
  preguntas hasta probar con PDFs sintéticos representativos en un ambiente
  autorizado.

## Pruebas y validación actual

Las pruebas cubren modelo/archivo, autenticación y scope, aprobación, no fuga de
API key, protección contra store seleccionado por cliente, creación única,
confirmación de indexación, citas/referencias, PNG/JPEG y rechazo antes de
efectos remotos cuando el tipo o las dimensiones no son válidos. Se ejecutan con
endpoints y contenidos sintéticos; no llaman a Google, Supabase, Vercel ni
proveedores comerciales. En la última ejecución focalizada pasaron 69/69
pruebas relacionadas con File Search, tutor y disponibilidad de normas.

El benchmark local del recuperador existente es CPU sintética, no latencia de
Google, HTTP Preview o dispositivo Android. Última muestra CPU: p50 30,60 ms y
p95 38,14 ms sobre 500 fragmentos sintéticos y 32 consultas.

Se generaron dos builds de recursos aislados, sin deployment ni APK nativo:

- `dist/yarbi-local-web-20261116`: `BUILD_OK`, `same_origin`, 227 archivos.
- `dist/yarbi-local-android-20261116`: `BUILD_OK`, `remote_disabled`, 227
  archivos; no incorpora origen Supabase ni clave pública.
- Ambos comparten el release `p02i-11eaac3d92cd9d07` y el mismo hash de fuentes
  `11eaac3d92cd9d075f65fd88b61d6c5cc7353e733dcfa6ed50aa2f3b3ab1e53f`.

No se hicieron despliegue, migración, llamadas reales a Gemini/Supabase ni
prueba física en Android.

## Referencias oficiales estudiadas

- [Gemini File Search](https://ai.google.dev/gemini-api/docs/file-search)
- [Procesamiento de documentos](https://ai.google.dev/gemini-api/docs/document-processing)
- [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api)
- [Herramientas y Function Calling en Live](https://ai.google.dev/gemini-api/docs/live-api/tools)
