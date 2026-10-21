import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSales } from './SalesContext';
import { useCommerce } from './CommerceContext';
import { useLive } from './LiveContext';
import { useProductSales } from './ProductSalesContext';
import { useRuntimeAuth } from './WorkspaceRuntimeContext';
import { isSupabaseConfigured, requireSupabase } from '../services/supabaseClient';
import { CustomerStatsIndex } from '../services/customerStatsIndex';
import type { Buyer } from '../types/productSales';

const Context = createContext<CustomerStatsIndex | null>(null);
export const useCustomerStatsIndex = () => useContext(Context);
export const CustomerStatsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { workspaceId, isRemoteAuth } = useRuntimeAuth();
  const { sales, promiseDefaults } = useSales();
  const { invoices, shipments, isPaid } = useCommerce();
  const { currentSessionId } = useLive();
  const { activeSession } = useProductSales();
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const index = useRef(new CustomerStatsIndex());
  const owner = useRef(workspaceId);
  if (owner.current !== workspaceId) { owner.current = workspaceId; index.current = new CustomerStatsIndex(); }
  useEffect(() => {
    let active = true; setBuyers([]);
    if (!workspaceId || !isRemoteAuth || !isSupabaseConfigured) return;
    const load = async () => {
      const all: Buyer[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await requireSupabase().from('buyers').select('*').eq('workspace_id', workspaceId)
          .order('id').range(offset, offset + 999);
        if (error) throw error;
        all.push(...(data || []).map(b => ({ id: b.id, platform: b.platform, platformUserId: b.platform_user_id,
          platformUniqueId: b.platform_unique_id, displayNickname: b.display_nickname, identityStatus: b.identity_status })));
        if (!data || data.length < 1000) break;
      }
      if (active) setBuyers(all);
    };
    void load().catch(e => console.warn('[CustomerStats] 구매자 목록 갱신 실패', e));
    const channel = requireSupabase().channel(`buyer-stats:${workspaceId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'buyers', filter: `workspace_id=eq.${workspaceId}` }, () => void load().catch(() => {})).subscribe();
    return () => { active = false; void requireSupabase().removeChannel(channel); };
  }, [workspaceId, isRemoteAuth, activeSession?.id]);
  const value = useMemo(() => {
    index.current.reconcile({ sales, buyers, promiseDefaults, invoices, shipments, isPaid,
      currentSessionId, activeSessionId: activeSession?.id });
    // New identity notifies consumers, while the per-buyer memo stays in the table.
    return Object.create(index.current) as CustomerStatsIndex;
  }, [sales, buyers, promiseDefaults, invoices, shipments, isPaid, currentSessionId, activeSession?.id, workspaceId]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
};
