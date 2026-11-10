# Pruebas multipestaña

`tests/etapa1-cross-tab-concurrency.test.js` usa dos contextos de navegador simulados que comparten IndexedDB y Web Locks.

PASS:

- dos writers con mismo ID producen un `persisted`, un `idempotent`, una fila y un Outbox;
- colisión de contenido distinto conserva el original;
- BroadcastChannel envía solamente tipo/revisión, nunca texto;
- migración simultánea es idempotente por metadata y bloqueo;
- almacenamiento ausente falla cerrado.

No se declara equivalencia física: navegador con dos pestañas y Android WebView son **NOT PROVEN** y deben verificarse antes de cerrar validación de dispositivo.
