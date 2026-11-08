# YARBI — Integración F03

Fecha local: 2026-11-08

## Integración

- Base comprobada: `07283d9`.
- Commit F03 aprobado e integrado por *fast-forward*: `c0362e9`.
- Repositorio compartido entre `D:\YARBI_WORKSPACE_20261105` y
  `D:\YARBI_F03_WORK_20261108`: comprobado.
- Manifiesto F03: 11/11 SHA-256 verificados antes de integrar.
- No se añadieron ni modificaron los informes no rastreados de Antigravity ni la
  revisión de seguridad presentes en el workspace principal.

## Validación posterior

| Validación | Resultado | Nota |
|---|---|---|
| F02, F02.1, F03, F05, F06 y F07 focalizadas | PASS, 33/33 | Sin proveedor ni red. |
| Build frontend web | PASS | Release local `p02i-0c5cf70f24e0c587`. |
| Build frontend Android | PASS | Generó `dist/android-www` con `YARBI_ANDROID_API_ORIGIN=https://preview.invalid`. |
| Bundle nativo Android (AAB/APK) | BLOCKED | No existe `android/gradlew.bat` ni árbol Gradle/Capacitor en este workspace. |
| Matriz de rewrites | PASS parcial | 24 patrones API y presupuesto estático bajo el límite, según la prueba F02.1. |
| Funciones | PASS estático | 9 entrypoints directos bajo `api/`; no se ejecutó build Vercel ni hubo conteo real de bundles. |
| Pruebas P06 de routers | 18/25 PASS | Siete fallos no vinculados al diff F03, detallados abajo. |

## Fallos P06 no atribuibles a F03

1. Dos pruebas exigen una guardia antigua en `send-whatsapp` que no forma parte
   del diff F03.
2. Una prueba espera ocho entrypoints y el catálogo local actual contiene nueve.
3. Dos pruebas no pueden cargar `@vercel/functions`; la dependencia está en
   `package.json`, pero no está instalada localmente. No se ejecutó instalación
   ni descarga de paquetes.
4. Dos pruebas de `collections` comparan el handler actual contra una copia
   histórica y esperan la autenticación anterior; no se modificó ese handler.

Las rutas, handlers y pruebas implicados no cambiaron entre `07283d9` y
`c0362e9`; estos resultados son deuda independiente y no se reinterpretan como
validación de Vercel real.

## Límites de esta integración

- No hubo despliegue, `vercel build`, Supabase remoto, Gemini, migraciones,
  proveedores, Production ni APK.
- El build Android validó el bundle web para Capacitor; el empaquetado nativo
  requiere que se restaure o aporte el árbol Android en una fase autorizada.

## Decisión

F03 queda integrada localmente en el commit conservado `c0362e9`. F04 debe
partir del commit de integración que acompaña este informe, en una rama y
worktree separados.
