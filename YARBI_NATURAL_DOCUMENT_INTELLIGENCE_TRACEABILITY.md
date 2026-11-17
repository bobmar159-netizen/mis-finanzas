# Yarbi — trazabilidad de inteligencia documental natural

Estados: **PASS local** = código y contrato verificados en pruebas sintéticas;
**PENDIENTE** = requiere credenciales, Preview, proveedor o dispositivo real;
**PARCIAL** = el requisito se satisface solo en el alcance indicado.

| ID | Requisito | Fuente | Implementación/evidencia | Estado actual |
|---|---|---|---|---|
| ND-01 | Comprender intención en lenguaje natural, paráfrasis y expresiones incompletas | Orden de implementación §2, §3 | Intérprete Gemini existente; conserva texto original, contexto reciente, normalización y variantes. Tests `yarbi-multimodal-tutor` y aceptación natural | PASS local; calidad Gemini real pendiente |
| ND-02 | Conservar cifras, unidades, presiones, códigos y normas | §3 | `validateProtectedKnowledgeIntent`; solicita aclaración cuando se pierde o añade un valor | PASS local con mocks |
| ND-03 | Conversación continua y referencias entre turnos | §8 | Contexto acotado a ocho mensajes del mismo chat; se pasa tanto en texto como en tool call Live | PASS local; dispositivo pendiente |
| ND-04 | File Search para indexar una vez y recuperar semánticamente | §4–5 | Store por owner y SHA, carga reanudable, consulta Interactions con modelo allowlist y evidencia/citas | Código y mocks PASS; migración/configuración/Google real pendientes |
| ND-05 | Procesamiento visual PDF: tablas, gráficos, diagramas y texto | §5 | Se sube el PDF original aprobado al servicio administrado; límite 50 MB decimales | Compatible según documentación; fidelidad real NOT PROVEN |
| ND-06 | File Search no disponible directamente en Live; voz debe llamar herramienta | §9 | Function Calling existente `get_approved_knowledge` llama al mismo `answerFromChat`/orquestador y espera la respuesta | PASS de integración sintética; voz física y Live remoto pendientes |
| ND-07 | Citas, fuente y página verificables; explicar en fácil | §7, §12 | Backend ata cita al SHA del store del propietario; valida numeral contra el fragmento; frontend valida cita literal antes de mostrarla | PASS con fixtures; citas reales pendientes |
| ND-08 | Abstenerse ante evidencia insuficiente y evitar inventar | §7, §13 | `found=false` sin cita, abstención y una aclaración breve; test sintético | PASS local; exactitud del modelo real pendiente |
| ND-09 | Comparar fuentes activas y comunicar discrepancias | §2, §7 | Una consulta puede buscar en los stores activos y aprobados del propietario; respuesta estructurada acepta varias citas | Implementado por contrato; comparación factual real pendiente |
| ND-10 | Mantener una biblioteca, no crear un segundo chat | §6, §12 | Búsqueda y gestión amplían BKE; solo el chat principal acepta preguntas. Test confirma ausencia de panel/chat tutor paralelo | PASS local |
| ND-11 | Aislamiento entre propietarios y secretos solo en backend | §11 | Auth existente antes del handler; stores elegidos desde tabla owner-scoped; supabase service role; API key Google server-side; no se aceptan stores del cliente | PASS con mocks; RLS/DB real pendiente de migración y revisión en Preview |
| ND-12 | Guardar original e índice y no subir el PDF en cada pregunta | §5, §10 | Original en IndexedDB; respaldo propuesto Supabase de texto/embeddings; File Search recibe original una vez | Parcial: original no se guarda en Supabase; se conserva local + store Gemini; la migración sigue sin aplicar |
| ND-13 | Reanudar procesamiento y detectar duplicados | §5, §13 | Hash SHA-256, estado server-side, store único owner/SHA, comprobación de documento en store, error persistente y botón de reintento | PASS sintético; reanudación real pendiente |
| ND-14 | Procesar documentos multimodales y voz sin duplicar servicios | §5, §9 | PDFs usan File Search/document processing; Live conserva su canal de audio y función; File Search no se usa para audio/video | Parcial según soporte oficial; OCR/visión real y audio/video persistentes pendientes |
| ND-15 | Rendimiento y costo | §10 | Local BM25/embeddings permanece como fallback; File Search evita reenviar PDF por consulta; benchmark CPU sintético | p50 30.92 ms / p95 39.46 ms local; red, Gemini, tokens/costo y Android NOT RUN |
| ND-16 | Casos de aceptación diversos | §13 | Suite con 12 tipos de pregunta y guards bajo salidas Gemini sintéticas; 63/63 pruebas focalizadas | PASS contractual; no es evaluación real del proveedor |

## Casos de aceptación y alcance de evidencia

| Caso | Cubierto localmente | Límite de lo probado |
|---|---|---|
| Pregunta exacta | Sí | Fixture/modelo simulado |
| Sin palabras clave exactas | Sí | Salida del intérprete simulada |
| Paráfrasis | Sí | Salida del intérprete simulada y recuperación local |
| Expresión coloquial | Sí | Fixture sintético |
| Error típico de transcripción | Sí | Fixture sintético; no audio físico |
| Pregunta incompleta | Sí | Contexto sintético |
| Seguimiento contextual | Sí | Texto y puente Live local |
| Comparación entre documentos | Contrato cubierto | No mide calidad de comparación del proveedor |
| Tabla | Parser de cita/ubicación | No se subió un PDF visual real |
| Diagrama | Entrada y ruta cubiertas por contrato PDF | Comprensión visual real NOT PROVEN |
| Respuesta ausente en PDF | Abstención comprobada | Fixture sintético |
| Número/unidad ambigua | Aclaración comprobada | Fixture sintético; no ASR Android |

## Bloqueos de activación

`YARBI_GEMINI_FILE_SEARCH_ENABLED` está apagada por defecto. La carga requiere
una fuente aprobada y respaldada por la tabla de conocimiento del propietario.
La propuesta SQL todavía no se aplicó y no se configuraron secretos ni variables
en Vercel. Un PDF ya cargado sin binario local requiere volver a seleccionarlo
una vez y validar su SHA-256; nunca se crea otra ficha.
