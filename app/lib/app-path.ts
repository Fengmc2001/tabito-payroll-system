/** Shared by API requests and attachment links, including subdirectory deployments. */
export function appPath(path: string, basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '') {
  const base = basePath.replace(/\/+$/, '');
  if (!base || path === base || path.startsWith(base + '/')) return path;
  return base + (path.startsWith('/') ? path : '/' + path);
}
