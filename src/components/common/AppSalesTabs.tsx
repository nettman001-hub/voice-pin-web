import React from 'react';
export function AppSalesTabs({ selling = true }: { selling?: boolean }) {
  const select = (tab: string) => window.dispatchEvent(new CustomEvent('voicecap-android', {
    detail: { type: 'app-tab-change', tab },
  }));
  return <>
    <button type="button" aria-current={selling ? 'page' : undefined} onClick={() => select('sell')}>판매</button>
    <button type="button" aria-current={!selling ? 'page' : undefined} onClick={() => select('manage')}>관리</button>
  </>;
}
