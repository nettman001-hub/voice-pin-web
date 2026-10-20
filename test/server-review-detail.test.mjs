import { runtimeFixture } from './runtime-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as serverRejectedSale from '../src/services/serverRejectedSale.ts';

const { markServerReviewCompleted, needsServerReview } = serverRejectedSale;
const nodes = (tree) => Array.isArray(tree) ? tree.flatMap(nodes)
  : tree == null || typeof tree === 'boolean' ? []
    : [tree, ...(typeof tree === 'object' ? nodes(tree.props?.children) : [])];
const visible = (tree) => nodes(tree).filter((node) => typeof node === 'string' || typeof node === 'number').join('');
const record = (extra = {}) => ({
  id: 'sale-review', sessionId: 'broadcast-2', buyerNickname: '꽃심이', amount: 10000,
  productName: '니트', status: '확정', recordState: 'ACTIVE', source: 'WEB_VOICE',
  recognizedAt: '2026-10-17T12:23:13Z', rawTranscript: '꽃심이님 만 원 드릴게요',
  revision: 2, syncStatus: 'SYNCED', printStatus: 'NOT_REQUESTED', printRevision: 1,
  note: '기존 메모 / [서버 확인 필요] 구매 댓글 연결 확인 (BUYER_AMBIGUOUS)',
  ...extra,
});

function fixture(initial = record(), options = {}) {
  let sale = initial, index = 0, changed = false;
  const cells = [], effects = [], completed = [], updated = [], prints = [], alerts = [];
  const react = {
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
    useState(initialValue) {
      const key = index++;
      if (!(key in cells)) cells[key] = typeof initialValue === 'function' ? initialValue() : initialValue;
      return [cells[key], (value) => {
        const next = typeof value === 'function' ? value(cells[key]) : value;
        if (!Object.is(next, cells[key])) { cells[key] = next; changed = true; }
      }];
    },
    useRef(initialValue) { const key = index++; return cells[key] ||= { current: initialValue }; },
    useEffect(effect, dependencies) {
      const key = index++, previous = cells[key];
      if (!previous || !dependencies || dependencies.some((value, i) => !Object.is(value, previous[i]))) {
        cells[key] = dependencies;
        effects.push(effect);
      }
    },
  };
  react.useLayoutEffect = react.useEffect;
  const empty = () => null;
  const imports = {
    react: { __esModule: true, default: react, ...react },
    'react-router-dom': { useParams: () => ({ id: initial.id }), useNavigate: () => () => {},
      useLocation: () => ({ search: '?session=broadcast-2', state: null }), Link: 'a' },
    'lucide-react': new Proxy({}, { get: () => empty }),
    '../../context/SalesContext': { useSales: () => ({
      sales: [sale],
      completeServerReview(id) {
        completed.push(id);
        if (options.failCompletion) return undefined;
        sale = { ...markServerReviewCompleted(sale), syncStatus: 'PENDING' };
        return sale;
      },
      updateSale(next) { updated.push(next); sale = next; return next; },
      retrySalePrint(id) { prints.push(id); },
      deleteSale() { throw new Error('Unexpected delete'); },
    }) },
    '../../services/serverRejectedSale': serverRejectedSale,
    '../../services/productSalesApi': { productSalesApi: { listSessions: async () => ({ sessions: [] }) } },
    '../../utils/sessionFormatter': { formatSessionDisplay: () => '10/17 라이브 2회차' },
    '../../components/sales/BuyerReconciliationPanel': { BuyerReconciliationPanel: empty },
    '../../components/sales/CustomerStatsBadge': { CustomerStatsBadge: empty },
    '../../components/sales/SaleAiActionButtons': { SaleAiActionButtons: empty },
    '../../components/sales/AiSaleBadge': { AiSaleBadge: empty },
    '../../components/common/ImageViewerModal': { ImageViewerModal: empty },
  };
  const source = fs.readFileSync(new URL('../src/pages/seller/SalesDetailPage.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React, esModuleInterop: true },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, console,
    require(name) { if (name.endsWith('WorkspaceRuntimeContext')) return runtimeFixture(imports);  assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; },
    alert: (message) => alerts.push(message), setTimeout: () => 1,
    window: { scrollTo() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {} },
    document: { scrollingElement: { scrollTop: 0 } },
  });
  const api = {
    completed, updated, prints, alerts,
    get sale() { return sale; },
    setSale(next) { sale = next; },
    render() {
      for (let attempt = 0; attempt < 10; attempt++) {
        changed = false; index = 0;
        const tree = module.exports.SalesDetailPage();
        while (effects.length) effects.shift()();
        if (!changed) return tree;
      }
      throw new Error('Unstable render');
    },
    button() { return nodes(this.render()).find((node) => node.type === 'button' && visible(node).includes('확인 완료 · 표시 해제')); },
    complete() {
      const button = this.button();
      assert.ok(button, 'Missing review completion action');
      assert.equal(button.props.type, 'button', 'Review completion must not submit form changes');
      return button.props.onClick();
    },
    field(kind) {
      const field = nodes(this.render()).find((node) => node.type === 'input'
        && (kind === 'amount' ? node.props.type === 'number' : node.props.placeholder === '특이사항 메모...'));
      assert.ok(field, `Missing ${kind} field`);
      return field;
    },
    edit(kind, value) { this.field(kind).props.onChange({ target: { value } }); },
    save() { nodes(this.render()).find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} }); },
  };
  return api;
}

