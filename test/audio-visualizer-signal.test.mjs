import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function render(waveform, audioLevel, isActive = true) {
  const effects = [], frames = [], lines = [], bars = [];
  const context = { clearRect() {}, setLineDash() {}, beginPath() {}, stroke() {},
    moveTo: (x, y) => lines.push([x, y]), lineTo: (x, y) => lines.push([x, y]),
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect: (...values) => bars.push(values) };
  const canvas = { width: 400, height: 28, getContext: () => context };
  const react = {
    useRef: (value) => ({ current: value }),
    useEffect: (effect) => effects.push(effect),
    createElement(type, props, ...children) { if (type === 'canvas') props.ref.current = canvas; return { type, props, children }; },
  };
  const source = fs.readFileSync(new URL('../src/components/common/AudioVisualizer.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports,
    require: () => ({ ...react, default: react }),
    requestAnimationFrame: (callback) => frames.push(callback), cancelAnimationFrame() {},
  });
  exports.AudioVisualizer({ waveform, audioLevel, isActive });
  effects.forEach((effect) => effect());
  frames.shift()();
  const first = [...lines]; lines.length = 0;
  frames.shift()();
  return { bars, first, second: lines };
}

test('active listening with no signal draws a stationary line, not a fabricated moving waveform', () => {
  const ctx = render(new Uint8Array(128), 0);
  assert.equal(ctx.bars.length, 0);
  assert.deepEqual(ctx.first, [[0, 14], [400, 14]]);
  assert.deepEqual(ctx.second, ctx.first);
});

test('actual frequency samples or audio level enable the visualizer while stopped listening stays flat', () => {
  assert.ok(render(new Uint8Array(128).fill(80), 0).bars.length > 0);
  assert.ok(render(new Uint8Array(128), 30).bars.length > 0);
  assert.equal(render(new Uint8Array(128).fill(80), 30, false).bars.length, 0);
});
