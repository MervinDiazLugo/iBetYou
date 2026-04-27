// Minutes after event start during which an open bet can still be accepted
export const ACCEPT_WINDOW_MINUTES = 10

// Bet statuses that are neither resolved nor cancelled — still in play
export const NON_FINAL_BET_STATUSES = [
  "open",
  "taken",
  "pending_resolution",
  "pending_resolution_creator",
  "pending_resolution_acceptor",
  "disputed",
] as const
