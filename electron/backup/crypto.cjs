// Password protection of a backup: the whole .zip is encrypted with AES-256-GCM under a key derived from the
// password with scrypt. Without the password nothing inside can be read, and any change to the file is detected.
//   file = MAGIC (9 bytes) | salt (16) | iv (12) | auth tag (16) | ciphertext
// The password itself is never stored in the backup; on this computer it is kept sealed by the OS keychain.
const { randomBytes, scryptSync, createCipheriv, createDecipheriv } = require('node:crypto');
const { UserError } = require('../app/errors.cjs');

const MAGIC = Buffer.from('VESTAENC1');
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MIN_PASSWORD = 8;

const keyOf = (password, salt) => scryptSync(String(password).normalize('NFC'), salt, 32, SCRYPT);
const isEncrypted = (buf) => buf.length > MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD)
    throw new UserError('A senha do backup precisa de pelo menos ' + MIN_PASSWORD + ' caracteres');
  return password;
}
function encrypt(data, password) {
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(checkPassword(password), salt), iv);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}
function decrypt(buf, password) {
  if (!password) throw Object.assign(new UserError('Este backup está protegido por senha'), { code: 'needs-password' });
  const at = MAGIC.length;
  const salt = buf.subarray(at, at + 16),
    iv = buf.subarray(at + 16, at + 28),
    tag = buf.subarray(at + 28, at + 44);
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyOf(password, salt), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buf.subarray(at + 44)), decipher.final()]);
  } catch {
    throw Object.assign(new UserError('Senha incorreta (ou o arquivo foi alterado)'), { code: 'wrong-password' });
  }
}

module.exports = { encrypt, decrypt, isEncrypted, checkPassword, MIN_PASSWORD, MAGIC };
