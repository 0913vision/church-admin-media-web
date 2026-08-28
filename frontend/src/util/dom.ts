type ElementProps<K extends keyof HTMLElementTagNameMap> = Partial<
  Omit<HTMLElementTagNameMap[K], "style">
> & {
  class?: string;
  /** Inline style as text, for the positions a layout computes. */
  style?: string;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps<K> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: className, style, ...rest } = props;
  if (className) node.className = className;
  if (style) node.setAttribute("style", style);
  Object.assign(node, rest);
  for (const child of children) node.append(child);
  return node;
}

/** Stands where a value has not arrived. Hyphens, never a dash. */
export const BLANK = "--";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
