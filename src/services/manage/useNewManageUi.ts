import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { MANAGE_UI_EVENT, isNewManageUiEnabled, setNewManageUiEnabled } from './manageUiSetting';

export function useNewManageUi(): [boolean, (enabled: boolean) => void] {
  const { workspaceId } = useAuth();
  const [enabled, setEnabled] = useState(() => isNewManageUiEnabled(workspaceId));
  useEffect(() => {
    setEnabled(isNewManageUiEnabled(workspaceId));
    const onChange = () => setEnabled(isNewManageUiEnabled(workspaceId));
    window.addEventListener(MANAGE_UI_EVENT, onChange);
    return () => window.removeEventListener(MANAGE_UI_EVENT, onChange);
  }, [workspaceId]);
  const update = useCallback((next: boolean) => setNewManageUiEnabled(workspaceId, next), [workspaceId]);
  return [enabled, update];
}
