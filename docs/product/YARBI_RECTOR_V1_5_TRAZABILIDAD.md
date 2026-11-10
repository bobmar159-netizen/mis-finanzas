# Matriz de trazabilidad v1.5

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
