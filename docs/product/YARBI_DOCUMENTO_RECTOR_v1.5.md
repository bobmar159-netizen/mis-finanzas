# YARBI Documento Rector del Producto v1.5

**Fecha:** 2026-11-09  
**Estado:** consolidación documental aprobada; no declara implementación adicional.  
**Fuentes:** Documento Rector v1.0 y Registro rector v1.4, ambos preservados.

## 0. Propósito y regla de lectura

Este documento consolida la dirección del producto sin sustituir evidencia técnica. Una capacidad solo se considera implementada cuando exista prueba verificable; las propuestas y hojas de ruta no son implementaciones. Las cláusulas de preservación y los anexos impiden que decisiones v1.0 queden eclipsadas por la ampliación v1.4.

## 1. Cláusulas de preservación obligatoria de v1.0

Las siguientes decisiones de v1.0 permanecen normativas dentro de v1.5. Ninguna sección posterior las sustituye salvo una decisión explícita y aprobada por el propietario.

1. **Cerebro único.** Yarbi conserva FAST para lecturas deterministas, STANDARD para lenguaje natural y contexto, y DEEP para análisis durable cuando exista esa infraestructura. Gemini es el proveedor principal de comprensión, no una autoridad para escribir datos ni ejecutar acciones.
2. **Seguridad.** No existen secretos ni credenciales en frontend. RLS, owner scope, procedencia y autorización gobiernan las consultas y acciones. Las inferencias no se convierten en movimientos, cobros, mensajes ni cambios de cliente.
3. **Fuentes y normas.** Se distinguen texto literal, dato confirmado e interpretación. NTP 111.011:2014 permanece como caso de referencia; nunca se afirma vigencia sin fuente oficial verificada.
4. **Historial offline.** El historial debe permitir recuperación de contenido disponible offline, además de conversación nueva, guardado, título, búsqueda, borrado confirmado y sincronización aislada por propietario.
5. **Integraciones.** CRM, Agenda, Finanzas, WhatsApp Business, WhatsApp personal, Meta Ads, Gemini Live, Supabase y Android forman parte del producto. Meta Ads y su atribución comercial continúan como requisito, aunque v1.4 no los detalle como línea propia.
6. **Experiencia visual.** Se preservan jerarquía legible, accesibilidad, color con texto complementario, acciones pertinentes y una superficie conversacional principal para Web y Android. Inter es candidata tipográfica inicial, pendiente de validación visual.
7. **Voz y compartición.** Voz y texto representan el mismo mensaje lógico; la persona revisa transcripción antes de acciones sensibles. TTS puede detenerse sin bloquear la interfaz. La exportación JPG debe ser local, legible, con fuentes y láminas numeradas cuando haga falta.

## 2. Matriz de trazabilidad

| ID | Requisito | Origen | Estado v1.0 | Estado comprobado | Evidencia | Dependencias | Fase propuesta |
|---|---|---|---|---|---|---|---|
| R-001 | Un solo asistente y una memoria coherente | v1.0, v1.4 | Dirección aprobada | Parcial; integración conversacional candidata | commits Etapa 1 y documentos rectores | renderer, identidad | Integración conversacional |
| R-002 | Rutas FAST, STANDARD y DEEP | v1.0 | Parcial | FAST y comprensión existen; DEEP durable pendiente | matriz v1.0 | modelo de memoria durable | Futura arquitectura |
| R-003 | Gemini interpreta; no escribe ni ejecuta por sí solo | v1.0, v1.4 | Aprobado | Protección de diseño; no se infiere despliegue | secciones de seguridad | autorización backend | Permanente |
| R-004 | Renderer conversacional canónico Web y Android | v1.0, v1.4 | Pendiente en v1.0 | Candidata integrada; validación visual Android pendiente | estado técnico v1.4 | frontend, Android físico | Cierre conversacional |
| R-005 | Voz y texto representan el mismo mensaje lógico | v1.0, v1.4 | Parcial | Barge-in y Android físico no verificados | estado técnico v1.4 | Gemini Live, VAD | Validación Android |
| R-006 | Historial con conversaciones, títulos, búsqueda y offline | v1.0, v1.4 | No completo | No declarar completo | matriz v1.0 y sección 3.4 v1.4 | sincronización y caché | Historial |
| R-007 | Memoria empresarial confirmada, con procedencia | v1.0, v1.4 | Parcial | Sin evidencia de cierre total | secciones 3.5 y 5 v1.4 | RLS, auditoría | Memoria |
| R-008 | BKE: PDF, Excel, imágenes, vídeo, audio e instrucciones | v1.0, v1.4 | Pendiente | Diseño aprobado; no implementación declarada | sección 5 v1.4 | almacenamiento, colas, Gemini | BKE |
| R-009 | NTP 111.011:2014 como caso documental y vigencia oficial | v1.0 | Pendiente | No comprobado | sección 3 v1.0 | fuentes oficiales | BKE |
| R-010 | CRM, Agenda y Finanzas como acciones tipadas separadas | v1.0, v1.4 | Parcial | No se declara sincronización completa | secciones 3 y 8 v1.0/v1.4 | owner scope, confirmación | Integraciones |
| R-011 | RLS y aislamiento por propietario | v1.0, v1.4 | Aprobado como requisito | No se declara cobertura universal | secciones 8-10 v1.0/v1.4 | Supabase y backend | Seguridad |
| R-012 | Ningún secreto ni credencial en frontend | v1.0 | Aprobado | Requisito permanente | seguridad v1.0 | configuración server-side | Seguridad |
| R-013 | WhatsApp Business y personal, sin duplicar mensajería | v1.0, v1.4 | Parcial | Activación condicionada a proveedores autorizados | secciones 13-23 v1.4 | proveedor, consentimiento | WhatsApp |
| R-014 | Gestión asistida y autónoma de WhatsApp por reglas confirmadas | v1.4 | Nueva decisión | Futura implementación | secciones 13-19 v1.4 | identidad, agenda, autorización | WhatsApp |
| R-015 | Visitas y agenda con una fuente canónica | v1.4 | Nueva decisión | Futura implementación | secciones 15-22 v1.4 | CRM, Calendar | Agenda |
| R-016 | Sincronización idempotente con Google Calendar | v1.4 | Nueva decisión | No comprobada | sección 16 v1.4 | credenciales y calendar | Agenda |
| R-017 | Plantillas, consentimiento y estados reales de WhatsApp | v1.4 | Nueva decisión | No comprobada | sección 23 v1.4 | Meta/proveedor | WhatsApp |
| R-018 | Meta Ads y atribución comercial preservadas | v1.0 | Parcial | Sin evidencia de integración en v1.4 | integraciones v1.0 | fuente de campañas, CRM, Finanzas | Meta Ads |
| R-019 | Financial Coach y meta de S/500 diarios libres | v1.4 | Nueva decisión | Diseño aprobado; no implementación declarada | sección 7 v1.4 | fuentes financieras canónicas | Finanzas |
| R-020 | Datos financieros confirmados, estimados o incompletos | v1.4 | Nueva decisión | Requisito de diseño | secciones 7.3-7.9 v1.4 | modelo contable | Finanzas |
| R-021 | Tutor personal y conocimiento general separados del negocio | v1.4 | Nueva decisión | Futura implementación | sección 6 v1.4 | memoria y permisos | Tutor |
| R-022 | Exportación JPG legible y compartible | v1.0, v1.4 | Pendiente | No comprobada | secciones 3.4 y 23 v1.4 | render local, Android share | Exportación |
| R-023 | Fuentes: texto literal, dato confirmado e interpretación | v1.0, v1.4 | Aprobado | No declarar implementación total | secciones 3 y 5 | citas y provenance | BKE |
| R-024 | Acciones sensibles con backend, scope y confirmación | v1.0, v1.4 | Aprobado | Requisito permanente | secciones 8 y 13 v1.4 | autorización y auditoría | Seguridad |
| R-025 | Rendimiento y experiencia Android medidos en dispositivo | v1.0, v1.4 | Pendiente | Android físico no verificado | estado técnico y sección 5 v1.4 | dispositivo físico | Validación Android |
| R-026 | No asumir acceso a historial que el proveedor no entrega | v1.4 | Nueva decisión | Requisito permanente | secciones WhatsApp v1.4 | proveedor | WhatsApp |
| R-027 | Restauración de conversación, scroll y borrador entre módulos | v1.0, v1.4 | Pendiente | No declarar completa | sección 3.4 v1.4 | estado interfaz | Historial |
| R-028 | Contradicciones de fuentes y cambios con auditoría | v1.0, v1.4 | Pendiente | Diseño aprobado | BKE v1.0/v1.4 | versionado y revisión | BKE |

## 3. Contradicciones y estados que no se resuelven automáticamente

