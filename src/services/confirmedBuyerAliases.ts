import type { ConfirmedBuyerAlias } from '../types/confirmedBuyer';
import { normalizeNickname } from './nicknameMatcher';
import { remoteWorkspaceService as productionRemote } from './remoteWorkspaceService';

const namespace = 'confirmed_buyer_aliases';
const storageKey = (workspaceId: string) => `voicecap_${namespace}_${workspaceId}`;
const aliasKey = (alias: ConfirmedBuyerAlias) => `${alias.accountKey}:${normalizeNickname(alias.spokenNickname)}`;

function mergeAliases(...lists: ConfirmedBuyerAlias[][]): ConfirmedBuyerAlias[] {
  const merged = new Map<string, ConfirmedBuyerAlias>();
  for (const alias of lists.flat()) {
    if (!alias?.accountKey || !alias.spokenNickname || !alias.nickname || !alias.updatedAt) continue;
    const previous = merged.get(aliasKey(alias));
    if (!previous || alias.updatedAt > previous.updatedAt) merged.set(aliasKey(alias), alias);
  }
  return [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 500);
}

export function createConfirmedBuyerAliases(remoteWorkspaceService = productionRemote, localStorage: Storage = globalThis.localStorage) {
return {
  get(workspaceId?: string | null): ConfirmedBuyerAlias[] {
    if (!workspaceId) return [];
    try {
      const value = JSON.parse(localStorage.getItem(storageKey(workspaceId)) || '[]');
      return Array.isArray(value) ? mergeAliases(value) : [];
    } catch { return []; }
  },
  async fetch(workspaceId: string): Promise<void> {
    try {
      const remote = await remoteWorkspaceService.fetchWorkspaceSettings<ConfirmedBuyerAlias[]>(workspaceId, namespace);
      if (Array.isArray(remote)) localStorage.setItem(storageKey(workspaceId), JSON.stringify(mergeAliases(remote, this.get(workspaceId))));
    } catch { /* Local confirmed aliases remain usable offline. */ }
  },
  async remember(workspaceId: string, alias: ConfirmedBuyerAlias): Promise<void> {
    // An alias identifies an account, never everybody with a similar display name.
    if (alias.accountKey.startsWith('unresolved:')) return;
    const aliases = mergeAliases(this.get(workspaceId), [alias]);
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(aliases));
    window.dispatchEvent(new Event('voicecap_buyer_aliases_updated'));
    await remoteWorkspaceService.saveWorkspaceSettings(workspaceId, namespace, aliases);
  },
};
}

export const confirmedBuyerAliases = createConfirmedBuyerAliases();