for (const syncStatus of ['SYNCED', 'PENDING']) {
  test(`seller completes ${syncStatus} review from detail without ordinary edit or reprint`, () => {
    const f = fixture(record({ syncStatus }));
    assert.ok(visible(f.render()).includes('구매 댓글 연결 확인 (BUYER_AMBIGUOUS)'));
    f.complete();
    assert.deepEqual(f.completed, ['sale-review']);
    assert.equal(f.updated.length, 0);
    assert.equal(f.prints.length, 0);
    assert.equal(f.alerts.length, 0);
    assert.equal(f.button(), undefined);
    assert.equal(needsServerReview(f.sale), false);
    assert.match(f.field('note').props.value, /\[판매자 확인 완료\].*BUYER_AMBIGUOUS/);
    assert.equal(f.sale.amount, 10000);
    assert.equal(f.sale.status, '확정');
    assert.ok(visible(f.render()).includes('확인 필요 표시를 해제했습니다.'));
  });
}

test('completion preserves unsaved amount and memo edits without restoring the badge on later save', () => {
  const original = record();
  const f = fixture(original);
  f.edit('amount', '17000');
  f.edit('note', `${original.note} / 배송일 확인`);
  f.complete();
  assert.equal(f.updated.length, 0);
  assert.equal(f.sale.amount, 10000, 'Completing review must not save unfinished form edits');
  assert.equal(f.field('amount').props.value, '17000');
  const completedDraft = `${markServerReviewCompleted(original).note} / 배송일 확인`;
  assert.equal(f.field('note').props.value, completedDraft);
  f.setSale({ ...f.sale, syncStatus: 'SYNCED' });
  f.save();
  assert.equal(f.updated.length, 1);
  assert.equal(f.updated[0].amount, 17000);
  assert.equal(f.updated[0].note, completedDraft);
  assert.equal(needsServerReview(f.updated[0]), false);
  assert.equal(f.button(), undefined);
});

test('completion from another screen clears the marker while retaining a dirty local memo', () => {
  const original = record();
  const f = fixture(original);
  f.edit('note', `${original.note} / 수정 중 메모`);
  f.edit('amount', '19000');
  f.setSale(markServerReviewCompleted(original));
  assert.equal(f.button(), undefined);
  assert.equal(f.field('note').props.value, `${markServerReviewCompleted(original).note} / 수정 중 메모`);
  assert.equal(f.field('amount').props.value, '19000');
  f.save();
  assert.equal(needsServerReview(f.updated[0]), false);
  assert.match(f.updated[0].note, /수정 중 메모$/);
});

test('ordinary and already completed sales expose no review completion action', () => {
  for (const note of ['일반 메모', '[판매자 확인 완료] 구매 댓글 연결 확인 (BUYER_AMBIGUOUS)', undefined]) {
    const f = fixture(record({ note }));
    assert.equal(f.button(), undefined);
    assert.equal(f.completed.length, 0);
  }
});

test('failed completion leaves the review visible and does not discard draft edits', () => {
  const f = fixture(record(), { failCompletion: true });
  f.edit('note', '작성 중 메모');
  f.complete();
  assert.ok(f.button());
  assert.ok(visible(f.render()).includes('표시를 해제하지 못했습니다.'));
  assert.equal(f.field('note').props.value, '작성 중 메모');
  assert.equal(needsServerReview(f.sale), true);
  assert.equal(f.updated.length, 0);
  assert.equal(f.prints.length, 0);
});
