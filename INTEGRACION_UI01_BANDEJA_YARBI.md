# UI / INTEGRATION — UI-01 Bandeja proactiva del dueño

## Resultado

`INTEGRACION_UI01_BANDEJA_YARBI_VALIDADA`

La validación es local y basada en el contrato aislado ya validado de 3K. No se realizó un despliegue, no se llamó al proyecto remoto y no se modificaron Vercel, APK ni producción.

## Ubicación y experiencia

La entrada **Yarbi** abre un selector pequeño con dos caminos: **Para ti** y **Hablar con Yarbi**. Esto conserva el chat/voz existente y agrega la nueva pantalla `yarbi-pendientes` sin crear una segunda aplicación.

La pantalla es móvil primero y mantiene el estilo pastel de Mis Finanzas. Incluye:

- resumen de meta diaria, confirmado y faltante, sin convertir `confirmed_today = null` en S/0;
- bloques **Atención ahora** y **Para después**, usando las prioridades ya calculadas por backend;
- tarjetas compactas con detalle desplegable, estado, prioridad, motivo, contacto/servicio cuando el payload seguro lo proporciona;
- acciones Autorizar, Posponer (1 h, 3 h, mañana o fecha/hora futura) y Descartar con confirmación ligera;
- actualización manual al entrar y después de una decisión; no hay polling ni scheduler nuevo.

Los tipos `customer_action`, `internal_action`, `owner_review` y `business_goal` tienen presentación preparada. Solo los tipos que el contrato 3K permite ejecutar muestran controles de decisión.

## Seguridad y llamadas backend

El navegador usa solamente rutas relativas del mismo origen:

- `GET /api/assistant/owner-inbox`
- `POST /api/assistant/owner-action`

El cliente adjunta únicamente el JWT de sesión de cuenta existente. No contiene `SUPABASE_SECRET_KEY`, `service_role`, `YARBI_OWNER_ACTION_TOKEN`, token cron ni URL de producción.

La nueva política `YARBI_PREVIEW_OWNER_UI_ONLY=true` exige preview, el `project_ref` aislado `uevilhbstnmmdlgyshlv`, URL HTTPS exacta del aislado, secreto exclusivo del servidor, `YARBI_OWNER_ACCOUNT_ID`, y ausencia de Gemini, WhatsApp/YCloud, Maps, Notion, Calendar y cron. Rechaza toda ruta salvo las dos indicadas y autentica al dueño contra Supabase aislado antes de leer o decidir.

La decisión continúa llamando a la RPC atómica existente `apply_yarbi_owner_action`; la UI no ejecuta ninguna acción comercial, no altera datos localmente y vuelve a consultar el resultado. Los resultados `already_authorized`, `stale_recommendation` y errores controlados se presentan sin exponer detalles técnicos.

## Archivos modificados o añadidos

- `www/yarbi-owner-inbox-ui.js`: interfaz, estado visual, actualización manual y controles.
- `index.html` y `www/index.html`: nueva página y carga del módulo compartido.
- `lib/preview-owner-ui-policy.js`: guardia exclusiva del preview UI.
- `lib/yarbi-owner-ui-auth.js`: validación del JWT de cuenta con el backend aislado.
- `lib/yarbi-owner-inbox.js`: proyección sanitaria de `yarbi_owner_inbox` a tarjetas UI.
- `api/assistant/owner-inbox.js`: lectura backend segura y sanitizada.
- `api/assistant/owner-action.js`: adapta la autenticación de cuenta para UI sin alterar la ruta de token estático de F3K.
- `lib/preview-route-policy.js` y `vercel.json`: enrutamiento explícito de las dos rutas UI.
- `tests/ui01-owner-inbox.test.js` y `tests/ui01-owner-endpoints.test.js`: cobertura UI-01.

## Pruebas ejecutadas

| Criterio | Resultado | Evidencia |
|---|---|---|
| Lista vacía, una y múltiples recomendaciones | PASS | proyección sanitaria probada |
| Prioridad alta y separación de estados | PASS | datos de tarjeta y UI móvil |
| Autorizar, reintento y stale | PASS | RPC 3K preservada y respuesta manejada |
| Posponer y descartar | PASS | validación existente de 3K y UI futura |
| `owner_review` | PASS | solo lectura, sin ejecución |
| `confirmed_today = null` | PASS | no se renderiza S/0 |
| Meta conocida | PASS | resumen monetario UI |
| Error controlado/loading | PASS | estado visual y reintento manual |
| Credenciales en bundle | PASS | el módulo no contiene secretos ni host remoto |
| Acción comercial desde frontend | PASS | solo RPC backend atómica |
| Regresión F3K | PASS | 10/10 pruebas Node pasan |

Comandos verificados localmente:

```text
node --check www/yarbi-owner-inbox-ui.js
node --test tests/f3k-owner-action.test.js tests/f3k-owner-action-endpoint.test.js tests/ui01-owner-inbox.test.js tests/ui01-owner-endpoints.test.js
npm run test:syntax
```

Resultado: 10 pruebas aprobadas, 0 fallos; scripts inline válidos.

## Hashes relevantes

| Artefacto | SHA-256 |
|---|---|
| `lib/preview-owner-ui-policy.js` | `BBF74E28A35E0255543862038D661A96E987C96E2C170AD523989A651E450E25` |
| `lib/yarbi-owner-inbox.js` | `374F06D80CDFCD7F158BA462DD924D8CC6B1E87751D0256A55B9C53EC7F12CF5` |
| `api/assistant/owner-inbox.js` | `A9F29D83F60558A4318B64466FAEA294E49158C6EA7AB290B994C92727509656` |
| `api/assistant/owner-action.js` | `D128FA00C47A813845B4D7BA599B039B701213CA6FF107F606EEE20481280036` |
| `www/yarbi-owner-inbox-ui.js` | `D091B74667206243400D75CEFCB054D6FFCF67AFDB391AD9433DF360338F8DEA` |

## Pendientes reales

1. Configurar las variables exclusivas de un deployment preview y desplegarlo sin promoción para comprobar el recorrido HTTP real contra `yarbi-audit-preview`.
2. La tabla actual no garantiza que el payload contenga nombre, servicio o conteos de oportunidades; la interfaz los muestra únicamente cuando existen y no inventa valores.
3. El siguiente trabajo recomendado, sin iniciarlo aquí, es **GEMINI / INTEGRATION** para comprensión de texto natural y conversación, sin envío autónomo.

No se hicieron conexiones externas durante esta integración local. Producción, CRM, Agenda, WhatsApp saliente, Gemini, Vercel y APK permanecieron fuera de alcance.
