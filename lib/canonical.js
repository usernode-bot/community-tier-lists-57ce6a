// Heuristic canonicalization for item dedupe. The AI path (claude-haiku via
// the platform LLM proxy) layers on top of this in server.js; this heuristic
// is the always-available fallback and the stored canonical_key generator.
function canonicalKey(name) {
  const key = String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/#/g, ' sharp ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => !['the', 'a', 'an'].includes(w))
    .join('-');
  return key || String(name || '').toLowerCase().trim().replace(/\s+/g, '-') || 'item';
}

module.exports = { canonicalKey };