| ID | Tensión detectada | Tratamiento en v1.5 |
|---|---|---|
| C-001 | v1.0 describe la nueva experiencia como pendiente; v1.4 describe una integración candidata y una validación parcial. | Se conserva la evidencia de ambos estados. Solo los commits, pruebas y auditorías identificadas pueden cerrar una capacidad concreta. |
| C-002 | v1.4 planifica autonomía por WhatsApp; v1.0 exige confirmación humana para acciones sensibles. | La autonomía solo puede operar dentro de reglas confirmadas, autorización verificable, límites, trazabilidad e idempotencia. |
| C-003 | v1.4 prioriza conocimiento reutilizable local/nube; v1.0 exige originales locales cuando corresponda. | Los originales no se mueven ni se asumen disponibles en nube; conocimiento aprobado y originales mantienen capas separadas. |
| C-004 | v1.4 usa Meta para políticas de WhatsApp; v1.0 preserva Meta Ads. | Meta Ads no queda descartado: requiere una especificación y fuente canónica de campañas, CRM, Finanzas y atribución antes de implementación. |

## 4. Historial de versiones

| Versión | Fecha | Alcance |
|---|---|---|
| v1.0 | Fecha histórica del repositorio | Identidad, cerebro FAST/STANDARD/DEEP, conversación, fuentes, voz, memoria, BKE, integraciones y matriz inicial. |
| v1.4 | 2026-11-09 | Registro ampliado: renderer, voz, BKE, tutor, Financial Coach, WhatsApp, visitas y agenda. |
| v1.5 | 2026-11-09 | Consolidación documental: incorpora v1.4 y restituye explícitamente todas las decisiones de v1.0 mediante cláusulas, matriz y anexos de preservación. |

## 5. Cuerpo incorporado de v1.4


**Versión:** 1.4\
**Fecha de actualización:** 9 de noviembre de 2026\
**Estado:** Documento vivo de producto y arquitectura — actualización v1.4\
**Propietario del producto:** Omar\
**Propósito:** conservar la visión, las decisiones aprobadas, las
propuestas pendientes y las reglas de dirección del desarrollo de Yarbi.

> **Principio rector:** el propietario aporta las ideas y conoce su
> negocio. La dirección del producto debe analizarlas, cuestionarlas,
> identificar riesgos, proponer mejoras y ordenar su implementación. No
> se debe convertir cada idea automáticamente en una tarea de código.

------------------------------------------------------------------------

## 0. Cómo debe utilizarse este documento

Este archivo es la referencia de continuidad del proyecto. Debe
mantenerse versionado dentro del repositorio y actualizarse cuando se
apruebe una nueva decisión.

**Ruta recomendada dentro del repositorio:**

`docs/product/YARBI_REGISTRO_RECTOR_VISION_DECISIONES.md`

### Instrucción obligatoria para Codex y Antigravity

Antes de ejecutar cualquier tarea relacionada con producto,
arquitectura, interfaz, inteligencia, voz, conocimiento o finanzas:

1.  Leer este documento y los contratos técnicos específicos de la fase.
2.  Identificar qué decisiones están aprobadas, cuáles son propuestas y
    cuáles siguen pendientes.
3.  No contradecir una decisión aprobada sin explicar el motivo y
    solicitar revisión.
4.  No implementar funcionalidades fuera del alcance autorizado.
5.  Al terminar, informar qué decisiones se implementaron, cuáles siguen
    pendientes y si este documento requiere actualización.
6.  No modificar este documento para declarar una decisión aprobada si
    el propietario no la ha aprobado.

### Roles de trabajo

  -----------------------------------------------------------------------
  Rol                                 Responsabilidad
  ----------------------------------- -----------------------------------
  Propietario (Omar)                  Aporta ideas, conoce la operación
                                      real, define prioridades y aprueba
                                      decisiones de producto.

  Dirección de producto y             Analiza, critica, propone mejoras,
  arquitectura (ChatGPT)              ordena fases, define criterios y
                                      prepara instrucciones.

  Codex                               Implementa, prueba, documenta y
                                      entrega commits verificables.

  Antigravity                         Audita de forma independiente,
                                      revisa seguridad, arquitectura,
                                      regresiones y evidencia.
  -----------------------------------------------------------------------

**Regla de coordinación:** Codex y Antigravity no deben modificar
simultáneamente el mismo workspace o rama. Antes de preparar un prompt,
confirmar si cada agente está libre, trabajando o esperando. La
auditoría debe ejecutarse sobre un commit identificado y no debe
modificar código salvo autorización expresa.

------------------------------------------------------------------------

## 1. Visión del producto

Yarbi debe evolucionar hacia un asistente inteligente, proactivo y
confiable que conozca el negocio del propietario, ayude a dirigir su
operación, comprenda documentación técnica, enseñe y converse de manera
natural.

No debe ser solamente: - un chatbot que espera preguntas; - una
colección de botones y formularios; - un panel que repite cifras sin
interpretarlas; - una voz que suena bien pero desconoce el negocio.

Debe combinar: - conversación natural; - conocimiento empresarial
verificable; - comprensión de clientes y operaciones; - inteligencia
financiera; - iniciativa responsable; - tutoría y explicación; - una
identidad vocal coherente; - una interfaz visual limpia y expresiva.

La tecnología debe servir al negocio. Las auditorías y correcciones son
necesarias, pero no deben hacer que el equipo pierda de vista esta
visión.

------------------------------------------------------------------------

## 2. Estado técnico conocido al 9 de noviembre de 2026

### 2.1 Integración conversacional candidata

Codex reportó la integración candidata en:

-   Rama: `etapa1-conversation-integration`
-   Commit: `6223b8ca02162457987c717cb0444b7b9501bcde`
-   `main`: permanece en `6b2431a`.
-   F04.2 y F04.3: excluidas de la ascendencia de la candidata.
-   Cambios reportados: deduplicación de finales Live idénticos entre
    sesiones/turnos y recuperación tras fallo del renderer.

Resultados reportados: - Live + renderer: 21/21 PASS. - F03 + renderer +
Live: 28/28 PASS. - Frontend unificado: 4/4 PASS. - Suite completa: 456
PASS, 67 FAIL, 6 TODO. - Los 67 fallos se reportan como históricos e
idénticos a F03. - Deuda pendiente: hash histórico de VAD. - Android
físico: NO VERIFICADO.

**Estado:** candidata terminada por Codex y detenida para auditoría
independiente de Antigravity. No considerar la integración en `main`
aprobada hasta recibir el dictamen y verificar la evidencia.

### 2.2 Restricciones actuales

-   No asumir que la candidata ya está integrada en `main`.
-   No asumir que existe validación física Android.
-   No asumir que el Barge-in está validado físicamente.
-   No incorporar F04.2/F04.3 sin una decisión explícita de integración
    y una base segura.
-   No realizar despliegues, migraciones remotas ni cambios en
    Production sin autorización.

------------------------------------------------------------------------

## 3. Experiencia conversacional y renderer

### 3.1 Decisión de producto

El chat debe ser el espacio principal de interacción con Yarbi. Debe
sentirse como una conversación con un asistente inteligente, no como un
formulario ni una pantalla administrativa.

La presentación debe adaptarse a la complejidad y finalidad de cada
respuesta.

### 3.2 Recursos visuales aprobados como objetivo

-   Tipografía legible y jerarquizada.
-   Títulos principales más grandes y en negrita.
-   Subtítulos.
-   Negritas y cursivas.
-   Emojis y signos de puntuación usados con criterio.
-   Chips informativos.
-   Marcos delicados y fondos tenues.
-   Paneles y bloques de conclusión.
-   Listas numeradas y checks.
-   Tablas comparativas.
-   Imágenes, diagramas y recortes de documentos.
-   Citas con página, sección y procedencia.
-   Exportación de respuestas a JPG para compartir por WhatsApp.

### 3.3 Adaptación visual

-   Preguntas simples: respuesta breve, sin adornos innecesarios.
-   Listas operativas: numeración, estados y orden por prioridad.
-   Diagnósticos: títulos, indicadores, explicación, riesgos y
    recomendaciones.
-   Normas y documentación: citas, página, fragmento pertinente y
    recurso visual cuando exista.
-   Tutoría: pasos, ejemplos, analogías y comprobación de comprensión.

No llenar todas las respuestas de tarjetas, botones o marcos. La
jerarquía visual debe ayudar a comprender, no distraer.

### 3.4 Conversaciones e historial

Objetivos: - historial persistente; - conversaciones independientes; -
títulos editables; - iniciar una conversación nueva; - eliminar
conversaciones; - desplazamiento natural del historial; - exportar
respuestas como JPG; - restaurar la posición y estado visual al volver a
la pestaña del chat.

La restauración exacta entre pestañas queda como fase propia y no debe
darse por implementada por el solo hecho de tener historial.

### 3.5 Separación conceptual

-   **Historial:** conserva lo que se dijo en una conversación.
-   **Memoria empresarial:** conserva conocimiento confirmado y
    reutilizable.
-   **Fuentes documentales:** conservan la procedencia de las
    afirmaciones.
-   **Estado de interfaz:** conserva dónde estaba el usuario en el chat.

No mezclar estas responsabilidades.

------------------------------------------------------------------------

## 4. Voz, personalidad e interacción en tiempo real

### 4.1 Identidad vocal

Yarbi debe mantener una identidad vocal coherente durante una
conversación.

