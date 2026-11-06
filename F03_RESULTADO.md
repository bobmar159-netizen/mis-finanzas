# YARBI — F03: Agenda y seguimiento inteligente

**Estado:** `F03_IMPLEMENTADA_Y_VALIDADA_LOCALMENTE`  
**Base preservada:** commit F02 `401f5ce` / etiqueta `f02-crm-local-20261105`  
**Alcance:** código, builds y fixtures locales. No se consultaron ni modificaron servicios remotos.

## Entregado

- Se añadió `lib/yarbi-agenda-intelligence.js`, una capa determinista para normalizar los estados reales de Agenda, clasificar actividades en `America/Lima`, deduplicarlas y resumirlas como historial, próximas y pendientes.
- El expediente CRM ahora recibe actividades del contacto canónico y las muestra separadas en **Agenda y seguimiento**, con fecha, estado y procedencia disponibles.
- La lectura de CRM solicita los campos de Agenda necesarios para establecer contexto, sin interpretar una oportunidad o cobro como cerrado.
- Se prepararon planes de lectura, sin efectos ni creación de actividades, para consultas naturales: agenda de mañana, llamadas pendientes, visitas pendientes e historial de una instalación.
- Se preservaron los flujos existentes de propuesta, confirmación, reprogramación y cancelación: F03 no habilita mutaciones directas desde lenguaje natural.
- Se mantuvo la deduplicación por identificador o clave de deduplicación; una reentrega no agrega actividades duplicadas al dossier.
- La interfaz unificada conserva los flujos web/Android y el build de Android exige un origen HTTPS explícito.

## Verificación local

| Verificación | Resultado |
|---|---|
| Batería focalizada Agenda, CRM, owner scope e integración | PASS — 29/29 |
| Build unificado Web | PASS |
| Build unificado Android con origen sintético HTTPS | PASS |
| Pruebas de reproducibilidad y aislamiento de frontend | PASS — 4/4 |
| `git diff --check` | PASS |
| Servicios remotos, Production y APK de referencia | No utilizados ni modificados |

Los fixtures y tests cubren estados programado, completado, cancelado, vencido y sin fecha; zona horaria Lima; reentregas; contactos ambiguos; owner scope; agenda/CRM; confirmaciones existentes y regresiones CRM.

## Archivos funcionales modificados

- `lib/yarbi-agenda-intelligence.js`
- `lib/yarbi-crm-dossier-runtime.js`
- `lib/yarbi-crm-search-runtime.js`
- `frontend/yarbi-product-completion-ui.js`

Además se ajustaron pruebas de ruta de Agenda y aislamiento del entorno de prueba del build unificado. Los artefactos generados de la raíz (`runtime-config.js`, `service-worker.js` y `yarbi-product-completion-ui.js`) fueron actualizados por los builds reproducibles.

## Límites conocidos

- La validación de actividad, sincronización y avisos proactivos es local y sintética. La sincronización con una Agenda remota permanece **NO VALIDADA** hasta contar con configuración de Preview autorizada.
- Cuando un dato o integración no esté disponible, la capa de dossier conserva el estado `no disponible`; no inventa actividades ni identidades.
- Las consultas naturales de Agenda se preparan sin efectos. Crear, editar, reprogramar y cancelar siguen exigiendo los flujos de autorización y confirmación existentes.
- No se generó APK ni se desplegó Preview o Production.

## Siguiente paso

F04 puede integrar Finanzas, Movimientos, cotizaciones, cobranzas y Notion sobre el mismo `contact_id` canónico, sin cambiar F03 ni habilitar acciones externas hasta que exista autorización específica.
