/* F06: doble confirmación para instrucciones en Preview. No persiste nada
   mientras el propietario no acepte expresamente la propuesta presentada. */
(function () {
  async function request(body) {
    const token = typeof window.gfcAccountFreshAccessToken === 'function' ? await window.gfcAccountFreshAccessToken() : '';
    if (!token) throw new Error('Inicia sesión con la cuenta autorizada antes de guardar instrucciones.');
    const response = await fetch(window.gfcRuntimeApiOrigin() + '/api/assistant/memory', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true) throw new Error(data.error || 'La instrucción no fue confirmada por el almacenamiento seguro.');
    return data;
  }
  async function previewEnabled() { try { return (await window.gfcSupabaseAuthConfig()).previewOwnerReferencesOnly === true; } catch (_) { return false; } }
  function replaceCache(row) {
    if (!row || typeof window.gfcOwnerInstructionSetCachedList !== 'function') return;
    const current = typeof window.gfcOwnerInstructionVisibleList === 'function' ? window.gfcOwnerInstructionVisibleList() : [];
    window.gfcOwnerInstructionSetCachedList([row, ...current.filter(value => value.id !== row.id && value.instruction !== row.instruction)]);
  }
  async function propose(body) {
    const proposal = await request({ action: 'propose', ...body });
    if (proposal.outcome === 'duplicate') return { handled: true, duplicate: true, instruction: proposal.instruction };
    if (proposal.outcome === 'list') return { handled: true, outcome: 'list', instructions: Array.isArray(proposal.instructions) ? proposal.instructions : [] };
    if (proposal.outcome && proposal.outcome !== 'proposal_requires_confirmation') return { handled: true, outcome: proposal.outcome, code: proposal.code || '' };
    if (!proposal.proposal_token || !proposal.proposal) throw new Error('No se pudo preparar una propuesta segura.');
    const operation = proposal.proposal.operation === 'set_active' ? (proposal.proposal.active ? 'activar' : 'pausar') : proposal.proposal.operation === 'edit' ? 'editar' : 'guardar';
    const accepted = window.confirm('Yarbi propone ' + operation + ' esta instrucción:\n\n“' + proposal.proposal.instruction + '”\n\n¿Confirmas este cambio permanente?');
    if (!accepted) return { handled: true, cancelled: true };
    const saved = await request({ action: 'confirm', confirm: true, proposal_token: proposal.proposal_token });
    replaceCache(saved.instruction);
    return { handled: true, saved };
  }
  window.gfcOwnerMemorySaveWithConfirmation = async function (record) {
    if (!(await previewEnabled())) return { handled: false };
    return propose({ utterance: 'Recuerda que ' + String(record?.instruction || ''), source_channel: record?.source_channel === 'voice' ? 'voice' : 'app' });
  };
  window.gfcOwnerMemorySetActiveWithConfirmation = async function (record, active) {
    if (!(await previewEnabled())) return { handled: false };
    return propose({ operation: 'set_active', instruction_id: record?.id, active: active !== false });
  };
  window.gfcOwnerMemoryEditWithConfirmation = async function (record) {
    if (!(await previewEnabled())) return { handled: false };
    return propose({ operation: 'edit', instruction_id: record?.id, instruction: record?.instruction, name: record?.name, category: record?.category });
  };
  window.gfcOwnerMemoryReviewUtterance = async function (utterance, sourceChannel) {
    if (!(await previewEnabled())) return { handled: false };
    return propose({ utterance: String(utterance || ''), source_channel: sourceChannel === 'voice' ? 'voice' : 'app' });
  };
})();
