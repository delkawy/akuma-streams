const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expires && entry.expires < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function set(key, value, ttlMs) {
  const expires = ttlMs ? Date.now() + ttlMs : 0;
  store.set(key, { value, expires });
}

function del(key) {
  store.delete(key);
}

function clear() {
  store.clear();
}

export default { get, set, del, clear };
export { get, set, del, clear };
