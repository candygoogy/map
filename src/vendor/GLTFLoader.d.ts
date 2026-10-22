// Types for the trimmed loader (GLTFLoader.js beside this, made by scripts/trim-gltf-loader.mjs):
// three's own, since the trimmed file keeps GLTFLoader's whole API and drops only plugins and
// the paths no shipped model takes (non-triangle primitives, CUBICSPLINE clips).
export { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** The glTF extensions the trimmed loader reads; a model using any other isn't loaded right. */
export declare const SUPPORTED_EXTENSIONS: readonly string[];
