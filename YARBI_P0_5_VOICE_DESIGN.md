# YARBI P0.5 — Diseño de voz para WhatsApp Personal

Estado: propuesta local; no se hicieron descargas, transcripciones, llamadas Gemini ni envíos.

## Camino de entrada propuesto

1. El proveedor autenticado verifica firma antes de procesar bytes.
2. La capa de alcance identifica `owner_personal` antes de CRM.
3. `validateOwnerPersonalAudio` acepta exclusivamente MIME soportado, máximo 16 MiB y 10 minutos.
4. Se persiste solo una referencia HMAC y metadatos de duración/tipo; el contenido se aloja temporalmente con expiración.
5. Un adaptador futuro transcribe/resume usando un proveedor autorizado y pasa texto al mismo `processOwnerTurn` central.
6. El mensaje de respuesta se prepara como texto; no se ejecuta ninguna acción comercial.

## Respuesta hablada futura

No existe hoy generación TTS ni envío de audio en `api/assistant/send-whatsapp.js`. La interfaz futura deberá ser un adaptador de TTS inyectable con este contrato:

```text
prepareSpeech({ text, voicePolicy, operationId })
  -> { audioRef, mimeType, durationMs, expiresAt }
```

El adaptador de envío podrá usar `audioRef` solamente después de confirmación humana y de una carga autenticada al proveedor. Debe eliminar el binario al expirar, nunca registrar contenido ni URL temporal y mantener la operación trazable.

## Límites y seguridad

- MIME: `audio/ogg`, `audio/opus`, `audio/mpeg`, `audio/mp4`, `audio/aac`, `audio/webm`.
- Tamaño: 16 MiB máximo.
- Duración: 600 000 ms máximo.
- Ninguna URL de media se acepta como autoridad; solo un proveedor autenticado puede entregar la referencia.
- El audio saliente sigue ausente hasta una fase dedicada de TTS, carga y consentimiento.
