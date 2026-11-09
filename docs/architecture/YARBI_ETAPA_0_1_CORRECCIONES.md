# Yarbi — Etapa 0.1: correcciones documentales

**Alcance:** documentación y arquitectura local. No se modificaron interfaz,
código funcional, Gemini Live, F03/F04, migraciones, despliegues ni servicios
remotos.

## Matriz de observaciones

| Hallazgo de auditoría | Corrección documental | Documento | Estado |
|---|---|---|---|
| El párrafo no soportaba riqueza inline segura | `paragraph.runs` con `bold` y `italic`, combinación, validación, versionado y fallback textual | Contrato técnico | CORREGIDO DOCUMENTALMENTE |
| `bold_text` podía confundirse con sustituto de párrafo | Se prohíbe como sustituto; la riqueza pertenece a `runs` | Contrato técnico | CORREGIDO DOCUMENTALMENTE |
| Faltaba jerarquía tipográfica verificable | Escala H1/H2/H3/cuerpo/secundario, accesibilidad, contraste, móvil y no sobreestructuración | Documento rector | CORREGIDO DOCUMENTALMENTE |
| BKE no localizaba evidencia temporal multimedia | Localizadores de PDF, Excel, imagen, video y audio; `start_ms`, `end_ms`, `frame_index`, SHA y procedencia | Contrato y arquitectura | CORREGIDO DOCUMENTALMENTE |
| Riesgo de reprocesar originales para preguntas puntuales | Recuperación por referencia indexada, no nuevo análisis completo | Contrato y arquitectura | CORREGIDO DOCUMENTALMENTE |
| Origen de procesamiento BKE ambiguo | Separación entre originales locales Android, procesamiento Gemini autorizado, conocimiento aprobado remoto y referencias | Rector y arquitectura | CORREGIDO DOCUMENTALMENTE |
| Modelo Gemini BKE decidido sin validar capacidades | Se exige comprobar modalidad, formato, duración, cuota, coste y restricciones antes de elegir modelo | Rector, arquitectura y estado | PENDIENTE DE VERIFICACIÓN POSTERIOR |
| Límites Android no medidos | Se exige medir recursos e interrupciones en dispositivo físico, sin límites inventados | Rector, aceptación y estado | PENDIENTE DE MEDICIÓN ANDROID |
| Cifrado offline no tenía decisión ni modelo conceptual | Diferencia Keystore/SQLCipher, alternativas Web/Android y criterios de selección compatibles con Capacitor | Contrato, arquitectura y estado | PENDIENTE DE INSPECCIÓN ANDROID |
| Riesgo de bloquear el inicio del chat por requisitos posteriores | Puertas independientes: Etapa 1 depende de runs/tipografía; BKE y offline tienen prerrequisitos propios | Arquitectura, aceptación y decisiones | CORREGIDO DOCUMENTALMENTE |
| Decisiones sin trazabilidad homogénea | Registro C-14 a C-19 con motivo, fuente, estado, fase y aceptación | Registro de decisiones | CORREGIDO DOCUMENTALMENTE |

## Puertas resultantes

1. **Antes de Etapa 1:** validar renderer de runs, rechazo de HTML/JS/marcas
   desconocidas y jerarquía tipográfica accesible Web/Android.
2. **Antes de BKE:** comprobar modelos/modalidades Gemini, referencias
   multimedia temporales, deduplicación SHA y mediciones Android reales.
3. **Antes de historial offline:** decidir almacenamiento, cifrado, protección
   de claves, retención, eliminación, sincronización, conflictos y búsqueda.

Estas puertas no declaran capacidades implementadas. Tampoco bloquean la
interfaz inicial por BKE, Gemini multimodal o almacenamiento offline aún no
seleccionados.

## Evidencia local considerada

La revisión documental usa el contrato y los documentos de Etapa 0. La revisión
de dependencias disponible sólo confirma Capacitor 5 y reconocimiento de voz en
`package.json`; no prueba un plugin SQLite/SQLCipher, un almacén cifrado nativo
ni medidas de dispositivo Android. No se consultaron servicios externos ni se
registraron secretos.

## Resultado

**ETAPA_0_1_CORRECCIONES_DOCUMENTALES_COMPLETADA.** La implementación de cada
puerta queda fuera de esta etapa y requerirá sus pruebas focalizadas antes de
atribuirle estado funcional.
