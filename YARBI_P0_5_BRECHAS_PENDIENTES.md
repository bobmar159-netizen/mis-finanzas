# YARBI P0.5 — Brechas pendientes

## Bloqueantes antes de un Preview

1. **18 Functions frente a Hobby 12.** El empaquetado actual no cabe bajo el modelo Vercel Other/Hobby identificado. Hace falta una subfase de consolidación reversible o cambiar de plan, que no fue autorizado.
2. **Espacio en `C:` insuficiente.** La comprobación inicial mostró aproximadamente 130 MB libres. Un build debe usar `D:` como espacio temporal, sin borrar archivos existentes.
3. **Configuración Preview aislada.** P0.4 dejó guardias de configuración pendientes de verificación remota. P0.5 no hizo Preview ni leyó variables remotas.

## WhatsApp personal: listo localmente, pendiente de activación controlada

- La migración es una propuesta local y no se ejecutó.
- Falta decidir proveedor y validar, sin credenciales reales, qué número/destino identifica de forma inequívoca el espacio personal.
- Falta aplicar la migración solo en un entorno aislado, probar RLS y conectar el adaptador al webhook sin cambiar el pipeline comercial.
- Falta implementar una cola/transcripción que use proveedores aprobados. P0.5 solo valida límites y referencias de audio opacas.
- La respuesta hablada requiere un proveedor TTS o capacidad de salida definida; no se añadió uno.

## Calidad y estabilidad

- Persisten 30 fallos heredados de la suite general. La matriz P0.5 los clasifica; ninguno se ocultó.
- Las métricas son locales y sintéticas: no son métricas de Vercel, Supabase, Gemini ni producción.
- No se hizo prueba real de YCloud ni Meta, por tanto capacidades de coexistencia, plantillas, ventanas y medios siguen `NOT PROVEN`.

## Siguiente paso mínimo recomendado

Autorizar una subfase única de empaquetado local en `D:` que reduzca Functions mediante staging y pruebas contractuales, sin cambiar `vercel.json` ni desplegar. Solo después se podrá preparar un Preview realmente seguro.
