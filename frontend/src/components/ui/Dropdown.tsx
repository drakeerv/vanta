import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import type { JSX } from "solid-js";
import { For } from "solid-js";

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export function Dropdown(props: {
  trigger: JSX.Element;
  items: MenuItem[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger class="inline-flex items-center justify-center gap-2 px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-sm font-medium cursor-pointer">
        {props.trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="min-w-36 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 py-1">
          <For each={props.items}>
            {(item) => (
              <DropdownMenu.Item
                class={`w-full text-left px-4 py-2 text-sm cursor-pointer ${
                  item.danger
                    ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    : "hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
                onSelect={item.onClick}
              >
                {item.label}
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
