# Etapa 1.1 — Regresiones

Comando focalizado:

`node --test tests/etapa1-conversation-renderer.test.js tests/frontend-unified-build.test.js tests/f01-gemini-live-session-security.test.js tests/f02-identity-security.test.js tests/f021-identity-whatsapp.test.js tests/f03-intelligence-router.test.js`

Resultado: **45/45 PASS**.

Conciliación de cifras:

- Antigravity informó 35/35: 8 pruebas originales del renderer más 27 de F01, F02, F02.1 y F03.
- Codex informó antes 39/39: el mismo conjunto más 4 pruebas de build unificado.
- Etapa 1.1 añade 6 pruebas de renderer; el conjunto final es 45/45. No hay contradicción: son conjuntos distintos y acumulativos.

Otros comandos PASS:

- `npm run build:frontend:web`
- `YARBI_ANDROID_API_ORIGIN=https://android-build.invalid npm run build:frontend:android`
- `npm run test:syntax`

Suite histórica completa: `npm test` = 449 pass, 67 fail, 6 TODO de 522. Los fallos aparecen ya en la base F03 autorizada por referencias a rutas o artefactos que no existen allí, especialmente `api/assistant/preferences.js`, `collections.js`, `command.js`, una migración fuera del worktree y un árbol Android histórico. Esta fase no añadió esos fallos ni incorporó F04.2/F04.3 para ocultarlos.