Debe poder variar: - entusiasmo; - seriedad; - paciencia; - empatía; -
énfasis; - ritmo y entonación moderados.

No debe cambiar automáticamente de timbre, acento o personalidad porque
el router seleccione otra ruta.

### 4.2 Arquitectura objetivo

-   Gemini Live es el candidato principal para conversación
    bidireccional en tiempo real.
-   TTS puede ser un complemento para lecturas largas o narraciones
    preparadas.
-   No cambiar automáticamente de Live a TTS en mitad de una
    conversación.
-   La voz complementaria debe evaluarse por similitud vocal,
    expresividad, latencia y coste antes de habilitarse.
-   No fijar una versión o tarifa de modelo como decisión permanente sin
    verificar documentación y precios vigentes.

### 4.3 Interrupciones y audio

-   Preservar VAD y Barge-in.
-   El usuario debe poder interrumpir a Yarbi y recuperar el turno.
-   No declarar Barge-in validado físicamente sin una prueba en
    dispositivo Android real.
-   Evitar duplicados de transcripción y de finalización de turnos.
-   Texto y voz deben utilizar el mismo recorrido conversacional y
    renderer cuando corresponda.

### 4.4 Mensajes de voz de WhatsApp y llamadas

Objetivos: - transcribir notas de voz entrantes; - procesarlas como
mensajes conversacionales, manteniendo el original y la transcripción
según las políticas de almacenamiento; - conservar la relación con
cliente, conversación y procedencia; - permitir que clientes que solo
envían audio tengan un perfil útil; - registrar llamadas y
coordinaciones telefónicas cuando exista una fuente legítima de datos o
un registro autorizado; - incorporar al perfil del cliente los
resultados y compromisos de llamadas.

No afirmar que Yarbi conoce el contenido de una llamada si no existe
transcripción, grabación autorizada o nota registrada. Respetar
consentimiento y normativa aplicable.

------------------------------------------------------------------------

## 5. Business Knowledge Engine (BKE)

### 5.1 Objetivo

Yarbi debe aprender el funcionamiento del negocio a partir de
documentación y material de referencia, y reutilizar ese conocimiento en
consultas posteriores sin volver a procesar innecesariamente los
archivos originales.

### 5.2 Fuentes iniciales aprobadas

-   PDF.
-   Excel.
-   Imágenes.
-   Videos.
-   Audios.
-   Instrucciones escritas.

### 5.3 Almacenamiento

Decisión aprobada: - Los archivos originales permanecen en el celular
del propietario. - El conocimiento procesado debe poder reutilizarse en
local y en nube, sujeto a diseño de sincronización, seguridad,
almacenamiento y disponibilidad.

**Decisión técnica pendiente:** determinar qué etapas de extracción se
ejecutan en el teléfono y cuáles requieren procesamiento asistido por
servidor. No asumir que un teléfono puede procesar de forma eficiente
cualquier video o documento grande. Priorizar procesamiento por etapas,
límites de tamaño, colas reanudables y no subir originales pesados por
defecto.

No almacenar automáticamente videos completos en la nube. Diseñar
extracción selectiva de audio, fotogramas relevantes, OCR, transcripción
y descripciones visuales según el contenido y las capacidades reales de
los proveedores.

### 5.4 Aprendizaje una sola vez y reutilización

Objetivo: 1. Importar el archivo. 2. Extraer contenido útil. 3.
Conservar la procedencia y estructura. 4. Generar conocimiento
consultable. 5. Solicitar aprobación del propietario. 6. Publicar la
versión aprobada en la memoria empresarial. 7. Reutilizarla en consultas
futuras sin reprocesar el original, salvo cambios, correcciones o
necesidad de una extracción mejor.

Esto no equivale a entrenar o modificar los pesos del modelo Gemini. Es
una base de conocimiento externa, indexada y recuperable.

### 5.5 Revisión y corrección

El propietario debe poder preguntar: - qué entendió Yarbi; - qué partes
encontró; - qué interpretó; - qué conclusiones obtuvo; - qué evidencia
respalda cada conclusión.

Debe poder corregir una interpretación y solicitar una nueva versión del
conocimiento. Las correcciones deben conservar historial, autor, fecha,
fuente y versión previa.

La aprobación requerida para publicar conocimiento es **todas las
fuentes**: ningún conocimiento extraído se incorpora como conocimiento
empresarial confirmado sin revisión y aprobación del propietario.

### 5.6 Normas técnicas y respuestas documentales

Cuando el propietario pregunte, por ejemplo, dónde una norma permite una
configuración concreta, Yarbi debe: - localizar el artículo, numeral,
tabla o apartado; - citar página y sección; - diferenciar texto literal
de interpretación; - mostrar la página o recorte pertinente; - mostrar
diagramas o imágenes de la norma cuando ayuden; - advertir cuando la
norma no respalda la conclusión; - no inventar citas ni completar vacíos
con suposiciones.

La respuesta debe distinguir claramente evidencia documental,
interpretación y conocimiento general externo.

------------------------------------------------------------------------

## 6. Tutor personal y conocimiento general

Yarbi debe poder responder preguntas que no estén relacionadas con
clientes ni con el CRM.

Objetivos: - cultura general; - preguntas técnicas; - tutoría para
exámenes; - explicación de normas; - enseñanza interactiva.

Como tutor debe: - explicar de forma sencilla; - usar ejemplos claros y
progresivos; - recurrir a analogías; - mostrar diagramas cuando aporten
valor; - comprobar comprensión; - detectar errores y explicarlos sin
humillar; - adaptar profundidad y vocabulario.

No limitar el asistente a consultas comerciales. El router debe
distinguir entre consulta empresarial, consulta documental, conocimiento
general y tutoría.

------------------------------------------------------------------------

## 7. Yarbi Financial Coach

### 7.1 Objetivo y meta principal

Meta indicada por el propietario:

**S/500 diarios de dinero libre después de costos directos y gastos
operativos.**

La frecuencia exacta del calendario de producción, los días productivos
y el tratamiento de impuestos/reservas deben configurarse y confirmarse.
No asumir automáticamente 26 días por mes.

### 7.2 Tres conceptos que nunca deben confundirse

**A. Producción o resultado neto operativo**

Resultado neto operativo = ingresos reconocidos de trabajos - costos
directos - gastos operativos asignados.

**B. Cobranza efectiva**

Dinero que efectivamente ingresó a las cuentas o caja.

**C. Efectivo disponible**

Cobros recibidos - pagos efectuados - compromisos y reservas que deben
mantenerse.

Un trabajo puede generar resultado económico sin que el cliente haya
pagado. Una cuenta por cobrar no es efectivo disponible.

### 7.3 Fuentes canónicas que debe analizar

-   Movimientos.
-   Deudas.
-   Producción y servicios.
-   CRM.
-   Agenda.
-   Cotizaciones.
-   Costos directos.
-   Gastos operativos.

Primero auditar los modelos y relaciones existentes. Reutilizar las
fuentes canónicas; no crear una contabilidad paralela ni duplicar
movimientos.

### 7.4 Clasificación y separación

Distinguir: - ingresos reconocidos; - cobros recibidos; - costos
directos; - gastos operativos fijos y variables; - transferencias
internas; - deudas y amortizaciones; - intereses; - impuestos y reservas
tributarias; - retiros personales; - obligaciones personales.

La hipoteca personal es una obligación personal, no un gasto operativo
del negocio. Puede incorporarse a la planificación de liquidez y metas
personales sin contaminar el resultado operativo.

No contar cotizaciones como ingresos asegurados. No contar promesas de
pago como efectivo recibido. No duplicar transferencias entre cuentas
propias.

### 7.5 Motor de cálculo

Los cálculos, saldos, proyecciones y validaciones deben ejecutarse
mediante servicios deterministas y auditables.

Gemini: - interpreta instrucciones; - explica resultados; - compara
escenarios; - identifica señales; - formula recomendaciones.

Gemini no debe inventar ni calcular por sí solo los saldos oficiales.

Cada cifra debe conservar: - periodo; - moneda; - fuente; - fecha de
actualización; - fórmula; - estado (confirmado, estimado o incompleto).

### 7.6 Gestión de metas

El propietario debe poder decir: - «Necesito generar S/500 diarios». -
«Quiero alcanzar S/15,000 este mes». - «Necesito reservar dinero para la
hipoteca antes del día 25». - «Quiero reducir mis costos». - «Analiza si
mi producción alcanza para cubrir mis obligaciones».

Yarbi debe interpretar la instrucción, identificar el indicador y
periodo, preguntar si falta información, mostrar cómo medirá la meta y
solicitar confirmación antes de guardar cambios ambiguos.

Conservar historial de metas y modificaciones.

### 7.7 Proyecciones

Calcular: - resultado neto acumulado; - promedio diario; - brecha
respecto a la meta; - producción necesaria por día productivo
restante; - proyección mensual; - cobros esperados; - obligaciones
próximas; - brecha de liquidez; - escenarios conservadores y posibles.

No presentar estimaciones como garantías. No considerar cotizaciones
como ingresos asegurados.

### 7.8 Coach proactivo

