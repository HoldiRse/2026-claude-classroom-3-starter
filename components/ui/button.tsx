import type { ComponentProps } from "react";

type ButtonProps = ComponentProps<"button"> & {
  /** `secondary` is the same geometry without the fill, for the lesser of two. */
  variant?: "primary" | "secondary";
};

/**
 * Graphite, square, weight 600. The brand fills its buttons from the grey ramp
 * and keeps blue for links, so that the one blue thing on a screen is always
 * the thing you navigate to. There is deliberately no blue variant.
 */
export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonProps) {
  const fill =
    variant === "primary"
      ? "bg-button text-white hover:bg-button-hover"
      : "border border-edge bg-transparent text-ink hover:bg-raised";

  return (
    <button
      className={`px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 ${fill} ${className}`}
      {...props}
    />
  );
}
