/**
 * Winziger DOM-Helfer. Bewusst ohne Framework, damit die Seite als reine
 * Static-Site (GitHub Pages) ohne Build-Schritt läuft.
 */

function appendChildren(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) appendChildren(node, child);
    else node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value') node.value = value;
    else if (key === 'checked' || key === 'disabled' || key === 'required' || key === 'selected') {
      node[key] = Boolean(value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }

  appendChildren(node, children);
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}
