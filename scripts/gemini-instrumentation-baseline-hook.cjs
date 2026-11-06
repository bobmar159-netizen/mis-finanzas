'use strict';

const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { reconstruct } = require('./verify-gemini-instrumentation-baseline.cjs');

const root = path.resolve(__dirname, '..');
const workspace = path.resolve(root, '..');
const exactTraceBaseline = path.join(workspace, 'audit-baseline-gemini-400', 'lib', 'yarbi-trace.js');
const substitutions = new Map([
  [path.join(root, 'lib', 'yarbi-gemini-owner-understanding.js'), () => reconstruct('lib/yarbi-gemini-owner-understanding.js')],
  [path.join(root, 'lib', 'yarbi-gemini-request-forensics.js'), () => reconstruct('lib/yarbi-gemini-request-forensics.js')],
  [path.join(root, 'lib', 'yarbi-trace.js'), () => fs.readFileSync(exactTraceBaseline, 'utf8')],
  [path.join(root, 'api', 'assistant', 'reference-candidates.js'), () => reconstruct('api/assistant/reference-candidates.js')]
]);

const originalLoader = Module._extensions['.js'];
Module._extensions['.js'] = function loadBaseline(module, filename) {
  const substitute = substitutions.get(path.resolve(filename));
  if (!substitute) return originalLoader(module, filename);
  module._compile(substitute(), filename);
};
