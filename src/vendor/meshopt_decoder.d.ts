// Types for the split decoder (meshopt_decoder.js beside this, made by
// scripts/split-meshopt-decoder.mjs): meshoptimizer's own, as three's types use (GLTFLoader's
// setMeshoptDecoder takes them), since the split keeps the decoder's API and only moves where the
// scalar build comes from. All but useWorkers: its worker pool is cut, as nothing calls it.
export { MeshoptDecoder } from 'meshoptimizer/decoder';
