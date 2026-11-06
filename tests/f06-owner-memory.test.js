'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyMemoryInput, createProposalToken, readProposalToken, relevantInstructions, semanticKey } = require('../lib/yarbi-owner-memory');

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const SECRET = 'f06-memory-secret-not-real-12345678901234567890';
const INSTRUCTION = { id: 'i-1', name: 'Respuestas cortas', instruction: 'Prefiero respuestas cortas y directas.', active: true, updated_at: '2026-11-06T10:00:00.000Z' };

test('F06 clasifica propuestas permanentes, temporales, comerciales y acciones sin confundirlas', () => {
  assert.equal(classifyMemoryInput({ utterance: 'Yarbi, recuerda que prefiero respuestas cortas.', instructions: [] }).outcome, 'proposal');
  assert.equal(classifyMemoryInput({ utterance: 'Recuérdame llamar al cliente el lunes.', instructions: [] }).outcome, 'temporary');
  assert.equal(classifyMemoryInput({ utterance: 'Carlos abonó 200.', instructions: [] }).outcome, 'commercial_data');
  assert.equal(classifyMemoryInput({ utterance: 'Envía el mensaje ahora.', instructions: [] }).outcome, 'business_action');
  assert.equal(classifyMemoryInput({ utterance: '¿Qué cosas te he enseñado?', instructions: [INSTRUCTION] }).outcome, 'list');
});

test('F06 firma la propuesta para el owner y no acepta otro owner, expiración ni modificación', () => {
  const token = createProposalToken({ ownerId: OWNER, proposal: { operation: 'create', instruction: INSTRUCTION.instruction, name: INSTRUCTION.name }, secret: SECRET, now: 1000 });
  assert.equal(readProposalToken({ token, ownerId: OWNER, secret: SECRET, now: 1001 }).ok, true);
  assert.equal(readProposalToken({ token, ownerId: '00000000-0000-4000-8000-0000000000a2', secret: SECRET, now: 1001 }).ok, false);
  assert.equal(readProposalToken({ token: token + 'x', ownerId: OWNER, secret: SECRET, now: 1001 }).ok, false);
  assert.equal(readProposalToken({ token, ownerId: OWNER, secret: SECRET, now: 1_300_001 }).ok, false);
});

test('F06 deduplica y recupera únicamente instrucciones relevantes activas', () => {
  const duplicate = classifyMemoryInput({ utterance: 'Recuerda que prefiero respuestas cortas y directas.', instructions: [INSTRUCTION] });
  assert.equal(duplicate.outcome, 'duplicate');
  assert.equal(semanticKey(INSTRUCTION.instruction), semanticKey('prefiero respuestas cortas y directas'));
  const found = relevantInstructions([INSTRUCTION, { ...INSTRUCTION, id: 'i-2', instruction: 'Pide ubicación antes de coordinar una visita.', active: true }, { ...INSTRUCTION, id: 'i-3', instruction: 'No usar emojis.', active: false }], '¿qué visita tengo?');
  assert.deepEqual(found.map(row => row.id), ['i-2']);
});
