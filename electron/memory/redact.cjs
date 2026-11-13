// Removes secrets from text before it is stored or sent anywhere. No dependencies: light modules import it freely.
const redact = (text) =>
  String(text)
    .replace(/\b(?:sk-|dk-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/g, '[chave removida]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[chave removida]')
    .replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '[token removido]')
    .replace(/(?:AKIA|ASIA)[0-9A-Z]{16}/g, '[chave removida]')
    .replace(/(Bearer\s+)[\w.~+/-]{12,}=*/gi, '$1[removido]')
    .replace(
      /((?:api[_-]?key|authorization|password|passwd|senha|token|secret|client[_-]?secret)\s*[:=]\s*)[^\s,;]+/gi,
      '$1[removido]'
    );
module.exports = { redact };