Yarbi puede intervenir ante: - caída de producción; - meta incumplida de
forma recurrente; - cobros vencidos; - hipoteca u obligación próxima; -
falta de liquidez proyectada; - cotizaciones sin seguimiento; - costos
operativos crecientes; - oportunidades comerciales relevantes.

Reglas: - no asumir que la ausencia de registros equivale a
inactividad; - verificar actualidad y procedencia de los datos; - no
repetir alertas ya atendidas; - respetar horarios y preferencias de
interrupción; - priorizar por impacto; - ser motivador y exigente con
respeto; - no culpabilizar ni manipular emocionalmente; - no contactar
clientes, pagar, transferir ni modificar registros financieros sin
autorización explícita.

### 7.9 Privacidad

La información financiera personal debe mantenerse separada de la
información comercial de clientes. El propietario puede autorizar que
Yarbi las relacione para planificar objetivos, pero no deben mezclarse
indiscriminadamente ni exponerse en respuestas dirigidas a terceros.

------------------------------------------------------------------------

## 8. Principios de arquitectura compartidos

1.  Una fuente canónica para cada dato.
2.  Separar historial, memoria empresarial, documentos y estado de
    interfaz.
3.  Owner scope y autorización en todas las operaciones.
4.  Provenance y trazabilidad para conocimiento y cálculos.
5.  Confirmación explícita para acciones sensibles.
6.  Cálculos financieros deterministas.
7.  Gemini como intérprete y comunicador, no como base de datos ni
    calculadora oficial.
8.  No encadenar modelos innecesariamente.
9.  Optimizar coste sin sacrificar identidad vocal, seguridad ni
    experiencia.
10. Mantener compatibilidad con el renderer conversacional canónico.
11. Las funcionalidades deben degradarse de forma segura cuando falten
    fuentes o servicios.
12. No declarar validaciones que no se ejecutaron.

------------------------------------------------------------------------

## 9. Hoja de ruta priorizada

El orden puede ajustarse con evidencia, pero no se deben mezclar fases
sin justificación.

### Prioridad inmediata: cerrar la integración conversacional

1.  Auditoría independiente de Antigravity sobre `6223b8c`.
2.  Resolver observaciones si las hay.
3.  Integrar en `main` solo con dictamen favorable y autorización.
4.  Planificar y ejecutar prueba física Android, especialmente voz,
    interrupciones y restauración.

### Financial Coach

1.  Auditoría de solo lectura de Movimientos, Deudas, Producción, CRM,
    Agenda y Cotizaciones.
2.  Modelo financiero y reglas contables.
3.  Motor determinista.
4.  Gestión de metas.
5.  Proyecciones y obligaciones.
6.  Coach proactivo.
7.  Integración visual en el chat.
8.  Validación financiera, seguridad, Android y auditoría independiente.

### Otras líneas de producto

-   Business Knowledge Engine.
-   Procesamiento multimedia y documentos normativos.
-   Tutor personal.
-   Voz expresiva e identidad vocal.
-   Historial avanzado y restauración de interfaz.
-   Exportación JPG y compartición.

Estas líneas deben conservarse en el plan aunque no sean la siguiente
tarea inmediata.

------------------------------------------------------------------------

## 10. Criterios generales de aceptación

Una fase no se considera terminada solo porque compila.

Debe entregar: - commit identificado; - rama y base declaradas; -
archivos modificados; - pruebas ejecutadas y resultados; - pruebas no
ejecutadas; - limitaciones; - riesgos conocidos; - evidencia de
seguridad; - documentación; - hashes cuando corresponda; - confirmación
de que no hubo cambios fuera del alcance.

Las pruebas sintéticas no equivalen a pruebas con Supabase real, Android
físico o proveedores reales.

------------------------------------------------------------------------

## 11. Registro de decisiones y cambios

  -----------------------------------------------------------------------
  Fecha                   Tema                    Decisión / estado
  ----------------------- ----------------------- -----------------------
  2026-11-09              Integración             Candidata `6223b8c`,
                          conversacional          pendiente de auditoría
                                                  independiente.

  2026-11-09              Financial Coach         Aprobado como objetivo
                                                  de producto; S/500
                                                  diarios netos
                                                  operativos.

  2026-11-09              Identidad vocal         Una identidad
                                                  coherente; no cambiar
                                                  de motor
                                                  automáticamente durante
                                                  una conversación.

  2026-11-09              Chat                    Renderer visual
                                                  adaptativo, limpio e
                                                  informativo.

  2026-11-09              BKE                     Fuentes PDF, Excel,
                                                  imágenes, videos,
                                                  audios e instrucciones;
                                                  originales locales;
                                                  aprobación de todo
                                                  conocimiento.

  2026-11-09              Tutor                   Yarbi debe enseñar y
                                                  responder conocimiento
                                                  general, además de
                                                  operar el negocio.

  2026-11-09              Proactividad            Coach empresarial y
                                                  financiero basado en
                                                  datos verificables y
                                                  con límites de
                                                  interrupción.
  -----------------------------------------------------------------------

### Plantilla para nuevas decisiones

-   Fecha:
-   Idea del propietario:
-   Análisis crítico:
-   Riesgos:
-   Propuesta mejorada:
-   Estado: APROBADA / PROPUESTA / DESCARTADA / PENDIENTE
-   Impacto arquitectónico:
-   Fase prevista:
-   Criterios de aceptación:
-   Evidencia o commit:

------------------------------------------------------------------------

## 12. Regla final de dirección

No perder la visión general de Yarbi por concentrarse exclusivamente en
auditorías, correcciones o tareas aisladas.

Cada decisión técnica debe responder a una pregunta:

**¿Esto ayuda a que Yarbi conozca mejor el negocio, razone con
información fiable, se comunique mejor o ayude al propietario a tomar
mejores decisiones?**

Si no aporta valor suficiente, debe cuestionarse antes de implementarse.


---

# ADENDA v1.1 — AUTONOMÍA COMERCIAL Y GESTIÓN DE VISITAS POR WHATSAPP

**Fecha:** 9 de noviembre de 2026  
**Estado:** Decisiones de producto aprobadas para especificación; implementación pendiente.

Esta adenda amplía el registro rector. No declara que estas funciones ya estén implementadas.

## 13. Dos modos de atención comercial por WhatsApp

Yarbi tendrá dos modos de operación, configurables y sujetos a permisos:

### 13.1 Modo asistido

- Yarbi analiza los mensajes del cliente y propone respuestas.
- El propietario puede aprobar, editar, pedir mejoras o descartar la propuesta.
- Yarbi aprende preferencias de comunicación a partir de correcciones repetidas, pero no modifica reglas comerciales críticas sin confirmación.
- Las propuestas no se envían hasta que el propietario las aprueba.

### 13.2 Modo autónomo por instrucciones

- El propietario define reglas comerciales mediante lenguaje natural.
- Yarbi convierte cada instrucción en una regla estructurada, muestra qué entendió y solicita confirmación para activarla.
- Una vez activada, Yarbi puede ejecutar automáticamente las acciones expresamente autorizadas cuando se cumplan sus condiciones.
- Debe respetar límites, excepciones, horarios, estados del cliente y reglas de seguridad.
- El propietario puede pausar, modificar o retirar cualquier regla.
- Debe existir trazabilidad de la instrucción original, su versión, aprobación, ejecuciones y mensajes enviados.

La autonomía puede configurarse por canal, conversación, cliente o tipo de servicio. No debe suponerse que un único modo global es adecuado para todos los contactos.

### 13.3 Seguridad de las instrucciones del propietario

- Las instrucciones administrativas recibidas por WhatsApp solo se aceptan desde una identidad del propietario previamente vinculada y autenticada.
- Un mensaje de un cliente nunca debe interpretarse como una orden administrativa para cambiar precios, reglas, permisos o agenda.
- Las acciones sensibles deben requerir confirmación adicional cuando corresponda.
- Debe registrarse quién dio la instrucción, cuándo, qué regla se activó y qué acciones ejecutó Yarbi.

## 14. Reglas comerciales por tipo de servicio

### 14.1 Conversión de cocina doméstica

Regla indicada por el propietario:

- Precio: S/80 para conversión de cocina doméstica.
- No programar visita previa para este servicio rutinario.
- Preguntar únicamente si la cocina es doméstica o comercial.
- Si es doméstica, comunicar el precio y, si el cliente acepta, solicitar ubicación para coordinar el trabajo.
- No prolongar la conversación con preguntas técnicas innecesarias.
- No solicitar fotografías ni visitas salvo que aparezca una condición excepcional de seguridad, incompatibilidad o incertidumbre que lo justifique.

**Cocina comercial:** la tarifa comercial todavía no está definida. Yarbi no debe aplicar automáticamente los S/80 ni inventar un precio; debe recopilar el dato necesario y consultar la tarifa autorizada o al propietario.

### 14.2 Servicios que normalmente justifican evaluación presencial

El propietario identificó como ejemplos:

- Modificación de tuberías.
- Instalación de puntos adicionales.
- Instalaciones desde el medidor.

