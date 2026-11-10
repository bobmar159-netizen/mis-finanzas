# Rendimiento

La batería focalizada de 38 pruebas completó en aproximadamente 121 ms en Node local. Este valor es de CPU/mocks; no representa latencia de navegador, IndexedDB real, Android ni red.

La arquitectura elimina escrituras JSON completas de Timeline/Outbox por mensaje y evita red dentro de transacciones. Aún no hay medición física de Android ni benchmark multipestaña; ambos son **NOT PROVEN**.
