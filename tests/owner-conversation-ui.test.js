'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatReply, candidateLabel, presentationText } = require('../frontend/yarbi-owner-conversation-ui');

test('la conversación propietaria muestra candidatas verificadas sin incluir IDs internos', () => {
  const reply = formatReply({
    reply: '## Búsqueda en CRM\n\nEncontré referencias compatibles.',
    crm_search: { results: [
      { contact_id: 101, display_name: 'Carlos Ramírez', district: 'Surco', latest_service: 'instalación' },
      { contact_id: 102, display_name: 'Carlos Paredes', district: 'Comas', latest_service: 'visita técnica' }
    ] }
  });
  assert.match(reply, /^## Búsqueda en CRM/m);
  assert.match(reply, /## Búsqueda en CRM\n\nEncontré referencias compatibles\.\n\n### Coincidencias verificadas/);
  assert.match(reply, /### Coincidencias verificadas/);
  assert.match(reply, /1\. \*\*Carlos Ramírez\*\* · Surco · instalación/);
  assert.match(reply, /2\. \*\*Carlos Paredes\*\* · Comas · visita técnica/);
  assert.doesNotMatch(reply, /101|102/);
});

test('la etiqueta reduce controles y la respuesta no inventa candidatas cuando no hay resultados', () => {
  assert.equal(candidateLabel({ display_name:'\n# Mónica', district:'<script>', latest_service:'  terma  ' }, 0), '1. **# Mónica** · <script> · terma');
  assert.equal(formatReply({ reply:'Sin coincidencias.', crm_search:{ results:[] } }), 'Sin coincidencias.');
  assert.equal(presentationText('😀😀😀', 2), '😀😀');
});
