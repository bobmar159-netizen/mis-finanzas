/* F07: dictado temporal para el chat central. El audio nunca se persiste ni
   sale del dispositivo; solo el texto revisado llega al mismo flujo F05. */
(function () {
  const MAX_DURATION_MS = 60000;
  const state = { recognition: null, timer: 0, transcript: '', startedAt: 0, cancelled: false, review: null };

  function clean(value, limit = 1200) { return String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit); }
  function nativePlatform() { return Boolean(window.Capacitor?.isNativePlatform?.()); }
  function setStatus(message, error) {
    const node = document.getElementById('gfc-f07-voice-status');
    if (node) { node.textContent = message; node.style.color = error ? '#B42318' : '#667085'; }
  }
  function resetCapture() { if (state.timer) clearTimeout(state.timer); state.timer = 0; state.recognition = null; state.startedAt = 0; }
  function friendly(error) {
    const code = String(error?.error || error?.message || error || '').toLowerCase();
    if (/not-allowed|permission|denied/.test(code)) return 'El permiso del micrófono fue denegado. Puedes escribir tu consulta.';
    if (/no-speech|aborted/.test(code)) return 'No detecté voz. Inténtalo de nuevo o escribe tu consulta.';
    if (/network/.test(code)) return 'Se perdió la conexión del reconocimiento. El texto no fue enviado.';
    if (/audio-capture|device/.test(code)) return 'No encuentro un micrófono disponible.';
    return 'No pude transcribir ahora. Puedes escribir tu consulta.';
  }
  async function requestPermission() {
    if (nativePlatform()) return true; // El polyfill solicita permisos al plugin nativo.
    if (!navigator.mediaDevices?.getUserMedia) return true; // SpeechRecognition reportará soporte real.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    return true;
  }
  function recognitionConstructor() {
    if (typeof window.gfcRegisterSpeechRecognitionPolyfill === 'function') window.gfcRegisterSpeechRecognitionPolyfill();
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }
  function renderReview(raw) {
    const transcript = clean(raw);
    if (!transcript) { setStatus('No detecté texto para revisar.', true); return; }
    state.review?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'gfc-f07-voice-review';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    const card = document.createElement('section');
    const title = document.createElement('h3'); title.textContent = 'Revisa lo que entendí';
    const note = document.createElement('p'); note.textContent = 'Nada se envía hasta que confirmes. El audio no se guarda.';
    const textarea = document.createElement('textarea'); textarea.value = transcript; textarea.rows = 5; textarea.maxLength = 1200; textarea.setAttribute('aria-label', 'Texto transcrito');
    const actions = document.createElement('div'); actions.className = 'gfc-f07-voice-review-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancelar';
    const use = document.createElement('button'); use.type = 'button'; use.textContent = 'Enviar a Yarbi'; use.className = 'primary';
    cancel.onclick = () => { overlay.remove(); state.review = null; setStatus('Dictado cancelado.'); };
    use.onclick = async () => { const value = clean(textarea.value); if (!value) return setStatus('Escribe o dicta una consulta antes de enviar.', true); overlay.remove(); state.review = null; await submitReviewed(value); };
    actions.append(cancel, use); card.append(title, note, textarea, actions); overlay.append(card); document.body.append(overlay); state.review = overlay; textarea.focus();
  }
  async function submitReviewed(text) {
    setStatus('Enviando texto revisado…');
    try {
      const isMemory = /\b(recuerda que|prefiero|a partir de ahora|de ahora en adelante|instrucci[oó]n|siempre|que me has|que te he|muestrame)\b/i.test(text);
      if (isMemory && typeof window.gfcOwnerMemoryReviewUtterance === 'function') {
        const memory = await window.gfcOwnerMemoryReviewUtterance(text, 'voice');
        if (memory?.handled) {
          if (memory.outcome === 'list') {
            const names = (memory.instructions || []).map(item => item.name || item.instruction).slice(0, 8);
            const reply = names.length ? 'Estas son tus instrucciones activas: ' + names.join('; ') + '.' : 'Todavía no tienes instrucciones permanentes activas.';
            window.gfcAppendCopilotChatMessage?.('user', text); window.gfcAppendCopilotChatMessage?.('assistant', reply);
            setStatus('Consulta de memoria lista.'); return;
          }
          if (memory.duplicate) { const reply = 'Esa instrucción ya estaba activa.'; window.gfcAppendCopilotChatMessage?.('assistant', reply); setStatus(reply); return; }
          if (memory.saved) { const reply = 'Guardé la instrucción confirmada.'; window.gfcAppendCopilotChatMessage?.('user', text); window.gfcAppendCopilotChatMessage?.('assistant', reply); setStatus(reply); return; }
          const reply = memory.code === 'memory_temporal_not_permanent' ? 'Eso parece un recordatorio temporal; no lo guardé como instrucción permanente.' : 'No guardé esa frase como instrucción permanente.';
          window.gfcAppendCopilotChatMessage?.('assistant', reply); setStatus(reply); return;
        }
      }
      const field = document.getElementById('gfc-copilot-input-text'); if (field) field.value = text;
      if (typeof window.gfcSendYarbiUnifiedMessage === 'function') await window.gfcSendYarbiUnifiedMessage(text);
      else if (typeof window.gfcSendCopilotChatMessage === 'function') await window.gfcSendCopilotChatMessage(text);
      else throw new Error('chat_unavailable');
      setStatus('Texto enviado al cerebro de Yarbi.');
    } catch (error) { setStatus(friendly(error), true); }
  }
  function stop({ cancelled = false } = {}) {
    state.cancelled = cancelled;
    try { state.recognition?.stop?.(); } catch (_) {}
    if (cancelled) { resetCapture(); state.transcript = ''; setStatus('Dictado cancelado.'); }
  }
  async function start() {
    if (state.recognition) return stop();
    state.cancelled = false; state.transcript = '';
    try {
      await requestPermission();
      const Recognition = recognitionConstructor();
      if (!Recognition) throw { error: 'service-not-allowed' };
      const recognition = new Recognition(); state.recognition = recognition; state.startedAt = Date.now();
      recognition.lang = 'es-PE'; recognition.interimResults = true; recognition.continuous = false; recognition.maxAlternatives = 1;
      const update = value => { const transcript = clean(value); if (transcript) { state.transcript = transcript; setStatus('Escuchando: ' + transcript); } };
      recognition.onpartial = update;
      recognition.onresult = event => { const transcript = Array.from(event?.results || []).map(item => item?.[0]?.transcript || '').join(' '); update(transcript); };
      recognition.onerror = error => { if (!state.cancelled) setStatus(friendly(error), true); };
      recognition.onend = () => { const value = state.transcript; const cancelled = state.cancelled; resetCapture(); if (!cancelled && value) renderReview(value); else if (!cancelled) setStatus('No detecté voz. Puedes intentar de nuevo o escribir.', true); };
      state.timer = window.setTimeout(() => { setStatus('Llegaste al límite de un minuto. Revisa el texto.'); stop(); }, MAX_DURATION_MS);
      recognition.start(); setStatus('Escuchando… toca de nuevo para detener.');
    } catch (error) { resetCapture(); setStatus(friendly(error), true); }
  }
  function controls() {
    document.querySelectorAll('.gfc-yarbi-composer').forEach(composer => {
      if (composer.querySelector('[data-f07-voice]')) return;
      const mic = document.createElement('button'); mic.type = 'button'; mic.dataset.f07Voice = 'true'; mic.className = 'gfc-f07-voice-button'; mic.textContent = '🎙 Dictar'; mic.setAttribute('aria-label', 'Dictar y revisar antes de enviar'); mic.onclick = start;
      composer.insertBefore(mic, composer.querySelector('.gfc-yarbi-send-btn') || null);
    });
    document.querySelectorAll('.gfc-yarbi-composer-wrap').forEach(wrap => { if (!wrap.querySelector('#gfc-f07-voice-status')) { const status = document.createElement('small'); status.id = 'gfc-f07-voice-status'; status.textContent = 'Dicta, revisa y confirma antes de enviar.'; wrap.append(status); } });
  }
  function installStyles() {
    if (document.getElementById('gfc-f07-voice-style')) return;
    const style = document.createElement('style'); style.id = 'gfc-f07-voice-style';
    style.textContent = '.gfc-f07-voice-button{border:1px solid #99d8c7;background:#fff;color:#0f766e;border-radius:10px;padding:8px 9px;font-weight:800;cursor:pointer}.gfc-f07-voice-review{position:fixed;inset:0;z-index:20050;background:rgba(15,23,42,.48);display:grid;place-items:center;padding:20px}.gfc-f07-voice-review section{width:min(540px,100%);background:#fff;border-radius:16px;padding:20px;box-shadow:0 18px 46px rgba(15,23,42,.28)}.gfc-f07-voice-review h3{margin:0 0 8px}.gfc-f07-voice-review p{color:#475569;line-height:1.45}.gfc-f07-voice-review textarea{box-sizing:border-box;width:100%;resize:vertical;border:1px solid #cbd5e1;border-radius:10px;padding:10px;font:inherit}.gfc-f07-voice-review-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.gfc-f07-voice-review button{border:1px solid #cbd5e1;background:#fff;border-radius:9px;padding:9px 12px;font-weight:800;cursor:pointer}.gfc-f07-voice-review button.primary{background:#0f766e;border-color:#0f766e;color:#fff}#gfc-f07-voice-status{display:block;margin-top:7px;font-size:12px;line-height:1.35}';
    document.head.append(style);
  }
  const observer = new MutationObserver(() => controls());
  window.gfcF07Voice = Object.freeze({ start, stop, submitReviewed, state: () => ({ active: !!state.recognition, transcript: state.transcript, retention: 'no_audio_persistence' }) });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { installStyles(); controls(); observer.observe(document.body, { childList:true, subtree:true }); });
  else { installStyles(); controls(); observer.observe(document.body, { childList:true, subtree:true }); }
})();
