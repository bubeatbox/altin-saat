// Node 24 resolves an explicit directory argument through its index.js.
// Keep `node --test test/` runnable without changing the application's package.
Promise.all([import('./birim.test.mjs'), import('./kol-gurultu.test.mjs')]);
