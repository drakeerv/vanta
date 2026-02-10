import { Button as KButton } from "@kobalte/core/button";
import type { JSX } from "solid-js";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

const variants: Record<Variant, string> = {
  primary: "bg-accent-500 text-white hover:bg-accent-600",
  secondary:
    "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost:
    "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800",
};

export function Button(props: {
  variant?: Variant;
  disabled?: boolean;
  class?: string;
  onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  type?: "button" | "submit" | "reset";
  children: JSX.Element;
}) {
  return (
    <KButton
      class={`${base} ${variants[props.variant ?? "primary"]} ${props.class ?? ""}`}
      disabled={props.disabled}
      onClick={props.onClick}
      type={props.type}
    >
      {props.children}
    </KButton>
  );
}