Para estos servicios, Yarbi debe recopilar la información inicial y procurar coordinar una visita de evaluación según las reglas autorizadas.

### 14.3 Criterio de sentido común comercial

No decidir únicamente por el precio. La decisión debe considerar:

- tipo de servicio;
- complejidad;
- alcance conocido o desconocido;
- rentabilidad y coste de movilización;
- incertidumbre técnica;
- seguridad;
- disponibilidad y zona de atención.

Un servicio de bajo importe no requiere automáticamente una visita; un trabajo de mayor complejidad puede necesitar evaluación aunque el precio final aún no se conozca. La seguridad y la incertidumbre técnica pueden prevalecer sobre la rentabilidad.

## 15. Gestión de visitas mediante instrucciones naturales de WhatsApp

### 15.1 Instrucción de ejemplo

El propietario puede escribir a Yarbi:

“Genera visita para la señora Mariane el sábado a las 8 a. m. Precio acordado S/400. Servicio: modificación de tubería”.

Yarbi debe interpretar la instrucción y preparar el registro utilizando el formulario y modelo de visita ya existentes en la aplicación.

### 15.2 Datos que Yarbi debe extraer o comprobar

- Cliente y contacto correcto.
- Servicio solicitado.
- Precio acordado y moneda.
- Fecha absoluta y hora local.
- Ubicación compartida por el cliente, si existe.
- Dirección o referencia textual.
- Distrito.
- Notas e indicaciones.
- Disponibilidad del propietario o técnico.
- Estado de confirmación de la visita.
- Identificador del contacto y de la conversación de origen.

No inventar datos faltantes ni asociar la visita a una persona ambigua. Si existen varios contactos con el mismo nombre, pedir una aclaración.

### 15.3 Preguntas por datos faltantes

Yarbi debe detectar los campos ausentes o ambiguos y comunicarlos de forma clara, preferentemente en una sola respuesta compacta.

Ejemplos:
- “Tengo cliente, servicio, precio y hora. Me falta la ubicación o el distrito”.
- “¿Te refieres al sábado 14 de noviembre?”
- “Hay otra visita en ese horario. ¿Quieres elegir otro horario?”

La fecha relativa debe convertirse en fecha absoluta usando la zona horaria del negocio (America/Lima) y debe mostrarse al propietario para evitar errores.

### 15.4 Instrucción “guárdalo así nomás”

Si el propietario responde explícitamente “guárdalo así nomás”:

- Yarbi puede guardar el registro con los datos disponibles.
- Los campos desconocidos permanecen nulos o marcados como pendientes; nunca se inventan.
- El registro debe quedar identificado como incompleto o pendiente de coordinación.
- Si existe fecha y hora válidas, puede crearse una reserva provisional o evento pendiente, sujeto a las reglas de disponibilidad.
- Si falta fecha u hora, no debe bloquear un horario inexistente: guardar como solicitud o borrador pendiente de programación.
- La falta de ubicación no impide guardar la solicitud, pero debe quedar visible como pendiente.
- No enviar al cliente una confirmación definitiva con datos incompletos. Si procede, preparar un mensaje de coordinación que no prometa una visita confirmada.

### 15.5 Disponibilidad y conflictos

Antes de confirmar una visita, Yarbi debe consultar el calendario de la aplicación y las reglas de disponibilidad existentes.

- No sobrescribir ni duplicar citas.
- Detectar conflictos de horario.
- No asumir que el propietario está libre.
- Diferenciar visita solicitada, provisional, confirmada, realizada, cancelada y reprogramada.
- La confirmación definitiva debe respetar los criterios de negocio configurados.

## 16. Integración con el formulario, calendario de la app y Google Calendar

### 16.1 Una sola fuente canónica

- Reutilizar el formulario y el modelo de visitas que ya existen en Yarbi.
- No crear una segunda agenda ni una tabla paralela sin justificación arquitectónica.
- El registro de visita de Yarbi debe ser la fuente canónica.
- Google Calendar funciona como calendario sincronizado, no como una segunda fuente independiente.

### 16.2 Sincronización segura

- Crear primero el registro canónico de visita en Yarbi.
- Sincronizarlo con Google Calendar mediante un mecanismo idempotente.
- Guardar el identificador externo de Google Calendar y el estado de sincronización.
- Reintentar fallos sin crear eventos duplicados.
- Si Google Calendar no está disponible, conservar la visita en Yarbi y marcar la sincronización como pendiente.
- Actualizaciones, cancelaciones y reprogramaciones deben reflejarse en ambos calendarios sin duplicaciones.
- Respetar autenticación, permisos OAuth y consentimiento del propietario.

### 16.3 Ubicación

- Si el cliente comparte una ubicación de WhatsApp, conservar la evidencia recibida y extraer coordenadas/datos disponibles.
- No convertir coordenadas en una dirección exacta sin un servicio de geocodificación fiable.
- Distinguir ubicación GPS, dirección escrita y distrito inferido.
- Marcar la precisión y procedencia de cada dato.
- Si la ubicación no se recibió, no inventarla ni colocar una dirección aproximada como confirmada.

## 17. Presentación de la visita al cliente por WhatsApp

Una vez que la visita esté confirmada y los datos estén verificados, Yarbi debe enviar una presentación clara, ordenada y profesional que incluya, cuando corresponda:

- Nombre del cliente.
- Servicio.
- Fecha y hora.
- Precio acordado.
- Ubicación o dirección confirmada.
- Indicaciones relevantes.
- Estado de la coordinación.

El mensaje debe utilizar el formato que WhatsApp realmente soporte: texto bien estructurado, negritas y separadores compatibles. Una tarjeta visual JPG puede evaluarse como mejora posterior; no asumir que WhatsApp permite insertar componentes de interfaz arbitrarios dentro de un mensaje normal.

Si la visita está incompleta o provisional, el mensaje no debe presentarla como confirmada. Cualquier comunicación de coordinación debe respetar las autorizaciones del propietario y el estado real de la cita.

## 18. Registro, auditoría y métricas comerciales

Cada instrucción y ejecución debe conservar:

- instrucción original del propietario;
- regla aplicada y versión;
- cliente y conversación;
- datos extraídos y su procedencia;
- campos pendientes;
- confirmaciones recibidas;
- registro de visita creado o actualizado;
- estado de sincronización con Google Calendar;
- mensajes enviados;
- errores y reintentos.

El sistema debe permitir medir el embudo:
- clientes interesados;
- ubicaciones recibidas;
- visitas solicitadas;
- visitas programadas;
- visitas realizadas;
- trabajos vendidos;
- importe acordado;
- resultado económico real.

La tasa de conversión de visitas mencionada por el propietario (aproximadamente 8–9 de cada 10 en su experiencia) es una hipótesis operativa inicial, no una estadística validada. Yarbi deberá medirla con datos reales y definir claramente el denominador.

## 19. Criterios de aceptación para esta capacidad

La funcionalidad no se considerará terminada hasta demostrar:

1. Diferencia entre modo asistido y modo autónomo.
2. Autenticación del propietario para instrucciones administrativas.
3. Reglas comerciales aprobadas, versionadas y editables.
4. Clasificación correcta de conversión doméstica, comercial y trabajos que requieren evaluación.
5. Extracción correcta de cliente, servicio, precio, fecha y hora.
6. Preguntas claras ante datos faltantes o ambiguos.
7. Guardado incompleto sin inventar datos cuando el propietario lo autorice.
8. Reutilización del formulario y modelo de visita existentes.
9. Detección de conflictos de agenda.
10. Sincronización idempotente con Google Calendar.
11. Mensaje al cliente coherente con el estado real de la visita.
12. Registro auditable de todas las acciones.
13. Aislamiento por propietario y protección de datos.
14. Pruebas de duplicados, reintentos, fallos de red y sincronización parcial.

## 20. Registro de decisiones v1.1

| Fecha | Tema | Estado |
|---|---|---|
| 2026-11-09 | Dos modos de WhatsApp: asistido y autónomo por instrucciones | Aprobado para especificación |
| 2026-11-09 | Conversión doméstica de cocina a S/80, sin visita previa | Aprobado como regla comercial |
| 2026-11-09 | Tarifa de cocina comercial | Pendiente de definición |
| 2026-11-09 | Visita para modificación de tubería, puntos adicionales e instalaciones desde medidor | Aprobado como criterio general |
| 2026-11-09 | Crear visitas mediante instrucciones naturales por WhatsApp | Aprobado para especificación |
| 2026-11-09 | Guardado incompleto con campos pendientes si el propietario lo autoriza | Aprobado para especificación |
| 2026-11-09 | Reutilizar formulario de visitas y sincronizar calendario de Yarbi con Google Calendar | Aprobado como objetivo arquitectónico |
| 2026-11-09 | Presentación ordenada de confirmación al cliente por WhatsApp | Aprobado para especificación |

**Importante:** estas decisiones son requisitos de producto. No significan que la funcionalidad esté implementada ni autorizan por sí solas cambios en código, bases de datos, Google Calendar o Production.


## 21. Estándar visual profesional para citas y visitas

