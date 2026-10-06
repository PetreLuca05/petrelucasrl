/**
 * GLSL helper for the hand-written shaders, whose colours are written as they should look on
 * screen. It re-encodes such a colour for wherever the renderer is drawing, so a shader looks
 * the same on the canvas and in the (linear) render target the glass lens reads from.
 */
export const displayColor = /* glsl */ `
  vec3 displayColor(vec3 c) {
    vec3 lin = mix(
      pow(c * 0.9478672986 + 0.0521327014, vec3(2.4)),
      c * 0.0773993808,
      vec3(lessThanEqual(c, vec3(0.04045)))
    );
    return linearToOutputTexel(vec4(lin, 1.0)).rgb;
  }
`
