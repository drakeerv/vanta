import { Dialog as KDialog } from "@kobalte/core/dialog";
import type { JSX } from "solid-js";

export function Modal(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: "sm" | "md" | "lg";
  children: JSX.Element;
}) {
  const maxW = () => {
    switch (props.size) {
      case "sm": return "max-w-sm";
      case "lg": return "max-w-lg";
      default: return "max-w-md";
    }
  };

  return (
    <KDialog open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <KDialog.Portal>
        <KDialog.Overlay class="fixed inset-0 z-50 bg-black/60" />
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <KDialog.Content class={`bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-xl p-6 w-full ${maxW()} shadow-xl`}>
            <div class="flex items-center justify-between mb-4">
              <KDialog.Title class="text-lg font-semibold">{props.title}</KDialog.Title>
              <KDialog.CloseButton class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none">
                ×
              </KDialog.CloseButton>
            </div>
            {props.children}
          </KDialog.Content>
        </div>
      </KDialog.Portal>
    </KDialog>
  );
}
