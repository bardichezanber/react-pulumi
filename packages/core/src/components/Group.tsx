import type { ReactNode } from "react";
import { GROUP_TYPE } from "../resource-tree.js";

/**
 * Props for the `<Group>` component.
 */
export interface GroupProps {
  /** Pulumi ComponentResource type token, e.g. "custom:component:StaticSite" */
  type: string;
  /** Logical name for the ComponentResource */
  name: string;
  children?: ReactNode;
}

/**
 * `<Group>` wraps children in a Pulumi ComponentResource during materialization.
 *
 * Use this when you want a React component to create a real Pulumi resource
 * group — with scoped URNs, grouped `pulumi stack` output, and proper
 * parent-child relationships in state.
 *
 * Without `<Group>`, React components are transparent (no Pulumi footprint).
 *
 * ```tsx
 * function StaticSite({ siteName }: { siteName: string }) {
 *   return (
 *     <Group type="custom:component:StaticSite" name={`${siteName}-site`}>
 *       <Bucket name={`${siteName}-bucket`} />
 *       <BucketObject name={`${siteName}-index`} />
 *     </Group>
 *   );
 * }
 * ```
 */
export const Group: ((props: GroupProps) => null) = GROUP_TYPE as unknown as (props: GroupProps) => null;