**Objetivo:** presentar las citas con patrones reconocibles de CRM profesionales: jerarquía visual clara, estados explícitos, datos operativos agrupados, ficha detallada e historial. Mantener una interfaz limpia, sin botones innecesarios ni saturación.

### 21.1 Dos presentaciones separadas

1. **Ficha interna de Yarbi:** información operativa completa para el propietario y el equipo autorizado.
2. **Confirmación de WhatsApp al cliente:** resumen breve y profesional con únicamente los datos que el cliente necesita.

No exponer al cliente notas internas, observaciones comerciales, estados técnicos de sincronización ni información privada del CRM.

### 21.2 Ficha interna de la cita

La ficha debe organizarse en esta jerarquía:

**Encabezado**
- Nombre del cliente y vínculo al registro CRM.
- Tipo de registro: visita, instalación, servicio o evaluación.
- Servicio principal.
- Estado visible mediante chip discreto: solicitada, pendiente de datos, pendiente de coordinación, provisional, confirmada, en camino, realizada, cancelada o reprogramada.

**Resumen operativo**
- Fecha absoluta y día de la semana.
- Hora de inicio y, si se conoce, duración o hora de término.
- Dirección o ubicación compartida.
- Distrito y referencia.
- Responsable asignado.
- Precio acordado, claramente separado de importe pagado y saldo.

**Detalles del servicio**
- Descripción y alcance.
- Tipo de trabajo.
- Materiales o requisitos, si están confirmados.
- Notas técnicas y observaciones internas.
- Evidencias o archivos vinculados, si existen.

**Relación comercial**
- Cliente y contacto.
- Conversación de WhatsApp de origen.
- Oportunidad o trabajo relacionado.
- Historial de cambios, acuerdos y comunicaciones.

**Agenda y sincronización**
- Estado de disponibilidad.
- Conflictos detectados.
- Estado de sincronización con el calendario de Yarbi y Google Calendar.
- Identificador externo, visible solo en detalles técnicos cuando sea necesario.

### 21.3 Estado y semántica de los importes

Nunca confundir:
- precio cotizado;
- precio acordado;
- importe cobrado;
- saldo pendiente.

Por ejemplo, “Precio acordado: S/400” no significa “Pagado: S/400”. Los estados financieros deben provenir de movimientos o registros de pago confirmados.

### 21.4 Datos faltantes y citas incompletas

- Mostrar claramente los campos pendientes.
- No inventar fecha, hora, ubicación, distrito, duración ni responsable.
- Si la fecha relativa (“sábado”) no está resuelta, pedir o mostrar la fecha absoluta antes de confirmar.
- Si el propietario autoriza guardar incompleto, conservarlo como solicitud o borrador pendiente.
- No bloquear un horario del calendario si falta la información mínima para determinarlo.
- No enviar confirmación definitiva al cliente hasta que los requisitos de confirmación estén satisfechos.

### 21.5 Vistas de agenda

La agenda debe ofrecer, como mínimo:
- Vista diaria.
- Vista semanal.
- Vista mensual.
- Listado de próximas visitas.

Las tarjetas de agenda deben ser compactas y mostrar solo:
- hora;
- cliente;
- servicio;
- estado;
- distrito o indicación de ubicación pendiente;
- precio acordado, si aporta valor a la vista.

Al abrir una tarjeta, se accede a la ficha completa. Evitar mostrar todos los campos en la vista del calendario.

### 21.6 Mensaje de confirmación por WhatsApp

Cuando la cita esté confirmada, el mensaje al cliente debe incluir únicamente:
- saludo y nombre;
- servicio;
- fecha y hora confirmadas;
- ubicación confirmada o referencia útil;
- precio acordado, si corresponde;
- instrucciones necesarias y despedida profesional.

El mensaje debe ser breve, legible en móvil y utilizar únicamente formato realmente soportado por WhatsApp (por ejemplo, negritas y saltos de línea). No depender de botones o tarjetas interactivas que el canal no soporte.

Si la cita es provisional o faltan datos esenciales, el mensaje debe comunicar coordinación pendiente, no una confirmación falsa.

### 21.7 Actividad e historial

La ficha debe conservar una línea de tiempo cronológica de:
- creación de la solicitud;
- instrucción original del propietario;
- datos extraídos y sus fuentes;
- cambios de fecha, hora, ubicación, precio o responsable;
- aprobaciones y confirmaciones;
- mensajes enviados;
- sincronizaciones y fallos;
- realización, cancelación o reprogramación.

Cada evento debe registrar fecha, actor y resultado. El historial no debe sobrescribirse silenciosamente.

### 21.8 Criterios de aceptación visual y funcional

1. La ficha se entiende rápidamente en pantalla móvil.
2. Cliente, servicio, fecha, hora y estado tienen jerarquía visual clara.
3. Los campos pendientes son visibles sin dominar toda la pantalla.
4. El calendario utiliza tarjetas compactas y permite abrir el detalle.
5. El precio acordado no aparece como pagado sin evidencia de pago.
6. Los estados provisional y confirmado se distinguen inequívocamente.
7. La presentación al cliente no expone notas internas.
8. La confirmación por WhatsApp usa solo datos verificados.
9. La línea de tiempo permite auditar cambios y comunicaciones.
10. La interfaz mantiene tipografía, espaciado, chips y marcos sutiles coherentes con el chat de Yarbi.

### 21.9 Ejemplo de referencia con datos incompletos

Para la instrucción: “Genera visita para la señora Mariane el sábado a las 8 a. m. Precio acordado S/400. Servicio: modificación de tubería”:

- Cliente: Sra. Mariane.
- Servicio: Modificación de tubería.
- Fecha: sábado; fecha absoluta pendiente de confirmar.
- Hora: 8:00 a. m.
- Precio acordado: S/400.
- Ubicación: pendiente.
- Distrito: pendiente.
- Responsable: pendiente de asignación.
- Estado: pendiente de coordinación.

La ficha no debe afirmar que la visita está confirmada ni que el precio está pagado.

**Estado de esta sección:** estándar de producto aprobado para especificación; implementación y validación en la aplicación pendientes.


## 22. Registro desde la aplicación y confirmación automática al cliente

**Objetivo:** al registrar una visita o trabajo desde la aplicación, Yarbi debe organizar la cita o sesión de trabajo y preparar una comunicación profesional para el cliente por WhatsApp, reutilizando el mismo motor de agenda, reglas y mensajería que utiliza cuando recibe instrucciones por WhatsApp.

### 22.1 Un solo flujo para dos puntos de entrada

La operación puede iniciarse desde:
1. Una instrucción natural del propietario por WhatsApp.
2. El formulario de visitas/trabajos de la aplicación.

Ambos puntos de entrada deben invocar los mismos servicios de negocio y utilizar el mismo registro canónico. No crear implementaciones paralelas, agendas duplicadas ni reglas distintas para cada canal.

### 22.2 Diferenciar visita, trabajo y construcción

No toda construcción equivale a una sola cita.

- **Visita de evaluación:** bloque de agenda para inspeccionar, medir o diagnosticar.
- **Trabajo o servicio puntual:** una intervención que puede representarse mediante una sesión programada.
- **Construcción o proyecto de varios días:** un expediente u orden de trabajo que puede contener varias sesiones, etapas, responsables y fechas.

El modelo debe permitir que un proyecto tenga una o varias sesiones de trabajo vinculadas. No crear una única cita artificial para representar una obra de varios días.

### 22.3 Flujo al registrar desde la aplicación

1. El usuario selecciona o crea el cliente.
2. Registra el tipo de servicio, alcance, fecha, hora, ubicación y precio, según corresponda.
3. Añade indicaciones para el cliente, si son necesarias.
4. Guarda el registro canónico en Yarbi.
5. El sistema valida datos obligatorios, disponibilidad y estado de la cita.
6. Yarbi genera una vista previa del mensaje usando los datos guardados.
7. Según la política de envío configurada, solicita aprobación o envía automáticamente.
8. Registra el resultado de envío y lo vincula a la ficha del cliente y al trabajo/visita.

### 22.4 Indicaciones adicionales para el cliente

Incluir un campo separado llamado **“Indicaciones para el cliente”** o equivalente.

Ejemplo:
“Durante el trabajo se generará bastante polvo. Por favor, cubra sus muebles y pertenencias para protegerlos”.

Reglas:
- Este campo contiene información destinada al cliente.
- Debe estar separado de las notas internas del técnico o del negocio.
- Puede escribirse manualmente o seleccionarse de instrucciones reutilizables aprobadas.
- Yarbi puede mejorar la redacción sin cambiar el sentido.
- No debe inventar advertencias técnicas ni condiciones que el propietario no haya indicado o aprobado.
- Si hay varias sesiones de construcción, las indicaciones pueden aplicarse al proyecto completo o a una sesión concreta; debe quedar claro cuál.

### 22.5 Mensaje de WhatsApp generado automáticamente

El mensaje debe componerse a partir del registro real y puede incluir:
- saludo y nombre del cliente;
- tipo de atención: visita, instalación, reparación o construcción;
- servicio o alcance acordado;
- fecha y hora confirmadas;
- ubicación o dirección confirmada;
- precio acordado, cuando corresponda;
- indicaciones adicionales para preparar el espacio;
- canal de contacto para cambios o consultas.

