const assert = require('node:assert/strict');
const test = require('node:test');
const tutor = require('../frontend/yarbi-multimodal-tutor.js');

const cases = [
  { id:'exact', question:'¿Qué establece el numeral 7.3 sobre la válvula común?', normalized:'¿Qué establece el numeral 7.3 sobre la válvula común?', terms:['válvula común','numeral 7.3'] },
  { id:'no-keyword', question:'¿Pueden compartir ese corte?', normalized:'¿Puede ese corte alimentar a varios artefactos?', terms:['corte compartido','artefactos'] },
  { id:'paraphrase', question:'¿Una sola llave alcanza para ambos aparatos?', normalized:'¿Una sola llave alcanza para ambos aparatos?', terms:['llave común','aparatos'] },
  { id:'colloquial', question:'Eso de que una llave le da a los dos, ¿cómo era?', normalized:'¿Una válvula común alimenta dos artefactos?', terms:['válvula común','dos artefactos'] },
  { id:'speech-error', question:'¿La balbula sirve pa los dos artefactos?', normalized:'¿La válvula sirve para los dos artefactos?', terms:['válvula','dos artefactos'] },
  { id:'incomplete', question:'¿Y el otro aparato?', context:[{ role:'user', text:'Estoy consultando si una válvula común alimenta dos artefactos.' }], normalized:'¿Qué condición aplica al segundo aparato en una conexión con una válvula común para dos artefactos?', terms:['segundo aparato','válvula común'] },
  { id:'context-reference', question:'¿Dónde dice eso?', context:[{ role:'user', text:'Estoy leyendo la NTP 111.011 sobre válvula para dos artefactos.' }], normalized:'¿Dónde dice la NTP 111.011 la condición para una válvula común y dos artefactos?', terms:['NTP 111.011','válvula común'] },
  { id:'compare-documents', question:'Compara NTP 111.011 con EM.040 para este caso.', normalized:'Compara NTP 111.011 y EM.040 para el mismo caso.', terms:['NTP 111.011','EM.040','mismo caso'] },
  { id:'table', question:'¿Qué valor aparece en la tabla de presión?', normalized:'Recupera el valor de la tabla de presión y sus condiciones.', terms:['tabla de presión','valor','condiciones'] },
  { id:'diagram', question:'En el esquema, ¿qué conecta esta flecha?', normalized:'Identifica en el diagrama qué elementos conecta la flecha indicada.', terms:['diagrama','flecha','conexión'] },
  { id:'no-evidence', question:'¿Qué dice sobre el modelo ZR-9000?', normalized:'Busca si las fuentes aprobadas mencionan el modelo ZR-9000.', terms:['modelo ZR-9000'] },
  { id:'ambiguous-number', question:'¿La presión era 21 o 2.1?', normalized:'', terms:[], clarify:true }
];

test('contrato documental natural conserva 12 tipos de consulta con contexto y cifras protegidas', async () => {
  const previous = {
    fetch:global.fetch,
    token:global.gfcAccountFreshAccessToken,
    origin:global.gfcRuntimeApiOrigin
  };
  const assets = [
    { id:'ntp', title:'NTP 111.011.pdf', kind:'pdf', status:'approved', learningEnabled:true, sha256:'a'.repeat(64), sections:[{ label:'Numeral 7.3 · Página 8', text:'Fuente sintética sobre conexión de artefactos.' }] },
    { id:'em040', title:'EM.040.pdf', kind:'pdf', status:'approved', learningEnabled:true, sha256:'b'.repeat(64), sections:[{ label:'Sección 5 · Página 12', text:'Otra fuente sintética sobre instalaciones.' }] }
  ];
  global.gfcAccountFreshAccessToken = async () => 'synthetic-session-token';
  global.gfcRuntimeApiOrigin = () => 'https://synthetic.invalid';
  try {
    for (const scenario of cases) {
      let request;
      global.fetch = async (_url, options) => {
        request = JSON.parse(options.body);
        const result = {
          intent:'knowledge', reason:'consulta documental sintética', normalized_query:scenario.normalized,
          search_terms:scenario.terms, query_variants:[], source_asset_id:scenario.id === 'compare-documents' ? '' : 'ntp',
          clarification_required:scenario.clarify === true,
          clarification_question:scenario.clarify ? '¿Cuál de esos dos valores quieres consultar?' : ''
        };
        return { ok:true, json:async () => ({ candidates:[{ content:{ parts:[{ text:JSON.stringify(result) }] } }] }) };
      };
      const plan = await tutor.classifyKnowledgeIntent(scenario.question, assets, scenario.context || []);
      assert.equal(plan.intent, 'knowledge', scenario.id);
      assert.match(request.contents[0].parts[0].text, new RegExp(scenario.question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), scenario.id);
      if (scenario.context) assert.match(request.contents[0].parts[0].text, new RegExp(scenario.context[0].text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), scenario.id);
      if (scenario.clarify) assert.equal(plan.clarificationRequired, true, scenario.id);
      else {
        assert.equal(plan.clarificationRequired, false, scenario.id);
        assert.equal(tutor.validateProtectedKnowledgeIntent(scenario.question, scenario.context || [], plan).ok, true, scenario.id);
      }
    }
  } finally {
    global.fetch = previous.fetch;
    global.gfcAccountFreshAccessToken = previous.token;
    global.gfcRuntimeApiOrigin = previous.origin;
  }
});

test('contrato de abstención y citas admite solo evidencia de fuente sintética', () => {
  const unavailable = require('../lib/yarbi-gemini-file-search.js').parseFileSearchAnswer(JSON.stringify({
    found:false, answer:'', exact_quote:'', reference:'', plain_explanation:'', caveat:'La fuente no contiene evidencia.'
  }));
  assert.equal(unavailable.found, false);
  const citation = { source:'Tabla 4.2 — Presión de prueba: 2.1 kPa.', page:18 };
  assert.equal(require('../lib/yarbi-gemini-file-search.js').referenceSupportedByCitation('Tabla 4.2', [citation]), true);
  assert.equal(require('../lib/yarbi-gemini-file-search.js').referenceSupportedByCitation('Numeral 9.9', [citation]), false);
});
