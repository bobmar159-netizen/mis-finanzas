# Matriz de compatibilidad

| Situación | Comportamiento | Estado |
|---|---|---|
| IndexedDB disponible | Fuente principal transaccional | PASS local |
| Web Locks disponible | Exclusión exclusiva entre writers | PASS por contrato/mocks |
| Web Locks ausente | IndexedDB conserva atomicidad; sin mutex localStorage | PASS de diseño |
| BroadcastChannel disponible | Señal sin contenido y recarga desde IndexedDB | PASS simulado |
| BroadcastChannel ausente | señal `storage` como complemento | PASS estático; físico NOT PROVEN |
| Cuota / apertura fallida | falla cerrada, sin escritura legacy | PASS simulado |
| Android WebView físico | requiere prueba de dispositivo | NOT PROVEN |
| Pestañas reales de navegador | requiere prueba de navegador | NOT PROVEN |
