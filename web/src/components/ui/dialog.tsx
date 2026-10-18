// shadcn/ui Dialog composition, styled with the workbench's existing CSS tokens.
import type { ComponentProps } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export function DialogContent({ children, className = "", closeLabel = "Close bench companion", ...props }: ComponentProps<typeof DialogPrimitive.Content> & { closeLabel?: string }) {
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="bench-overlay" />
    <DialogPrimitive.Content className={`bench-dialog ${className}`} {...props}>
      {children}
      <DialogPrimitive.Close className="bench-close" aria-label={closeLabel}><X size={18} /></DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>;
}
