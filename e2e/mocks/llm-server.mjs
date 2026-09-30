// Mock OpenAI-compatible LLM server for the E2E suite.
// Serves the exact endpoints OpenAICompatProvider uses:
//   GET  /v1/models            (listModels / checkOnline)
//   POST /v1/chat/completions  (streaming SSE + non-streaming JSON)
// Replies are routed deterministically by prompt content so specs never need
// a real model: classifier prompts get a one-word intent, command-extraction
// prompts get JSON built from the real tab titles embedded in the prompt,
// everything else (chat, checkpoint summaries) gets a canned reply.
import http from 'node:http';

let server = null;

function messageText(body) {
  return (body.messages ?? []).map((m) => `${m.role}:${m.content ?? ''}`).join('\n');
}

function extractTerminals(userContent) {
  const m = /Available terminals: (.*)/.exec(userContent ?? '');
  if (!m || m[1].includes('(no terminals open)')) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/**
 * The routing decision must be based on the user's actual message — the tail
 * of the prompt — not the whole prompt, whose schema text mentions
 * "checkpoint"/"pass_work" and would poison keyword matching.
 */
function finalMessage(userContent) {
  const m = /message: "([\s\S]*)"\s*$/i.exec(userContent ?? '');
  return m ? m[1] : userContent ?? '';
}

function route(systemText, userText) {
  const userMessage = finalMessage(userText);
  if (systemText.includes('strict classifier')) {
    if (/what's running|checkpoint|pass .* work|status/i.test(userMessage)) return 'command';
    if (/\b(build|implement|create) /.test(userMessage)) return 'plan';
    return 'chat';
  }
  if (systemText.includes('extract a structured command')) {
    const terminals = extractTerminals(userText);
    const mentioned = terminals.filter((t) => userMessage.includes(t));
    if (/pass|hand over|handover/i.test(userMessage)) {
      return JSON.stringify({
        action: 'pass_work',
        source: mentioned[0] ?? terminals[0] ?? '',
        destination: mentioned[1] ?? terminals[1] ?? terminals[0] ?? '',
      });
    }
    if (/checkpoint/i.test(userMessage)) {
      return JSON.stringify({
        action: 'checkpoint',
        source: mentioned[0] ?? terminals[0] ?? '',
        destination: '',
      });
    }
    return JSON.stringify({ action: 'status', source: '', destination: '' });
  }
  return 'Mock reply: the mock LLM is answering. Everything looks calm.';
}

function completionJson(content) {
  return JSON.stringify({
    id: 'mock-chatcmpl-1',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'mock-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Origin',
};

function createServer() {
  return http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      return res.end(
        JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] })
      );
    }
    if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let body = {};
        try {
          body = JSON.parse(raw);
        } catch {
          /* malformed request — treat as empty */
        }
        const systemText = (body.messages ?? [])
          .filter((m) => m.role === 'system')
          .map((m) => m.content ?? '')
          .join('\n');
        const userText = (body.messages ?? [])
          .filter((m) => m.role === 'user')
          .map((m) => m.content ?? '')
          .join('\n');
        const content = route(systemText, userText);
        console.log(
          `[llm-mock] ${systemText.includes('strict classifier') ? 'classify' : systemText.includes('extract a structured command') ? 'extract' : 'generate'} → ${content.slice(0, 90)}`
        );

        if (body.stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            ...CORS,
          });
          for (const piece of content.split(/(?<=\s)/)) {
            res.write(
              `data: ${JSON.stringify({
                id: 'mock-chatcmpl-1',
                object: 'chat.completion.chunk',
                choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
              })}\n\n`
            );
          }
          res.write('data: [DONE]\n\n');
          return res.end();
        }

        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        return res.end(completionJson(content));
      });
      return;
    }
    res.writeHead(404, CORS);
    res.end();
  });
}

export function startLlmMock(port = 8899) {
  return new Promise((resolve, reject) => {
    server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

export function stopLlmMock() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = null;
  });
}
