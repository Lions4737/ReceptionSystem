export const DEFAULT_EVENT_SLUG = 'KF77'
export const LEGACY_EVENT_SLUG = 'komaba-festival';

export function eventPath(path: string, slug = DEFAULT_EVENT_SLUG) {
  return '/event/' + slug + path;
}
