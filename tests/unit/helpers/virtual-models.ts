// vitest's stand-in for vite.config.ts's virtual:models (vitest.config.ts aliases it): no
// models listed, so models.ts asks for plain /models/<id>.glb. Unit tests never load them.
const ids: readonly string[] = [];
export default ids;
export const versions: Readonly<Record<string, string>> = {};
