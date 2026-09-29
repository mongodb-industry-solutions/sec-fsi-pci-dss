// Shared count-badge formatting so every unread/pending badge (top-bar bell, sidebar item)
// renders the same value. Caps at 9+ to keep the badge compact.
export function formatBadgeCount(n: number): string {
  return n > 9 ? '9+' : String(n);
}