Ejemplo de indicación:
“Durante el trabajo se generará bastante polvo. Le recomendamos cubrir sus muebles y objetos cercanos antes de iniciar”.

El mensaje debe ser cordial, claro, breve y fácil de leer desde un teléfono.

### 22.6 Formato y límites reales de WhatsApp

- El mensaje de texto puede utilizar emojis, saltos de línea, viñetas y formato compatible de WhatsApp, como negritas mediante su sintaxis admitida.
- No asumir que un mensaje de texto normal puede contener tarjetas, chips, marcos o componentes interactivos propios de la aplicación.
- Si se desea una tarjeta gráfica con diseño visual, generarla como imagen JPG/PNG adjunta y enviarla como medio separado, no como si fuera formato nativo del texto.
- La versión textual debe seguir siendo comprensible si el cliente no abre la imagen.
- No enviar imágenes innecesarias si el texto ya comunica claramente la información.

### 22.7 Política de envío automático y aprobación

La configuración debe permitir:
- **Vista previa y aprobación:** Yarbi prepara el mensaje, pero espera autorización.
- **Envío automático autorizado:** Yarbi envía cuando el registro cumple todas las condiciones configuradas.

El envío automático solo puede ejecutarse si:
- el contacto y número del cliente están identificados sin ambigüedad;
- el servicio y los datos comunicados están guardados;
- fecha y hora son válidas cuando se está confirmando una cita;
- la ubicación se presenta como confirmada solo si fue verificada;
- no existe un conflicto de agenda sin resolver;
- el estado del registro permite confirmar;
- el propietario habilitó expresamente el envío automático para ese tipo de operación.

Si faltan datos esenciales, hay ambigüedad o conflicto, guardar el registro como pendiente y no enviar una confirmación definitiva. Se puede preparar un mensaje de coordinación pendiente si la política lo permite.

### 22.8 Estados de comunicación

Distinguir claramente:
- mensaje no generado;
- borrador preparado;
- pendiente de aprobación;
- listo para enviar;
- enviado;
- entregado, si el proveedor ofrece esa señal;
- leído, solo si el canal devuelve ese estado;
- fallido;
- reintento pendiente.

No afirmar que un mensaje fue entregado o leído si la plataforma no proporciona esa confirmación.

### 22.9 Historial y prevención de duplicados

- Guardar el contenido exacto enviado y la versión de la plantilla.
- Registrar fecha, actor, canal, destinatario y resultado.
- Vincular el mensaje a la visita, sesión o proyecto correspondiente.
- Utilizar claves de idempotencia para impedir envíos duplicados al reintentar.
- Si se modifica fecha, precio, ubicación o indicaciones después del envío, preparar una actualización al cliente según las reglas autorizadas; no reenviar silenciosamente una confirmación duplicada.

### 22.10 Criterios de aceptación

1. Registrar una visita desde la aplicación crea el registro canónico y su evento de agenda.
2. Registrar una construcción puntual crea la sesión correspondiente.
3. Un proyecto de varios días puede tener varias sesiones sin duplicar el proyecto.
4. El formulario incluye indicaciones para el cliente separadas de las notas internas.
5. El mensaje generado refleja fielmente los datos guardados.
6. Emojis, viñetas, saltos de línea y formato compatible se visualizan correctamente en WhatsApp.
7. El mensaje distingue cita confirmada de coordinación pendiente.
8. La política de aprobación/envío automático se respeta.
9. Un fallo de red no crea registros ni mensajes duplicados.
10. La comunicación queda vinculada al cliente y al trabajo en el historial.
11. Las indicaciones no se filtran a notas internas ni viceversa.
12. La operación desde la app y desde WhatsApp produce el mismo resultado de negocio.

**Estado de esta sección:** requisito de producto aprobado para especificación; integración y pruebas en la aplicación pendientes.


## 23. Mensajería profesional automatizada de WhatsApp

**Estado:** Futura implementación aprobada para planificación. No implementada.

### 23.1 Objetivo

Yarbi debe generar y enviar comunicaciones comerciales profesionales, personalizadas y consistentes a partir de los datos del CRM, visitas, servicios y construcciones. La operación rutinaria no debe requerir que una persona redacte manualmente cada mensaje.

### 23.2 Arquitectura recomendada

Separar responsabilidades:

- **CRM y agenda:** fuente de los datos del cliente, servicio, precio, fecha, hora, ubicación y estado.
- **Motor de reglas:** decide si corresponde comunicar, qué tipo de mensaje está autorizado y cuándo detenerse.
- **Biblioteca de plantillas:** mantiene la estructura, tono e identidad de los mensajes habituales.
- **Gemini:** interpreta instrucciones naturales, mejora redacción y adapta indicaciones cuando aporta valor; no debe redactar desde cero cada mensaje rutinario.
- **WhatsApp Business Platform/API o proveedor autorizado:** canal de envío y recepción.
- **Registro de comunicaciones:** conserva el contenido, destinatario, plantilla, fecha, estado y resultado.

### 23.3 Plantillas iniciales

Crear una biblioteca administrable de plantillas para:

1. Confirmación de visita.
2. Confirmación de instalación o servicio.
3. Confirmación de construcción o jornada de trabajo.
4. Recordatorio de visita.
5. Reprogramación.
6. Aviso de llegada del técnico.
7. Indicaciones para preparar el espacio.
8. Finalización del servicio.
9. Solicitud de opinión o evaluación del cliente.

Las plantillas deben utilizar variables verificadas del registro, como nombre, servicio, fecha, hora, ubicación, precio acordado e indicaciones para el cliente.

### 23.4 Personalización y redacción con IA

- Las variables rutinarias se insertan sin invocar Gemini.
- Gemini puede mejorar la redacción de indicaciones adicionales o adaptar el tono cuando sea necesario.
- La IA no puede cambiar precio, fecha, alcance, dirección ni condiciones acordadas.
- Si una indicación es ambigua, contradictoria o potencialmente sensible, solicitar revisión.
- El texto final debe ser cordial, claro, breve y fácil de leer en un teléfono.
- El estilo debe mantener emojis moderados, viñetas, saltos de línea y negritas compatibles con WhatsApp.

### 23.5 Políticas de WhatsApp y Meta

- Integrar mediante WhatsApp Business Platform/API oficial o proveedor autorizado.
- Diferenciar respuestas dentro de una ventana de atención de mensajes iniciados por la empresa fuera de dicha ventana.
- Gestionar plantillas aprobadas por Meta cuando la política vigente las requiera.
- Registrar categoría, aprobación, idioma y versión de cada plantilla cuando aplique.
- Verificar las políticas, ventanas, categorías, restricciones y precios vigentes de Meta antes de implementar; no codificar supuestos que puedan quedar obsoletos.
- Respetar consentimiento, opt-in, opt-out y solicitudes de no contacto.
- No intentar eludir controles de Meta mediante mensajes alternativos.

### 23.6 Envío supervisado y automático

Permitir dos políticas:

- **Supervisado:** Yarbi prepara el mensaje y espera aprobación.
- **Automático autorizado:** Yarbi envía cuando se cumplen reglas explícitas y verificables.

La política puede variar por tipo de mensaje, servicio, cliente o canal. No se debe asumir que todo mensaje es apto para envío automático.

Antes de enviar, comprobar:
- identidad inequívoca del cliente y número;
- datos coherentes con el registro canónico;
- estado real de la visita o trabajo;
- autorización de envío;
- política vigente de WhatsApp;
- ausencia de duplicados;
- ausencia de una solicitud de no contacto.

### 23.7 Diseño y formatos

- El texto de WhatsApp debe funcionar por sí solo y usar únicamente formatos soportados por el canal.
- Emojis, viñetas, saltos de línea y negritas deben mejorar la lectura, no saturarla.
- Una tarjeta gráfica profesional puede enviarse como JPG/PNG adjunto separado del texto.
- No simular que el texto normal admite marcos, chips o componentes de interfaz propios de Yarbi.
- Mantener coherencia visual entre confirmaciones, recordatorios y actualizaciones.

### 23.8 Auditoría, privacidad e idempotencia

Conservar:
- cliente y número destinatario;
- mensaje final exacto;
- plantilla y versión utilizadas;
- variables utilizadas y registro de origen;
- intervención de Gemini, si la hubo;
- autorización y política aplicada;
- fecha, hora, canal y resultado;
- identificador del proveedor;
- errores y reintentos.

Usar claves de idempotencia para evitar mensajes duplicados. Restringir el acceso a los datos y no exponer notas internas al cliente.

### 23.9 Criterios de aceptación

