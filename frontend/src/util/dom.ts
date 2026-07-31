type ElementProps<K extends keyof HTMLElementTagNameMap> = Partial<HTMLElementTagNameMap[K]> & {
  class?: string;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps<K> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: className, ...rest } = props;
  if (className) node.className = className;
  Object.assign(node, rest);
  for (const child of children) node.append(child);
  return node;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
