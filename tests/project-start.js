(() => {
  const base = new URL('../', location.href);
  globalThis.browser = {
    runtime: {getURL: path => new URL(path, base).href, onMessage: {addListener() {}}},
    storage: {local: {async get(key) { return key.startsWith('dgp-session:') ? {[key]: {enabled: true}} : {}; }, async set() {}}}
  };
  document.getElementById('create-chat').addEventListener('click', () => {
    document.getElementById('composer-form').hidden = false;
  });
})();
