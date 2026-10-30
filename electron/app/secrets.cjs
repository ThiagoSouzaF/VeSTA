// Small secrets kept on this computer (the Google Drive keys, the backup password): sealed by the OS keychain
// (DPAPI on Windows, through Electron's safeStorage) and written to files of their own, never to vesta.json and so
// never into a backup. Without a keychain nothing is kept: the feature asks again instead of storing plain text.
const fs = require('node:fs');
const { UserError } = require('./errors.cjs');
const { writeAtomic } = require('../util/sys.cjs');

const PREFIX = 'dpapi:';

// storage: Electron's safeStorage (or a stand-in with the same three methods in tests).
function createSecrets(storage) {
  const available = () => !!storage?.isEncryptionAvailable();
  return {
    available,
    seal(value) {
      if (!available()) throw new UserError('O sistema não ofereceu um cofre para guardar esta chave');
      return PREFIX + storage.encryptString(String(value)).toString('base64');
    },
    // '' for anything that is not a sealed value this computer can open.
    unseal(sealed) {
      if (typeof sealed !== 'string' || !sealed.startsWith(PREFIX) || !available()) return '';
      try {
        return storage.decryptString(Buffer.from(sealed.slice(PREFIX.length), 'base64'));
      } catch {
        return '';
      }
    },
  };
}

// One sealed value in its own file: { get(), set(value), clear(), has() }.
function sealedFile(file, secrets) {
  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')).sealed || '';
    } catch {
      return '';
    }
  };
  return {
    has: () => !!read(),
    get: () => secrets.unseal(read()),
    set: (value) => writeAtomic(file, JSON.stringify({ sealed: secrets.seal(value) })),
    clear: () => fs.rmSync(file, { force: true }),
  };
}

module.exports = { createSecrets, sealedFile };
