// Utility for creating CSS2D text labels for Three.js objects
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export function createTextLabel(text, color = '#fff', fontSize = '14px', fontWeight = 'bold', outline = true) {
  const div = document.createElement('div');
  div.className = 'three-label';
  div.textContent = text;
  // Only set the minimum required styles inline
  if (color && color !== '#fff') div.style.color = color;
  if (fontSize && fontSize !== '14px') div.style.fontSize = fontSize;
  if (fontWeight && fontWeight !== 'bold') div.style.fontWeight = fontWeight;
  if (!outline) div.style.textShadow = 'none';
  // display is controlled dynamically elsewhere
  return new CSS2DObject(div);
}
