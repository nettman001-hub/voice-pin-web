import React from 'react';
import { useParams } from 'react-router-dom';
import { ManageOrdersPage } from './ManageOrdersPage';
import { OrderDetailPage } from './OrderDetailPage';

/**
 * 주문 화면 묶음. 폰에서는 목록 또는 상세 한 장, PC(넓은 화면)에서는 목록 + 상세 2단.
 */
export const OrdersWorkspace: React.FC = () => {
  const { orderKey } = useParams();
  return (
    <div className="mx-auto lg:grid lg:max-w-7xl lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start lg:gap-2">
      <div className={orderKey ? 'hidden lg:block' : ''}>
        <ManageOrdersPage />
      </div>
      {orderKey ? (
        <div className="lg:sticky lg:top-2">
          <OrderDetailPage />
        </div>
      ) : (
        <div className="hidden p-3 lg:block">
          <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">왼쪽에서 주문을 고르면 여기에 자세히 보입니다.</p>
        </div>
      )}
    </div>
  );
};

export default OrdersWorkspace;
