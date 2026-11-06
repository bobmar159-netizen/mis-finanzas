const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ASSISTANT_API_TOKEN = 'test-token';
process.env.SUPABASE_SECRET_KEY = 'service-key';
process.env.SUPABASE_URL = 'https://example.supabase.co';

const handler = require('../api/assistant/preferences');

function responseRecorder() {
  return {
    statusCode:200,
    headers:{},
    payload:null,
    setHeader(name,value){ this.headers[name] = value; },
    status(code){ this.statusCode = code; return this; },
    json(value){ this.payload = value; return this; },
    end(){ return this; }
  };
}

test('conversation rejects missing assistant token', async () => {
  const res = responseRecorder();
  await handler({ method:'GET', headers:{}, query:{ action:'conversation' } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.ok, false);
});

test('conversation stores only valid bounded messages', async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok:true, status:201, json:async () => ({}) };
  };
  const res = responseRecorder();
  await handler({
    method:'POST',
    headers:{ 'x-assistant-token':'test-token' },
    query:{ action:'conversation' },
    body:{ messages:[
      { id:'a', role:'user', text:'Hola', at:1728400000000, channel:'voice' },
      { id:'b', role:'system', text:'No permitido', at:1728400000000 }
    ] }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.saved, 1);
  const rows = JSON.parse(request.options.body);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'user');
  assert.equal(rows[0].text, 'Hola');
  assert.equal(rows[0].channel, 'voice');
  assert.match(rows[0].owner_key, /^[a-f0-9]{64}$/);
  assert.match(request.url, /on_conflict=owner_key,id/);
});

test('conversation returns cloud history in chronological order', async () => {
  global.fetch = async () => ({
    ok:true,
    status:200,
    json:async () => [
      { id:'new', role:'assistant', text:'Segundo', channel:'chat', message_at:'2026-10-08T15:00:00.000Z' },
      { id:'old', role:'user', text:'Primero', channel:'chat', message_at:'2026-10-08T14:00:00.000Z' }
    ]
  });
  const res = responseRecorder();
  await handler({ method:'GET', headers:{ 'x-assistant-token':'test-token' }, query:{ action:'conversation', limit:'500' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.messages.map(item => item.id), ['old','new']);
  assert.equal(res.payload.source, 'supabase');
});
