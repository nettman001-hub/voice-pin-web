import React from 'react';
import SellerLogicAnalysisPage from './SellerLogicAnalysisPage';
import SellerLogicReceiptPanel from '../../components/seller/SellerLogicReceiptPanel';

export default function SellerLogicAnalysis01CodexPage() {
  return <SellerLogicAnalysisPage title="판매자 로직분석01codex" purchaseOnlyHints
    renderSalesTools={(context) => <SellerLogicReceiptPanel key={context.sessionId} {...context} />} />;
}
