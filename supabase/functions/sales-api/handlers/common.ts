import { admin } from '../../_shared/productSales.ts'

export async function getWorkspaceSettings(workspaceId: string) {
  const { data } = await admin
    .from('workspace_settings')
    .select('value, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('namespace', 'product_sales')
    .maybeSingle()

  const defaultSettings = {
    revision: 1,
    productRegistrationEnabled: true,
    captureProductImageEnabled: true,
    productNameInputEnabled: true,
    voicePreviewMs: 2500,
    voiceCommands: {
      registerProduct: ['상품등록'],
      captureProduct: ['상품캡처'],
      setProductName: ['상품번호', '상품명'],
      setPrice: ['금액', '가격'],
      confirmSale: ['판매완료', '구매확정'],
      setBuyer: ['닉네임'],
    },
  }

  return data?.value ? { ...defaultSettings, ...data.value } : defaultSettings
}

export async function calculateSummary(workspaceId: string, sessionId: string) {
  const { data: sales, error } = await admin
    .from('sales')
    .select('quantity, amount')
    .eq('workspace_id', workspaceId)
    .eq('session_id', sessionId)
    .eq('record_state', 'ACTIVE')

  let sessionQuantity = 0
  let sessionAmount = 0
  if (!error && sales) {
    for (const s of sales) {
      sessionQuantity += Number(s.quantity || 1)
      sessionAmount += Number(s.amount || 0)
    }
  }
  return { sessionQuantity, sessionAmount }
}

export async function calculateBuyerStats(workspaceId: string, sessionId: string, buyerIds: string[]) {
  const statsMap: Record<string, any> = {}
  if (!buyerIds.length) return statsMap

  const { data: buyers } = await admin
    .from('buyers')
    .select('id, display_nickname')
    .eq('workspace_id', workspaceId)
    .in('id', buyerIds)

  const buyerNameMap = new Map<string, string>()
  buyers?.forEach((b) => buyerNameMap.set(b.id, b.display_nickname))

  const { data: sessionSales } = await admin
    .from('sales')
    .select('buyer_id, quantity, amount')
    .eq('workspace_id', workspaceId)
    .eq('session_id', sessionId)
    .eq('record_state', 'ACTIVE')
    .in('buyer_id', buyerIds)

  const { data: allSales } = await admin
    .from('sales')
    .select('buyer_id, amount')
    .eq('workspace_id', workspaceId)
    .eq('record_state', 'ACTIVE')
    .in('buyer_id', buyerIds)

  for (const bId of buyerIds) {
    const nickname = buyerNameMap.get(bId) || ''
    let sessionQuantity = 0
    let sessionAmount = 0
    sessionSales
      ?.filter((s) => s.buyer_id === bId)
      .forEach((s) => {
        sessionQuantity += Number(s.quantity || 1)
        sessionAmount += Number(s.amount || 0)
      })

    const buyerAllSales = allSales?.filter((s) => s.buyer_id === bId) || []
    const totalPurchaseCount = buyerAllSales.length
    let totalPurchaseAmount = 0
    buyerAllSales.forEach((s) => {
      totalPurchaseAmount += Number(s.amount || 0)
    })

    statsMap[bId] = {
      buyerId: bId,
      displayNickname: nickname,
      sessionQuantity,
      sessionAmount,
      totalPurchaseCount,
      totalPurchaseAmount,
    }
  }

  return statsMap
}
