const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { isBanDisconnect, stopFile, createAccountStop } = require('./account-stop');

test('recognizes explicit English and Turkish ban disconnects and vanilla translations', () => {
  for (const reason of [
    'You are banned from this server!',
    '\u00a7cSunucudan Yasaklandın!',
    'Sunucudan yasaklandınız.',
    'Bu hesaba erişim yasaklanmıştır.',
    'Banlandiniz!',
    { translate: 'multiplayer.disconnect.banned_ip', with: ['reason'] },
    JSON.stringify({ text: 'You have been banned.' }),
    { type: 'compound', value: { extra: { type: 'list', value: { type: 'compound', value: [
      { text: { type: 'string', value: 'Sunucudan ' } },
      { text: { type: 'string', value: 'Yasaklandın!' } }
    ] } } } }
  ]) assert.equal(isBanDisconnect(reason), true);
});

test('does not turn captcha, cooldown, timeout or ordinary errors into permanent stops', () => {
  for (const reason of [
    'Captcha kontrolünde başarısız oldunuz.',
    'Tekrar kullanmadan önce lütfen bekleyin!',
    'You are logging in too fast, try again later.',
    'Timed out',
    'You are not banned.',
    { text: 'Disconnected', color: 'red' },
    '{invalid json', null, undefined
  ]) assert.equal(isBanDisconnect(reason), false);
});

test('stop persists across processes and username casing without retaining account details', t => {
  const parent = process.env.ACCOUNT_STOP_TEST_TEMP;
  assert.ok(parent, 'Set ACCOUNT_STOP_TEST_TEMP to an existing temporary directory');
  const root = fs.mkdtempSync(path.join(parent, 'account-stop-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const guard = createAccountStop(root, 'example.invalid', 25565, 'TestAccount');
  assert.equal(guard.isStopped(), false);
  guard.stop();
  guard.stop();
  assert.equal(guard.isStopped(), true);
  assert.equal(createAccountStop(root, 'EXAMPLE.INVALID', 25565, 'testaccount').isStopped(), true);
  assert.equal(createAccountStop(root, 'another.invalid', 25565, 'TestAccount').isStopped(), false);
  assert.equal(createAccountStop(root, 'example.invalid', 25566, 'TestAccount').isStopped(), false);
  assert.equal(createAccountStop(root, 'example.invalid', 25565, 'OtherAccount').isStopped(), false);
  const file = stopFile(root, 'example.invalid', 25565, 'TestAccount');
  assert.match(path.basename(file), /^[a-f0-9]{64}\.json$/);
  const contents = fs.readFileSync(file, 'utf8');
  assert.deepEqual(Object.keys(JSON.parse(contents)).sort(), ['at', 'reason']);
  assert.equal(/testaccount|example\.invalid|25565/i.test(file + contents), false);
});

function simulateBot(initiallyStopped = false) {
  const stoppedExit = new Error('simulated process exit');
  const state = { stopped: initiallyStopped, starts: 0, timers: new Set(), client: null };
  const fakeFs = {
    existsSync: () => false,
    readFileSync: () => '127.0.0.1:1080',
    writeFileSync: () => {},
    appendFileSync: () => {}
  };
  const mocks = {
    fs: fakeFs,
    mineflayer: { createBot: () => {
      state.starts++;
      state.client = new EventEmitter();
      state.client._client = new EventEmitter();
      state.client.quit = () => {};
      return state.client;
    } },
    socks: {},
    './captcha-learner.js': {},
    './account-stop': {
      isBanDisconnect,
      createAccountStop: () => ({ isStopped: () => state.stopped, stop: () => { state.stopped = true; } })
    }
  };
  const context = {
    __dirname,
    Buffer,
    console: { log: () => {} },
    require: name => Object.prototype.hasOwnProperty.call(mocks, name) ? mocks[name] : require(name),
    process: { argv: ['node', 'bot.js', 'TestAccount'], env: {}, on: () => {}, exit: () => { throw stoppedExit; } },
    setInterval: () => {},
    setTimeout: callback => { state.timers.add(callback); return callback; },
    clearTimeout: timer => { state.timers.delete(timer); }
  };
  const source = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
  if (initiallyStopped) assert.throws(() => vm.runInNewContext(source, context), error => error === stoppedExit);
  else vm.runInNewContext(source, context);
  return { state, stoppedExit };
}

test('a previously stopped account exits before creating a network client', () => {
  const { state } = simulateBot(true);
  assert.equal(state.starts, 0);
  assert.equal(state.timers.size, 0);
});

test('a ban cancels pending reconnects and a subsequent end event cannot restart the account', () => {
  const { state, stoppedExit } = simulateBot();
  state.client.emit('end', 'socketClosed');
  assert.equal(state.timers.size, 1);
  assert.throws(() => state.client.emit('kicked', { text: 'Sunucudan Yasaklandın!' }), error => error === stoppedExit);
  assert.equal(state.stopped, true);
  assert.equal(state.timers.size, 0);
  state.client.emit('end', 'socketClosed');
  assert.equal(state.timers.size, 0);
  assert.equal(state.starts, 1);
});
