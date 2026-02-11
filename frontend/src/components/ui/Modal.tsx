import { Dialog as KDialog } from "@kobalte/core/dialog";
import type { JSX } from "solid-js";
import { X } from "lucide-solid"; // Assuming you still want Lucide icons

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
      case "lg": return "max-w-2xl";
      default: return "max-w-md";
    }
  };

  return (
    <KDialog open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <KDialog.Portal>
        <KDialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <div class="fixed inset-0 z-50 overflow-y-auto">
          <div class="flex min-h-full items-center justify-center p-4 text-center">
            <KDialog.Content 
              class={`
                w-full ${maxW()} transform overflow-hidden rounded-2xl 
                bg-white dark:bg-gray-900 text-left align-middle shadow-xl transition-all
                text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-800
              `}
            >
              <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
                <KDialog.Title class="text-lg font-semibold leading-6">
                  {props.title}
                </KDialog.Title>
                <KDialog.CloseButton class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors cursor-pointer">
                  <X size={20} />
                </KDialog.CloseButton>
              </div>
              
              <div class="px-6 py-4">
                {props.children}
              </div>
            </KDialog.Content>

          </div>
        </div>
      </KDialog.Portal>
    </KDialog>
  );
}