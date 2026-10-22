// Standalone production server bound to localhost by default.
process.env.HOST ??= '127.0.0.1';
process.env.PORT ??= '4321';

await import('../dist/server/entry.mjs');
