# Regresión del hardening Live

## Comparación con la base F03

| Línea | Tests | PASS | FAIL | TODO |
| --- | ---: | ---: | ---: | ---: |
| F03 `6b2431a` | 508 | 435 | 67 | 6 |
| Candidato de hardening | 532 | 459 | 67 | 6 |

Las 24 pruebas adicionales aprobadas incluyen las 3 nuevas de identidad y el conjunto de renderer/Live incorporado previamente en la cadena autorizada. La comparación de identificadores de fallo no encontró adiciones ni eliminaciones respecto a F03.

## VAD y Barge-in

No se editó el bloque de captura VAD ni se actualizó su hash histórico. Cuatro comprobaciones conductuales de Barge-in pasan. La comprobación de hash VAD continúa en FAIL histórico con la misma discrepancia de F03; se conserva como deuda y no se atribuye al hardening de identidad.

## Builds

Web y Android-Web se generaron desde `frontend/` mediante el sistema unificado. Ambos produjeron el release local `p02i-95df139d8c5a9a02` y la prueba de integración del frontend pasó 4/4. No se generó APK/AAB nativo ni se afirma validación física Android.

## Exclusiones confirmadas

- `main` permanece en F03.
- F04.2/F04.3 no son ancestros.
- Sin despliegues, migrations, Supabase remoto, Gemini real o cambios de producción.