1. Una confirmación rutinaria se genera sin invocar Gemini.
2. Las variables corresponden exactamente al registro del CRM/agenda.
3. Gemini solo interviene cuando existe una necesidad real de comprensión o adaptación.
4. La IA no modifica acuerdos ni datos estructurados.
5. Los mensajes cumplen las políticas vigentes de WhatsApp/Meta.
6. Las plantillas aprobadas y sus versiones se administran de forma trazable.
7. El propietario puede elegir supervisión o autonomía autorizada.
8. El sistema respeta opt-in, opt-out y no contacto.
9. Los reintentos no duplican mensajes.
10. El historial conserva el mensaje exacto y el resultado de envío.
11. El contenido no revela notas internas.
12. El mensaje es legible y coherente en dispositivos móviles.

### 23.10 Orden de construcción propuesto

La mensajería automatizada dependerá de:
1. Registro canónico de clientes, servicios, visitas y construcciones.
2. Motor de reglas, permisos y estados.
3. Registro de comunicaciones y control de duplicados.
4. Integración autorizada con WhatsApp Business Platform/API.
5. Biblioteca de plantillas y variables.
6. Vista previa, aprobación y políticas de autonomía.
7. Personalización con Gemini para casos que lo necesiten.
8. Métricas, auditoría y optimización.

**Decisión de producto:** aprobado como futura implementación. El orden definitivo se confirmará tras revisar el estado real del repositorio, las auditorías y las dependencias existentes. Esta decisión no autoriza cambios de código, contratación de proveedores, gastos, conexiones remotas ni despliegues.

## Anexo A. Texto íntegro preservado del Documento Rector v1.0

# Yarbi — Documento Rector del Producto

**Versión:** 1.0 consolidada  
**Estado:** dirección de diseño aprobada; implementación del nuevo espacio conversacional pendiente.

## 1. Identidad

Yarbi es un único asistente empresarial: conversa de manera natural, consulta
datos verificables, reconoce incertidumbre y propone acciones que siempre se
validan fuera del renderer. No habrá asistentes paralelos ni memorias que se
contradigan. El cerebro central conserva tres rutas: **FAST** para lecturas
deterministas, **STANDARD** para lenguaje natural y contexto, y **DEEP** para
análisis durable cuando esa infraestructura esté disponible. Gemini es el
proveedor principal de comprensión; no es una autoridad para escribir datos ni
ejecutar acciones.

## 2. Experiencia conversacional

La conversación es la superficie principal en Web y Android. Debe sentirse
limpia, legible y profesional, inspirada en la jerarquía de ChatGPT, no en una
pizarra de formularios:

- Inter es la candidata tipográfica inicial, pendiente de validación visual
  Android/Web. La escala objetivo es: H1 26–28 px y peso 700; H2 21–22 px y
  peso 600–700; H3 17–18 px y peso 600; cuerpo 16 px, peso 400 y altura de
  línea aproximada 1.5; texto secundario 14 px. El tamaño puede escalarse con
  las preferencias de accesibilidad sin perder jerarquía ni contraste.
- Fondo claro o neutro, contraste alto, bordes y sombras delicados, esquinas
  moderadas y espaciado generoso.
- Azul para información, verde para verificación, naranja para precaución,
  rojo para riesgo y gris para referencias; el color nunca sustituye al texto.
- Las acciones aparecen sólo cuando son pertinentes y son explícitamente
  autorizables; no convierten el chat en botones permanentes.

La complejidad visual se adapta a la consulta: una pregunta sencilla recibe
texto directo; una comparación recibe tabla; un análisis recibe secciones,
indicadores, gráficos y fuentes sólo cuando mejoran la decisión.

En pantallas móviles se conserva una columna legible, objetivos táctiles
suficientes, separación consistente entre bloques y contraste verificable. La
jerarquía no obliga a estructurar de más: una respuesta corta puede ser sólo un
párrafo; los encabezados se usan cuando aportan navegación real.

### Ejemplo obligatorio: atención de clientes

Ante “Enumérame los clientes que necesitan atención”, Yarbi presenta una lista
numerada con nombre, última interacción, motivo, estado, prioridad y acceso al
expediente. La prioridad combina **urgencia**, **impacto comercial** y
**recencia**; la fecha más reciente no es, por sí sola, la más urgente.

## 3. Respuestas, fuentes y acciones

El contenido se presenta mediante párrafos, títulos, listas, tablas, paneles,
chips, imágenes, vistas de documentos, diagramas, gráficos, citas y checks.
Una respuesta breve sigue teniendo una forma simple y no recibe tarjetas
innecesarias.

Las fuentes distinguen texto literal, dato confirmado e interpretación de
Gemini. Para normas PDF se conserva documento, versión, página, numeral,
tabla o figura; cuando exista una figura original, se muestra antes que una
ilustración inventada. NTP 111.011:2014 es el primer caso de prueba de
comprensión normativa; no se afirmará vigencia sin una fuente oficial
verificada.

Las acciones CRM, Agenda y Finanzas son objetos tipados separados del contenido
visual. El renderer no ejecuta instrucciones de Gemini. Toda acción sensible
requiere backend, scope del propietario y la confirmación humana ya definida
por cada flujo.

## 4. Voz

Voz y texto representan el mismo mensaje lógico. La persona revisa una
transcripción antes de operaciones sensibles; la respuesta hablada se deriva
del contenido escrito ya estructurado. El usuario puede detener TTS sin
bloquear la interfaz. El audio no se conserva por defecto y la ausencia de un
proveedor se comunica sin inventar transcripciones.

## 5. Historial, memoria y estado visual

**Historial** conserva lo conversado. **Memoria empresarial** conserva sólo
conocimiento confirmado, con procedencia y auditoría. Ningún mensaje se vuelve
memoria permanente automáticamente.

El historial debe permitir nueva conversación, guardado automático, renombrar,
eliminar con confirmación, buscar, recuperar, sincronizar local/nube y leer
contenido previamente disponible offline. Cada conversación está aislada por
propietario.

La restauración exacta al volver desde CRM, Agenda o Finanzas —conversación,
scroll, borrador y elementos expandidos— es una fase posterior explícita. No
se considera implementada por el almacenamiento de mensajes existente.

## 6. Conocimiento empresarial

El Business Knowledge Engine podrá procesar PDFs, Excel, imágenes, videos con
y sin sonido, audios e instrucciones escritas. Conserva originales locales,
conocimiento aprobado en Supabase, SHA-256 por versión, deduplicación,
reanudación, correcciones, contradicciones y fuentes. Gemini multimodal puede
proponer interpretación; la aprobación humana gobierna el conocimiento útil.

Cada archivo se procesa una vez por versión identificada mediante SHA-256. Un
video se clasifica como visual o audiovisual según tenga una pista de audio;
el flujo puede extraer cuadros y audio sin asumir que todos los archivos son
locales ni que todo análisis se realiza en el dispositivo. Los originales
permanecen en almacenamiento local Android cuando corresponda; el conocimiento
aprobado se guarda por separado en Supabase y las correcciones crean versiones
auditables, no reemplazos silenciosos.

Antes de seleccionar un modelo Gemini para el BKE se verifican, con la
capacidad vigente del proveedor, modalidades aceptadas, formatos, duración,
cuota, coste y restricciones. No se fija un modelo por su nombre sin esa
comprobación. La implementación Android medirá en el dispositivo disponible
RAM, CPU, batería, temperatura, almacenamiento temporal, conectividad,
interrupción, reanudación y limpieza; no se inventan límites universales.

## 7. Integraciones preservadas

CRM, Agenda, Finanzas, WhatsApp Business, WhatsApp personal, Meta Ads, Gemini
Live, Supabase y Android siguen siendo parte del producto. Su activación y sus
efectos comerciales continúan sujetos a los contratos y autorizaciones
existentes; la conversación no sustituye esas barreras.

## 8. Compartición JPG

Yarbi podrá generar localmente una previsualización JPG de respuestas. Debe
mantener identidad visual, calidad legible, fuentes cuando correspondan y
dividir respuestas extensas en láminas numeradas. Android utilizará el menú
nativo para compartir, incluido WhatsApp. Nunca se comprimirá un documento
extenso en una sola imagen ilegible.

## 9. Seguridad

No hay secretos en frontend. El propietario, RLS, scope y procedencia gobiernan
las consultas. Las acciones son confirmadas y auditables. Yarbi no ejecuta
instrucciones arbitrarias de Gemini ni convierte inferencias en movimientos,
cobros, mensajes o cambios de cliente.

## 10. Matriz de completitud

| Requisito | Existe | Completo | Pendiente |
|---|---:|---:|---|
| Cerebro FAST/STANDARD/DEEP | Sí | Parcial | DEEP durable y contrato visual común. |
| Conversación autenticada | Sí | Parcial | Persistencia por conversación y renderer tipado. |
| Voz/dictado revisable | Sí | Parcial | TTS unificado y validación Android física. |
| Historial nube básico | Sí | No | Títulos, conversaciones, búsqueda, borrado y offline. |
| Fuentes PDF/imágenes | No | No | Ingesta, citas, permisos y previews. |
| Acciones tipadas | Parcial | No | Contrato común de acción/confirmación en el chat. |
| Estado entre pestañas | Parcial | No | Restauración visual dedicada. |
| Exportación JPG | No | No | Render, cortes y Android share. |
| Integraciones empresariales | Sí | Parcial | Exposición conversacional controlada. |
