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
