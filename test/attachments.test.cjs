// Chat attachments: validation by content, names and paths, what each provider receives, the restricted protocol,
// deleting a chat, the additive migration, the phone allowlist and the upload route.
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const A = require('../electron/attachments.cjs');
const { createAttachmentStore } = require('../electron/attachment-store.cjs');
const { UserError } = require('../electron/errors.cjs');

const tmp = (p = 'vesta-att-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(30)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]);
const refuses = (fn, re) => assert.throws(fn, (e) => e instanceof UserError && re.test(e.message));

// ---- type, size and signature --------------------------------------------------------------------------------------
test('classify accepts images by signature and returns the real mime', () => {
  assert.deepEqual(A.classify('a.png', PNG, PNG.length).mime, 'image/png');
  assert.equal(A.classify('a.jpg', JPG, JPG.length).mime, 'image/jpeg');
  assert.equal(A.classify('a.JPEG', JPG, JPG.length).kind, 'image');
  assert.equal(A.classify('a.gif', GIF, GIF.length).mime, 'image/gif');
  assert.equal(A.classify('a.webp', WEBP, WEBP.length).mime, 'image/webp');
});
test('classify rejects fake images, mismatched extensions, empty files and the size limits', () => {
  refuses(() => A.classify('x.png', Buffer.from('not an image'), 12), /não é uma imagem válida/);
  refuses(() => A.classify('x.jpg', PNG, PNG.length), /extensão não corresponde/);
  refuses(() => A.classify('x.txt', PNG, PNG.length), /não é uma imagem válida|extensão/);
  refuses(() => A.classify('vazio.txt', Buffer.alloc(0), 0), /vazio/);
  refuses(() => A.classify('big.png', PNG, 20 * 1024 * 1024 + 1), /20 MB/);
  assert.equal(A.classify('ok.png', PNG, 20 * 1024 * 1024).kind, 'image');
  refuses(() => A.classify('big.pdf', PDF, 30 * 1024 * 1024 + 1), /30 MB/);
  assert.equal(A.classify('ok.pdf', PDF, 30 * 1024 * 1024).kind, 'document');
});
test('classify accepts documents by content: pdf, office zips, text and common source code', () => {
  assert.equal(A.classify('a.pdf', PDF, PDF.length).mime, 'application/pdf');
  refuses(() => A.classify('a.pdf', Buffer.from('hello'), 5), /PDF válido/);
  for (const e of ['docx', 'xlsx', 'pptx']) assert.equal(A.classify('a.' + e, ZIP, ZIP.length).kind, 'document');
  refuses(() => A.classify('a.docx', Buffer.from('plain'), 5), /DOCX válido/);
  const text = Buffer.from('linha 1\nlinha 2 ação\n');
  for (const e of [
    'txt',
    'md',
    'csv',
    'json',
    'xml',
    'yaml',
    'yml',
    'log',
    'html',
    'js',
    'ts',
    'py',
    'go',
    'java',
    'cs',
    'rs',
  ])
    assert.equal(A.classify('a.' + e, text, text.length).kind, 'document', e);
  refuses(() => A.classify('a.txt', Buffer.from([1, 2, 0, 3, 0, 0, 4]), 7), /não parece um arquivo de texto/);
  refuses(() => A.classify('virus.exe', text, text.length), /não suportado/);
  refuses(() => A.classify('semextensao', text, text.length), /não suportado/);
});

// ---- names, traversal -----------------------------------------------------------------------------------------------
test('sanitizeName never leaves a folder, hits a device name or keeps control characters', () => {
  assert.equal(A.sanitizeName('../../etc/passwd'), 'passwd');
  assert.equal(A.sanitizeName('C:\\Users\\x\\foto.png'), 'foto.png');
  assert.equal(A.sanitizeName('con.txt'), '_con.txt');
  assert.equal(A.sanitizeName('a<b>:"|?*c.txt'), 'a_b______c.txt');
  assert.equal(A.sanitizeName('x\u0000y\n.png'), 'x_y_.png');
  assert.equal(A.sanitizeName('...'), 'arquivo');
  assert.equal(A.sanitizeName(''), 'arquivo');
  assert.ok(A.sanitizeName('a'.repeat(300) + '.png').length <= 92);
  assert.equal(path.basename(A.sanitizeName('..\\..\\x.txt')), A.sanitizeName('..\\..\\x.txt'));
});
test('the store copies inside its root, never touches the original and ignores hostile names', () => {
  const root = tmp(),
    src = tmp('vesta-src-');
  const store = createAttachmentStore({ root });
  const original = path.join(src, 'foto.png');
  fs.writeFileSync(original, PNG);
  const a = store.stagePath(original);
  assert.equal(a.kind, 'image');
  assert.ok(fs.existsSync(original), 'original stays');
  assert.notEqual(path.resolve(a.path), path.resolve(original));
  assert.ok(path.resolve(a.path).startsWith(path.resolve(root) + path.sep));
  assert.match(path.basename(a.path), /^[a-f0-9]{12}-foto\.png$/);
  const b = store.stageBuffer('..\\..\\..\\evil.txt', Buffer.from('oi'));
  assert.equal(path.dirname(path.resolve(b.path)), path.resolve(store.staging));
  assert.equal(b.name, 'evil.txt');
  refuses(() => store.stagePath(src), /arquivo/); // a folder
  refuses(() => store.stagePath(path.join(src, 'nao-existe.png')), /ler o arquivo/);
  fs.writeFileSync(path.join(src, 'falso.png'), 'texto');
  refuses(() => store.stagePath(path.join(src, 'falso.png')), /imagem válida/);
  assert.equal(fs.readdirSync(store.staging).length, 2, 'refused files leave nothing behind');
});

// ---- the restricted protocol ---------------------------------------------------------------------------------------
test('vesta-attachment:// resolves only files directly inside the attachments folder', () => {
  const root = tmp();
  const ok = A.resolveUrl(root, 'vesta-attachment://f/chat-1/abc123abc123-foto.png');
  assert.equal(ok, path.join(path.resolve(root), 'chat-1', 'abc123abc123-foto.png'));
  assert.match(
    A.resolveUrl(root, 'vesta-attachment://f/_staging/abc123abc123-foto.png?t=1'),
    /abc123abc123\.thumb\.png$/
  );
  const bad = [
    'vesta-attachment://f/chat-1/..%2F..%2Fsecret.txt',
    'vesta-attachment://f/chat-1/%2e%2e/secret.txt',
    'vesta-attachment://f/../secret.txt',
    'vesta-attachment://f/chat-1/..',
    'vesta-attachment://f/chat-1/a%5Cb.png',
    'vesta-attachment://f/chat-1/C:%5Cwindows%5Cwin.ini',
    'vesta-attachment://f/chat-1/sub/file.png',
    'vesta-attachment://f/%2e%2e/x.png',
    'vesta-attachment://f/chat%2F1/x.png',
    'vesta-attachment://other/chat-1/x.png',
    'vesta-attachment://f/x.png',
    'file:///C:/Windows/win.ini',
    'https://example.com/x.png',
    'vesta-attachment://f/chat-1/a.png%00.txt',
    'not a url',
  ];
  for (const url of bad) assert.equal(A.resolveUrl(root, url), null, url);
});

// ---- staging, sending, cleanup -------------------------------------------------------------------------------------
test('commit moves staged files into the chat folder and validates again; removeChat deletes them', () => {
  const root = tmp();
  const store = createAttachmentStore({ root });
  const a = store.stageBuffer('foto.png', PNG),
    b = store.stageBuffer('nota.txt', Buffer.from('frase'));
  const sent = store.commit('chat-1', [a.id, b.id]);
  assert.equal(sent.length, 2);
  for (const s of sent) {
    assert.equal(path.dirname(s.path), path.join(path.resolve(root), 'chat-1'));
    assert.ok(fs.existsSync(s.path));
  }
  assert.equal(fs.readdirSync(store.staging).length, 0);
  assert.equal(store.fileOf('chat-1', sent[0]), sent[0].path);
  assert.equal(store.fileOf('chat-2', sent[0]), null, 'another chat cannot claim it');
  assert.equal(store.removeChat('chat-1'), true);
  assert.equal(fs.existsSync(path.join(root, 'chat-1')), false);
  assert.equal(store.removeChat('../..'), false);
  assert.equal(store.removeChat('_staging'), false);
});
test('commit refuses missing ids, more than 10 files, and a staged file that changed into something else', () => {
  const root = tmp();
  const store = createAttachmentStore({ root });
  refuses(() => store.commit('c', ['abcdefabcdef']), /não está mais disponível/);
  refuses(() => store.commit('../x', []), /inválida/);
  const many = Array.from({ length: 11 }, (_, i) => store.stageBuffer('n' + i + '.txt', Buffer.from('x')).id);
  refuses(() => store.commit('c', many), /No máximo 10/);
  const f = store.stageBuffer('ok.png', PNG);
  fs.writeFileSync(store.stagedPath(f.id), 'agora é texto');
  refuses(() => store.commit('c', [f.id]), /imagem válida/);
  assert.equal(fs.existsSync(path.join(root, 'c')), false, 'nothing is moved when one file is refused');
});
test('discard, sweep and prune clean what nobody sent', () => {
  const root = tmp();
  const store = createAttachmentStore({ root });
  const a = store.stageBuffer('a.txt', Buffer.from('x')),
    b = store.stageBuffer('b.txt', Buffer.from('y'));
  assert.equal(store.discard(a.id), true);
  assert.equal(store.discard(a.id), false);
  assert.equal(store.sweep(Date.now() + 1000), 0);
  assert.equal(store.sweep(Date.now() + 25 * 3600 * 1000), 1);
  assert.equal(store.stagedPath(b.id), null);
  const keep = store.stageBuffer('k.txt', Buffer.from('k'));
  store.commit('vivo', [keep.id]);
  fs.mkdirSync(path.join(root, 'morto'));
  fs.writeFileSync(path.join(root, 'morto', 'x'), '1');
  assert.equal(store.prune(['vivo']), 1);
  assert.ok(fs.existsSync(path.join(root, 'vivo')));
  assert.equal(fs.existsSync(path.join(root, 'morto')), false);
});
test('thumbnails are made for png/jpeg when an image engine is available', () => {
  const root = tmp();
  const fakeImage = {
    isEmpty: () => false,
    getSize: () => ({ width: 1000, height: 500 }),
    resize: (o) => ({ toPNG: () => Buffer.from('thumb' + o.width) }),
  };
  const store = createAttachmentStore({ root, nativeImage: { createFromPath: () => fakeImage } });
  const a = store.stageBuffer('foto.png', PNG);
  assert.equal(a.thumb, true);
  assert.equal(a.width, 1000);
  assert.equal(fs.readFileSync(A.thumbPath(a.path), 'utf8'), 'thumb320');
  const [sent] = store.commit('c', [a.id]);
  assert.equal(sent.thumb, true);
  assert.ok(fs.existsSync(A.thumbPath(sent.path)));
  assert.equal(store.stageBuffer('g.gif', GIF).thumb, undefined);
});

// ---- what each provider receives -----------------------------------------------------------------------------------
const att = (over) => ({
  id: 'a1',
  name: 'x.png',
  kind: 'image',
  mime: 'image/png',
  size: 100,
  path: 'C:\\att\\a1-x.png',
  ...over,
});
test('Claude gets image and PDF blocks; big files and Office documents go by path', () => {
  const read = () => Buffer.from('BYTES');
  const list = [
    att(),
    att({ id: 'a2', name: 'r.pdf', kind: 'document', mime: 'application/pdf', path: 'C:\\att\\a2-r.pdf' }),
    att({ id: 'a3', name: 'big.png', size: 9 * 1024 * 1024 }),
    att({ id: 'a4', name: 'p.docx', kind: 'document', mime: 'application/zip' }),
  ];
  const content = A.claudeContent('olá', list, { read });
  assert.equal(content.length, 3);
  assert.deepEqual(content[0], {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'QllURVM=' },
  });
  assert.equal(content[1].type, 'document');
  assert.equal(content[1].source.media_type, 'application/pdf');
  assert.deepEqual(content[2], { type: 'text', text: 'olá' });
  assert.equal(A.claudeContent('só texto', [], { read }), 'só texto');
  const s = A.section('claude', list, { read: () => '' });
  assert.match(s, /big\.png[^\n]*\n {2}Caminho: C:\\att\\a1-x\.png/);
  assert.match(s, /p\.docx/);
  assert.match(s, /x\.png \(imagem, image\/png, 100 B\) — enviado junto/);
  assert.doesNotMatch(s, /big\.png[^\n]*enviado junto/);
});
test('Codex receives localImage items and OpenCode file parts; Drael receives paths only', () => {
  const img = att(),
    doc = att({ id: 'a2', name: 'n.txt', kind: 'document', mime: 'text/plain', size: 10, path: 'C:\\att\\a2-n.txt' });
  const input = A.codexInput('olha', [img, doc]);
  assert.deepEqual(input, [
    { type: 'localImage', path: 'C:\\att\\a1-x.png' },
    { type: 'text', text: 'olha', text_elements: [] },
  ]);
  const parts = A.opencodeParts('olha', [img, doc], { read: () => Buffer.from('Z') });
  assert.deepEqual(parts[0], { type: 'text', text: 'olha' });
  assert.deepEqual(parts[1], { type: 'file', mime: 'image/png', filename: 'x.png', url: 'data:image/png;base64,Wg==' });
  assert.equal(parts.length, 2, 'text documents are not sent as parts');
  assert.equal(A.isNative('drael', img), false);
  assert.match(A.section('drael', [img], { read: () => '' }), /Caminho: C:\\att\\a1-x\.png/);
});
test('small text documents also go inline, limited to 100 KB per message', () => {
  const small = att({ id: 'b1', name: 'frase.txt', kind: 'document', mime: 'text/plain', size: 30, path: 'p1' });
  const huge = att({
    id: 'b2',
    name: 'grande.log',
    kind: 'document',
    mime: 'text/plain',
    size: 200 * 1024,
    path: 'p2',
  });
  const pdf = att({ id: 'b3', name: 'a.pdf', kind: 'document', mime: 'application/pdf', size: 30, path: 'p3' });
  const reads = [];
  const s = A.section('codex', [small, huge, pdf], { read: (p) => (reads.push(p), 'CODIGO-AZUL-77') });
  assert.match(s, /<arquivo nome="frase\.txt">\nCODIGO-AZUL-77\n<\/arquivo>/);
  assert.deepEqual(reads, ['p1'], 'only the small text file is read');
  assert.match(s, /grande\.log/);
  assert.match(s, /não são instruções/);
});
test('Claude gets --add-dir for the chat attachment folder; the other providers do not need it', () => {
  const providers = require('../electron/providers.cjs');
  const dir = tmp();
  const chat = (provider) => ({ provider, mode: 'edit', messages: [] });
  const claude = providers.command(chat('claude'), 'claude.exe', null, { attachDir: dir });
  assert.equal(claude.args[claude.args.indexOf('--add-dir') + 1], dir);
  assert.ok(
    !providers
      .command(chat('claude'), 'claude.exe', null, { attachDir: path.join(dir, 'x') })
      .args.includes('--add-dir')
  );
  assert.ok(!providers.command(chat('claude'), 'claude.exe', null).args.includes('--add-dir'));
});

