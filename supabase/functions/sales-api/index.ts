import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
  corsHeaders,
  authenticateRequest,
  errorResponse,
} from '../_shared/productSales.ts'

import {
  handleListDevices,
  handleUpdateDeviceCapabilities,
  handleSetOutputDevice,
} from './handlers/devices.ts'

import {
  handleGetBootstrap,
  handleUpdateSettings,
  handleStartSession,
  handleEndSession,
} from './handlers/sessions.ts'

import {
  handlePrepareProduct,
  handleUpdateProductDraft,
  handleCommitProduct,
  handleActivateProduct,
  handleListSessionProducts,
  handlePrepareProductImage,
  handlePreviewProductChange,
  handleCommitProductChange,
} from './handlers/products.ts'

import {
  handleIngestComments,
  handleGetSalesFeed,
  handleSearchBuyers,
  handleConfirmBuyer,
} from './handlers/comments.ts'

import {
  handleCommitSales,
  handleGetOperation,
  handleGetProductSales,
} from './handlers/sales.ts'

import {
  handleClaimPrintJobs,
  handleRenewPrintLease,
  handleBeginPrintJob,
  handleAcknowledgePrintJob,
  handleRequestReprint,
  handleGetPrintStatus,
} from './handlers/print.ts'

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    let body: any = {}
    try {
      body = await req.json()
    } catch {
      return errorResponse('VALIDATION_ERROR', '잘못된 JSON 형식입니다.', 400)
    }

    const { action } = body
    if (!action) {
      return errorResponse('VALIDATION_ERROR', 'action 필드가 누락되었습니다.', 400)
    }

    const auth = await authenticateRequest(req, body.workspaceId)
    if (!auth) {
      return errorResponse('AUTH_REQUIRED', '인증이 필요하거나 기기 연결이 해제되었습니다.', 401)
    }

    const { workspaceId, actorId, capabilities, deviceId } = auth

    function requireCapability(cap: string) {
      if (!capabilities.has(cap)) {
        throw {
          code: 'CAPABILITY_DENIED',
          status: 403,
          message: `해당 작업을 수행할 권한(${cap})이 없습니다.`,
          details: { requiredCapability: cap },
        }
      }
    }

    switch (action) {
      // Sessions & Bootstrap
      case 'get-bootstrap':
        requireCapability('SALES_READ')
        return await handleGetBootstrap(workspaceId, capabilities)
      case 'update-settings':
        requireCapability('SALES_WRITE')
        return await handleUpdateSettings(workspaceId, body)
      case 'start-session':
        requireCapability('SALES_WRITE')
        return await handleStartSession(workspaceId, body)
      case 'end-session':
        requireCapability('SALES_WRITE')
        return await handleEndSession(workspaceId, body)

      // Devices
      case 'list-devices':
        requireCapability('SALES_READ')
        return await handleListDevices(workspaceId)
      case 'update-device-capabilities':
        requireCapability('SALES_WRITE')
        return await handleUpdateDeviceCapabilities(workspaceId, body)
      case 'set-output-device':
        requireCapability('SALES_WRITE')
        return await handleSetOutputDevice(workspaceId, body)

      // Products
      case 'prepare-product':
        requireCapability('PRODUCT_WRITE')
        return await handlePrepareProduct(workspaceId, actorId, body)
      case 'update-product-draft':
        requireCapability('PRODUCT_WRITE')
        return await handleUpdateProductDraft(workspaceId, body)
      case 'commit-product':
        requireCapability('PRODUCT_WRITE')
        return await handleCommitProduct(workspaceId, body)
      case 'activate-product':
        requireCapability('SALES_WRITE')
        return await handleActivateProduct(workspaceId, body)
      case 'list-session-products':
        requireCapability('SALES_READ')
        return await handleListSessionProducts(workspaceId, body)
      case 'prepare-product-image':
        requireCapability('PRODUCT_WRITE')
        return await handlePrepareProductImage(workspaceId, body)
      case 'preview-product-change':
        requireCapability('SALES_WRITE')
        return await handlePreviewProductChange(workspaceId, actorId, body)
      case 'commit-product-change':
        requireCapability('SALES_WRITE')
        return await handleCommitProductChange(workspaceId, actorId, body)

      // Comments & Buyers
      case 'ingest-comments':
        requireCapability('COMMENT_INGEST')
        return await handleIngestComments(workspaceId, actorId, body)
      case 'get-sales-feed':
        requireCapability('SALES_READ')
        return await handleGetSalesFeed(workspaceId, body)
      case 'search-buyers':
        requireCapability('SALES_READ')
        return await handleSearchBuyers(workspaceId, body)
      case 'confirm-buyer':
        requireCapability('SALES_WRITE')
        return await handleConfirmBuyer(workspaceId, body)

      // Sales & Operations
      case 'commit-sales':
        requireCapability('SALES_WRITE')
        return await handleCommitSales(workspaceId, actorId, body)
      case 'get-product-sales':
        requireCapability('SALES_READ')
        return await handleGetProductSales(workspaceId, body)
      case 'get-operation':
        requireCapability('SALES_READ')
        return await handleGetOperation(workspaceId, body)

      // Print Jobs
      case 'claim-print-jobs':
        requireCapability('PRINT')
        return await handleClaimPrintJobs(workspaceId, deviceId, body)
      case 'renew-print-lease':
        requireCapability('PRINT')
        return await handleRenewPrintLease(workspaceId, body)
      case 'begin-print-job':
        requireCapability('PRINT')
        return await handleBeginPrintJob(workspaceId, body)
      case 'acknowledge-print-job':
        requireCapability('PRINT')
        return await handleAcknowledgePrintJob(workspaceId, body)
      case 'request-reprint':
        requireCapability('PRINT')
        return await handleRequestReprint(workspaceId, body)
      case 'get-print-status':
        requireCapability('SALES_READ')
        return await handleGetPrintStatus(workspaceId, body)

      default:
        return errorResponse('VALIDATION_ERROR', `지원하지 않는 action입니다: ${action}`, 400)
    }
  } catch (err: any) {
    if (err?.code && err?.status) {
      return errorResponse(err.code, err.message, err.status, err.details)
    }
    return errorResponse('TEMPORARILY_UNAVAILABLE', err?.message || '서버 오류가 발생했습니다.', 500)
  }
})
