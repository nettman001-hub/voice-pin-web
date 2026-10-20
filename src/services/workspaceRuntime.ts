import { storageService } from './storageService';
import { remoteWorkspaceService, resolvePrivateImageUrl } from './remoteWorkspaceService';
import { productSalesApi } from './productSalesApi';
import { aiSettingsApi } from './aiSettingsApi';
import { sellerAnalysisApi } from './sellerAnalysisApi';
import { commentStreamService } from './commentStreamService';
import { enqueueCloudComment, flushPendingComments, promoteCommentOutbox } from './commentSyncService';
import { uploadProductImageDataUrl } from './productImageService';
import { confirmedBuyerAliases } from './confirmedBuyerAliases';
import { customerKeepingService } from './customerKeepingService';
import { smsBridgeService } from './smsBridgeService';
import { shippingService } from './shippingService';
import { acquireListeningInput } from './listeningInputLease';

export const productionRuntime = {
  id: 'production', isTest: false, workspaceId: null as string | null,
  webStorage: globalThis.localStorage,
  acquireListeningInput,
  storageService, remoteWorkspaceService, productSalesApi, aiSettingsApi, sellerAnalysisApi,
  commentStreamService, enqueueCloudComment, flushPendingComments, promoteCommentOutbox,
  uploadProductImageDataUrl, resolvePrivateImageUrl, confirmedBuyerAliases, customerKeepingService, smsBridgeService, shippingService,
  path: (path: string) => path,
};
export type WorkspaceRuntime = typeof productionRuntime;