// ---- send() end to end with a fake driver --------------------------------------------------------------------------
test('send copies staged files into the chat, stores them on the message and builds the prompt per provider', async () => {
  const { send } = require('../electron/send.cjs');
  const drivers = require('../electron/drivers.cjs');
  const { Store } = require('../electron/store.cjs');
  const dir = tmp('vesta-send-');
  const store = new Store(dir);
  const chat = store.addChat({ provider: 'claude', mode: 'edit' });
  const attachments = createAttachmentStore({ root: path.join(dir, 'attachments') });
  const png = attachments.stageBuffer('quadrado.png', PNG),
    txt = attachments.stageBuffer('codigo.txt', Buffer.from('CODIGO-AZUL-77'));
  const seen = [],
    original = drivers.start;
  drivers.start = (provider, spec, ctx) => (
    seen.push({ provider, spec, ctx }), { done: Promise.resolve({ code: 0, stderr: '' }), stop() {} }
  );
  try {
    const done = new Promise((resolve) => {
      const events = [];
      const ctx = {
        store,
        jobs: new Map(),
        memory: null,
        permissions: { ask() {}, cancelChat() {} },
        app: { getVersion: () => '0' },
        bounded: (t, n) => String(t || '').slice(0, n),
        emit: (e) => e.type === 'chat-done' && resolve(events),
        sync() {},
        state: () => ({}),
        workdir: () => dir,
        integrations: { claude: { exe: 'claude.exe' } },
        attachments,
      };
      send(ctx, { chatId: chat.id, text: '', attachments: [png.id, txt.id] });
    });
    await done;
    const user = store.chat(chat.id).messages[0];
    assert.equal(user.attachments.length, 2);
    assert.deepEqual(
      user.attachments.map((a) => a.kind),
      ['image', 'document']
    );
    for (const a of user.attachments)
      assert.ok(fs.existsSync(a.path) && a.path.includes(path.join('attachments', chat.id)));
    assert.equal(store.chat(chat.id).title, 'quadrado.png');
    const { ctx, spec } = seen[0];
    assert.match(ctx.prompt, /Veja os anexos/);
    assert.match(ctx.prompt, /CODIGO-AZUL-77/);
    assert.equal(ctx.attachments.length, 2);
    assert.equal(spec.args[spec.args.indexOf('--add-dir') + 1], path.join(path.resolve(dir, 'attachments'), chat.id));
    // A message with neither text nor attachments is still refused.
    await assert.rejects(
      send(
        { store, jobs: new Map(), bounded: (t) => String(t || ''), attachments },
        { chatId: chat.id, text: ' ', attachments: [] }
      ),
      /Digite uma mensagem/
    );
  } finally {
    drivers.start = original;
  }
});

