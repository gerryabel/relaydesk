/**
 * Preload for vitest in the hermes sandbox.
 *
 * The sandbox blocks spawning cmd.exe, which vite's Windows path optimization
 * needs (it runs `exec("net use", ...)` to map network drives). Without this
 * preload, vite throws `spawn EPERM` while loading its config and no tests run.
 *
 * This replaces child_process.exec so that when spawn fails (EPERM), the
 * error is delivered through the callback and no 'error' event is emitted.
 * Vite handles `if (error) return;` for the `net use` call, so this is safe.
 */
const cp = require('child_process');
const { EventEmitter } = require('events');

const originalExec = cp.exec;

cp.exec = function (command, options, callback) {
  // Normalize arguments: exec(cmd), exec(cmd, cb), exec(cmd, opts, cb).
  let opts = options;
  let cb = callback;
  if (typeof options === 'function') {
    cb = options;
    opts = undefined;
  }
  if (typeof cb !== 'function') {
    cb = () => {};
  }

  // Try the real exec. If it throws synchronously (e.g. EPERM in a sandbox),
  // deliver the error through the callback and return a inert dummy process.
  let child;
  try {
    child = originalExec.call(this, command, opts);
  } catch (error) {
    setImmediate(() => cb(error, '', ''));
    return inertProcess();
  }

  // If spawn fails asynchronously, route the error to the callback and
  // suppress the default unhandled-error throw.
  child.on('error', (err) => {
    cb(err, '', '');
  });

  return child;
};

function inertProcess() {
  const ee = new EventEmitter();
  return {
    stdin: { destroy: () => {}, end: () => {}, write: () => {} },
    stdout: ee,
    stderr: ee,
    pid: -1,
    kill: () => {},
    unref: () => {},
    on: () => {},
    once: () => {},
    removeAllListeners: () => {},
  };
}
