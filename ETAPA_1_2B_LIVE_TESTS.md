# Gemini Live y chat

Las pruebas existentes se adaptaron al contrato asíncrono y conservan:

- identidad Live v2 tipada;
- duplicado repetido idempotente;
- separación de sesión/turno;
- borrador visible hasta persistencia y renderer;
- fallo de persistencia o renderer sin falsa finalización;
- contenido parcial renderizado como parcial.

La ruta de audio de alta frecuencia no espera almacenamiento. Solo el cierre de turno inicia el trabajo asíncrono. No se llamó Gemini remoto.