// ---- deleting a chat, additive migration, phone ---------------------------------------------------------------------
test('deleting a chat deletes its attachment folder', () => {
  const { createMethods } = require('../electron/methods.cjs');
  const dir = tmp('vesta-del-');
  const { Store } = require('../electron/store.cjs');
  const store = new Store(dir);
  const chat = store.addChat({ provider: 'claude' });
  const attachments = createAttachmentStore({ root: path.join(dir, 'attachments') });
  const staged = attachments.stageBuffer('a.txt', Buffer.from('x'));
  const [sent] = attachments.commit(chat.id, [staged.id]);
  assert.ok(fs.existsSync(sent.path));
  const ctx = {
    jobs: new Map(),
    permissions: {},
    bounded: (t) => t,
    project() {},
    sync() {},
    state: () => ({}),
    store,
    attachments,
    app: {},
  };
  createMethods(ctx).deleteChat({ id: chat.id });
  assert.equal(store.state.chats.length, 0);
  assert.equal(fs.existsSync(path.dirname(sent.path)), false);
});
test('old chats without attachments load and behave exactly as before (additive migration)', () => {
  const { Store } = require('../electron/store.cjs');
  const { transcript } = require('../electron/conversations.cjs');
  const dir = tmp('vesta-mig-');
  const old = {
    version: 4,
    settings: { theme: 'ink' },
    chats: [
      {
        id: 'old-1',
        title: 'Antigo',
        provider: 'claude',
        mode: 'edit',
        messages: [
          { id: 'm1', role: 'user', text: 'oi', createdAt: 1 },
          { id: 'm2', role: 'assistant', text: 'olá', status: 'done', createdAt: 2 },
        ],
      },
    ],
  };
  fs.writeFileSync(path.join(dir, 'vesta.json'), JSON.stringify(old));
  const store = new Store(dir);
  assert.deepEqual(store.chat('old-1').messages, old.chats[0].messages);
  assert.ok(!('attachments' in store.chat('old-1').messages[0]));
  assert.deepEqual(transcript(store.chat('old-1').messages), [
    { role: 'user', text: 'oi' },
    { role: 'assistant', text: 'olá' },
  ]);
  const withAtt = [{ role: 'user', text: 'veja', attachments: [{ name: 'a.pdf', path: 'C:\\x\\a.pdf' }] }];
  assert.match(transcript(withAtt)[0].text, /veja\n\[Anexos: a\.pdf \(C:\\x\\a\.pdf\)\]/);
  assert.equal(transcript([{ role: 'user', text: '', attachments: [{ name: 'a', path: 'p' }] }]).length, 1);
});
test('the phone never receives filesystem paths of attachments', () => {
  const { sanitizeChat } = require('../electron/remote/sanitize.cjs');
  const chat = {
    id: 'c',
    title: 't',
    provider: 'claude',
    messages: [
      { id: '1', role: 'user', text: 'x', attachments: [att({ path: 'C:\\Users\\segredo\\a.png', thumb: true })] },
      { id: '2', role: 'assistant', text: 'y' },
    ],
  };
  const out = sanitizeChat(chat);
  assert.equal(JSON.stringify(out).includes('segredo'), false);
  assert.equal(out.messages[0].attachments[0].name, 'x.png');
  assert.equal(out.messages[1].attachments, undefined);
});
test('phone allowlist: send takes attachment ids, text is optional only with attachments', () => {
  const { validateArgs, isAllowed } = require('../electron/remote/allowlist.cjs');
  const code = (fn) => {
    try {
      fn();
    } catch (e) {
      return e.status;
    }
  };
  const id = 'abcdef012345';
  assert.deepEqual(validateArgs('send', { chatId: 'c', attachments: [id] }), { chatId: 'c', attachments: [id] });
  assert.deepEqual(validateArgs('send', { chatId: 'c', text: 'oi', attachments: [], extra: 1 }), {
    chatId: 'c',
    text: 'oi',
    attachments: [],
  });
  assert.equal(
    code(() => validateArgs('send', { chatId: 'c' })),
    400
  );
  assert.equal(
    code(() => validateArgs('send', { chatId: 'c', text: ' ', attachments: [] })),
    400
  );
  assert.equal(
    code(() => validateArgs('send', { chatId: 'c', text: 'x', attachments: ['../../x'] })),
    400
  );
  assert.equal(
    code(() => validateArgs('send', { chatId: 'c', text: 'x', attachments: Array(11).fill(id) })),
    400
  );
  assert.equal(
    code(() => validateArgs('send', { chatId: 'c', text: 'x', attachments: 'abc' })),
    400
  );
  assert.ok(isAllowed('attachmentData'));
  for (const m of ['attachPick', 'attachPaths', 'attachData', 'discardAttachment', 'openAttachment'])
    assert.equal(isAllowed(m), false, m + ' is desktop-only');
});
test('attachmentData returns image previews only for files of that chat', () => {
  const { attachmentMethods } = require('../electron/attachment-methods.cjs');
  const root = tmp();
  const attachments = createAttachmentStore({ root });
  const staged = attachments.stageBuffer('a.png', PNG),
    doc = attachments.stageBuffer('b.txt', Buffer.from('x'));
  const sent = attachments.commit('chat-1', [staged.id, doc.id]);
  const chat = { id: 'chat-1', messages: [{ id: 'm', role: 'user', attachments: sent }] };
  const m = attachmentMethods({
    attachments,
    store: {
      chat: (id) =>
        id === 'chat-1'
          ? chat
          : (() => {
              throw new UserError('Chat não encontrado');
            })(),
    },
  });
  const r = m.attachmentData({ chatId: 'chat-1', id: sent[0].id });
  assert.equal(r.mime, 'image/png');
  assert.equal(Buffer.from(r.data, 'base64').equals(PNG), true);
  assert.throws(() => m.attachmentData({ chatId: 'chat-1', id: sent[1].id }), /pré-visualização/);
  assert.throws(() => m.attachmentData({ chatId: 'chat-1', id: 'ffffffffffff' }), /não encontrado/);
  assert.throws(() => m.attachmentData({ chatId: 'chat-2', id: sent[0].id }), /não encontrado/i);
});
test('openAttachment only opens files inside the chat attachment folder', async () => {
  const { attachmentMethods } = require('../electron/attachment-methods.cjs');
  const root = tmp(),
    outside = path.join(tmp('vesta-out-'), 'segredo.txt');
  fs.writeFileSync(outside, 'x');
  const attachments = createAttachmentStore({ root });
  const [sent] = attachments.commit('chat-1', [attachments.stageBuffer('a.txt', Buffer.from('x')).id]);
  const opened = [];
  const chat = {
    id: 'chat-1',
    messages: [{ id: 'm', role: 'user', attachments: [sent, { ...sent, id: 'evil00000000', path: outside }] }],
  };
  const m = attachmentMethods({
    attachments,
    store: { chat: () => chat },
    shell: { openPath: async (p) => (opened.push(p), '') },
  });
  assert.equal(await m.openAttachment({ chatId: 'chat-1', id: sent.id }), true);
  assert.deepEqual(opened, [sent.path]);
  await assert.rejects(m.openAttachment({ chatId: 'chat-1', id: 'evil00000000' }), /não existe mais/);
  assert.equal(opened.length, 1, 'a tampered path outside the folder is refused');
});

