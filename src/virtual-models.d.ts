// vite.config.ts → modelManifest: the ids that have a public/models/<id>.glb.
declare module 'virtual:models' {
  const ids: readonly string[];
  export default ids;
  /** Each id's short content hash, for its URL (`?v=`). */
  export const versions: Readonly<Record<string, string>>;
}
