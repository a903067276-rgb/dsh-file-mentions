/**
 * dsh-file-mentions — client bundle tests (node:test, zero dependencies).
 *
 * Regression: the bare-path highlighter must NOT touch text nodes inside the
 * React-managed composer/input mirror. Injecting <span data-fm-inline> there
 * makes React throw `NotFoundError: removeChild` when the user types a command
 * such as `/plan` and presses space, which unmounts the composer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load(module) {
      captured = module;
    },
  },
};

const loaded = await (async () => {
  const mod = await import('../lib/client.js');
  assert.ok(captured !== null, 'client.js must register via window.__ModuleLoader__.load');
  const result = captured.factory((id) => {
    if (id === 'react') return {};
    throw new Error('unexpected require: ' + id);
  });
  assert.ok(result && typeof result.apply === 'function', 'factory must return { apply }');
  assert.ok(result.internals, 'factory must return internals for tests');
  return result;
})();

const { internals } = loaded;

function fakeParent(matches) {
  return {
    closest(selector) {
      const normalized = selector.replace(/'/g, '"');
      return matches.some((m) => normalized.includes(m.replace(/'/g, '"'))) ? {} : null;
    },
  };
}

test('internals exposes shouldSkipPathNode', () => {
  assert.equal(typeof internals.shouldSkipPathNode, 'function');
});

test('shouldSkipPathNode: skips composer/input text nodes', () => {
  const cases = [
    'textarea',
    'input',
    '[contenteditable]',
    '[data-input-mirror]',
    '[data-input-backdrop]',
    '[data-composer-card]',
    '[class$="_input"]',
    '[data-conversation-scroll]',
  ];
  for (const selector of cases) {
    assert.equal(
      internals.shouldSkipPathNode(fakeParent([selector])),
      true,
      `must skip text nodes inside ${selector}`,
    );
  }
});

test('shouldSkipPathNode: allows normal message body text nodes', () => {
  assert.equal(internals.shouldSkipPathNode(fakeParent(['[class$="_body"]'])), false);
});

test('shouldSkipPathNode: skips when there is no parent element', () => {
  assert.equal(internals.shouldSkipPathNode(null), true);
});
