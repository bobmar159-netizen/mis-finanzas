'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  DEFAULT_MODEL,
  ownerUnderstandingJsonSchema,
  createGeminiOwnerUnderstandingProvider
} = require('../lib/yarbi-gemini-owner-understanding');
const {
  classifyGeminiInvalidArgument,
  schemaStatistics,
  sanitizedLogicalRequest
} = require('../lib/yarbi-gemini-request-forensics');

const outputPath = path.join(__dirname, 'gemini-request-forensics-evidence.json');
let captured = null;

async function main() {
  const provider = createGeminiOwnerUnderstandingProvider({
    apiKey: 'F3-FORENSIC-KEY-NOT-REAL',
    fetchImpl: async (url, options) => {
      captured = sanitizedLogicalRequest(url, options);
      return new Response(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'synthetic generic invalid argument' } }), { status: 400 });
    }
  });

  let stableError = null;
  try {
    await provider.understandOwnerUtterance({
      utterance: 'F3-FORENSIC frase sintética sin identidad real',
      context: { task: 'reference_lookup', intent: 'reference_lookup', active_constraints: {} }
    });
  } catch (error) {
    stableError = { code: error?.code || null, status: error?.status || null };
  }

  const schema = ownerUnderstandingJsonSchema();
  const evidence = {
    phase: 'gemini_request_forensics',
    network_calls: 0,
    model: DEFAULT_MODEL,
    exact_sanitized_logical_request: captured,
    schema_statistics: schemaStatistics(schema),
    schema,
    current_runtime_error_surface: stableError,
    classification_examples: {
      no_provider_detail: classifyGeminiInvalidArgument({ error: { code: 400, status: 'INVALID_ARGUMENT' } }),
      simulated_complexity: classifyGeminiInvalidArgument({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'responseJsonSchema is too complex' } })
    },
    secrets_present: false,
    real_customer_data_present: false
  };
  const serialized = JSON.stringify(evidence, null, 2) + '\n';
  fs.writeFileSync(outputPath, serialized, 'utf8');
  const sha256 = crypto.createHash('sha256').update(serialized).digest('hex').toUpperCase();
  process.stdout.write(JSON.stringify({ phase: evidence.phase, result: 'PASS', evidence: path.basename(outputPath), sha256 }) + '\n');
}

main().catch(error => {
  process.stderr.write(JSON.stringify({ phase: 'gemini_request_forensics', result: 'FAIL', error: error?.code || error?.name || 'unknown' }) + '\n');
  process.exitCode = 1;
});