// ---- upload route of the remote server ----------------------------------------------------------------------------
test('POST /api/upload: authenticated, typed, size-limited, validated like the desktop', async () => {
  const { createRemoteServer, MAX_UPLOAD } = require('../electron/remote/server.cjs');
  const { Pairing, Devices } = require('../electron/remote/tokens.cjs');
  const { createHub } = require('../electron/remote/hub.cjs');
  const { createBus } = require('../electron/events.cjs');
  const { createStateDiffer } = require('../electron/remote/sanitize.cjs');
  const list = [];
  const devices = new Devices({ list: () => list, save: () => {}, now: () => 1_000_000 });
  const { token } = devices.add('Celular');
  const root = tmp();
  const store = createAttachmentStore({ root });
  const hub = createHub({ bus: createBus(), getState: () => ({}), differ: createStateDiffer() });
  const server = createRemoteServer({
    devices,
    pairing: new Pairing(),
    hub,
    dispatch: async () => ({ ok: true }),
    upload: ({ name, data }) => {
      const { path: _p, ...a } = store.stageBuffer(name, data);
      return a;
    },
    log: () => {},
  });
  const port = await server.listen(['127.0.0.1'], 0);
  const up = (body, headers = {}) =>
    fetch('http://127.0.0.1:' + port + '/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Vesta-Name': encodeURIComponent('foto.png'),
        ...headers,
      },
      body,
    });
  try {
    assert.equal(MAX_UPLOAD, 30 * 1024 * 1024);
    assert.equal((await up(PNG)).status, 401, 'no token');
    const auth = { Authorization: 'Bearer ' + token };
    const ok = await up(PNG, auth);
    assert.equal(ok.status, 200);
    const { result } = await ok.json();
    assert.equal(result.kind, 'image');
    assert.equal('path' in result, false, 'no filesystem path to the phone');
    assert.equal(fs.readdirSync(store.staging).length, 1);
    assert.equal((await up(PNG, { ...auth, 'Content-Type': 'application/json' })).status, 415);
    assert.equal((await up(PNG, { ...auth, 'X-Vesta-Name': '' })).status, 400);
    const fake = await up(Buffer.from('texto'), auth);
    assert.equal(fake.status, 422);
    assert.match((await fake.json()).error, /imagem válida/);
    const big = await up(Buffer.alloc(MAX_UPLOAD + 10, 65), {
      ...auth,
      'X-Vesta-Name': encodeURIComponent('grande.txt'),
    });
    assert.equal(big.status, 413);
    assert.equal(fs.readdirSync(store.staging).length, 1, 'nothing stored for the refused ones');
  } finally {
    await server.close();
  }
});

