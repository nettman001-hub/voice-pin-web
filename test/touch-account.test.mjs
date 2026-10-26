import test from "node:test";
import assert from "node:assert/strict";
import { touchLogoutWarning } from "../src/services/touchAccount.ts";

test("logout warning counts unsent sales and always says how to resume", () => {
  assert.match(touchLogoutWarning(3), /보내는 중인 판매 3건/);
  assert.match(touchLogoutWarning(3), /다시 로그인하면/);
  assert.match(touchLogoutWarning(0), /저장할 수 없습니다/);
  assert.doesNotMatch(touchLogoutWarning(0), /건은/);
});
