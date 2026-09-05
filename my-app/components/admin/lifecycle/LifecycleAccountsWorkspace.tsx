"use client";

import { LifecycleAccountsWorkspaceView } from "./LifecycleAccountsWorkspaceView";
import {
  useLifecycleAccountsWorkspaceController,
  type LifecycleAccountsWorkspaceProps,
} from "./LifecycleAccountsWorkspaceController";

export default function LifecycleAccountsWorkspace(
  props: LifecycleAccountsWorkspaceProps,
) {
  const controller = useLifecycleAccountsWorkspaceController(props);
  return <LifecycleAccountsWorkspaceView controller={controller} />;
}
