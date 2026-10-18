// shadcn/ui Tabs composition with project-native styles instead of Tailwind.
import type { ComponentProps } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";

export const Tabs = TabsPrimitive.Root;
export function TabsList(props: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List {...props} className={`bench-tabs ${props.className ?? ""}`} />;
}
export function TabsTrigger(props: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger {...props} className={`bench-tab ${props.className ?? ""}`} />;
}
export function TabsContent(props: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content {...props} className={`bench-tab-content ${props.className ?? ""}`} />;
}