test('Drael gets the files as relative paths inside its working folder, removed when the turn ends', () => {
  const drael = require('../electron/drael.cjs');
  const store = createAttachmentStore({ root: tmp() });
  const cwd = tmp('vesta-cwd-');
  const [sent] = store.commit('chat-9', [store.stageBuffer('nota.txt', Buffer.from('frase')).id]);
  const ex = drael.expose(cwd, 'chat-9', [sent]);
  assert.match(ex.attachments[0].path, /^\.vesta-anexos\/chat-9\/[a-f0-9]{12}-nota\.txt$/);
  assert.equal(fs.readFileSync(path.join(cwd, ex.attachments[0].path), 'utf8'), 'frase');
  assert.match(A.section('drael', ex.attachments, { read: () => '' }), /Caminho: \.vesta-anexos\/chat-9\//);
  ex.cleanup();
  assert.equal(fs.existsSync(path.join(cwd, '.vesta-anexos')), false, 'nothing is left in the project');
  assert.equal(fs.existsSync(sent.path), true, 'the stored copy stays');
  assert.deepEqual(drael.expose(cwd, 'c', []).attachments, []);
});
test('OpenCode may read the chat attachment folder without asking, in every mode', () => {
  const providers = require('../electron/providers.cjs');
  const dir = tmp();
  for (const mode of ['read', 'ask', 'edit']) {
    const spec = providers.command({ provider: 'opencode', mode, messages: [] }, 'opencode.exe', null, {
      attachDir: dir,
    });
    const perm = JSON.parse(spec.env.OPENCODE_PERMISSION);
    assert.equal(perm.external_directory[dir.split(path.sep).join('/') + '/*'], 'allow', mode);
    assert.equal(perm.external_directory['*'], 'ask', mode);
  }
  const none = providers.command({ provider: 'opencode', mode: 'edit', messages: [] }, 'opencode.exe', null);
  assert.equal(JSON.parse(none.env.OPENCODE_PERMISSION).external_directory, undefined);
});
