import { TextField } from "@kobalte/core/text-field";
import { Show } from "solid-js";

/** Shared input styling — exported for use in custom input contexts */
export const inputStyles =
  "w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25 transition-shadow";

export function Input(props: {
  value?: string;
  onChange?: (value: string) => void;
  type?: string;
  placeholder?: string;
  label?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  class?: string;
  onKeyDown?: (e: KeyboardEvent) => void;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
  ref?: HTMLInputElement | ((el: HTMLInputElement) => void);
}) {
  return (
    <TextField
      value={props.value ?? ""}
      onChange={props.onChange}
      disabled={props.disabled}
      class={props.class}
    >
      <Show when={props.label}>
        <TextField.Label class="block text-sm font-medium mb-1">
          {props.label}
        </TextField.Label>
      </Show>
      <TextField.Input
        ref={props.ref}
        id={props.id}
        type={props.type}
        placeholder={props.placeholder}
        required={props.required}
        onKeyDown={props.onKeyDown}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        class={inputStyles}
      />
      <Show when={props.error}>
        <TextField.ErrorMessage class="text-xs text-red-500 mt-1">
          {props.error}
        </TextField.ErrorMessage>
      </Show>
    </TextField>
  );
}
