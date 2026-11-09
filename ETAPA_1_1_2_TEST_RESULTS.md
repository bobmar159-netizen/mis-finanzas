# Etapa 1.1.2 — Resultados de pruebas

## Pruebas nuevas Live

Comando:

```text
node --test tests/etapa1-conversation-renderer.test.js tests/etapa1-live-finalization.test.js
```

Resultado: **18 PASS, 0 FAIL**.

La nueva cobertura ejecuta funciones extraídas del módulo real con un DOM local simulado y cubre borrador, actualización, persistencia una sola vez, renderer canónico, rol/id, repetición, vacío, cancelación, interrupción, reconexión y contenido hostil/truncado.

## Regresión focalizada relacionada

```text
node --test tests/f03-intelligence-router.test.js tests/etapa1-conversation-renderer.test.js tests/etapa1-live-finalization.test.js
```

Resultado: **25 PASS, 0 FAIL**.

## Frontend unificado

```text
node --test tests/frontend-unified-build.test.js
```

Resultado: **4 PASS, 0 FAIL**. También se generaron correctamente Web y Android-Web con el mismo `source_sha256` `4f53db18c814db77d3bb5a86b10a6f83f274a18c8bdb7602ef07a92d1c5d50d2`.

## Regresión Live ampliada

La selección de 47 pruebas F01/F03/F07/Gemini Live/renderer tuvo **46 PASS y 1 FAIL**. El fallo es la aserción histórica `barge-in guard: protected VAD block matches the approved behavior`; compara un hash esperado ya desactualizado. `frontend/index.html` es idéntico al blob de `bf52631`, por lo que el fallo no procede de esta etapa y no fue alterado.
