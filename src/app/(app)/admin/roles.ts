// Display labels for the five roles (plus legacy `staff`). Read by both the
// server-rendered user table and the client role select, so it lives outside
// role-select.tsx: a constant exported from a "use client" module reaches the
// server as a client-reference proxy, and every lookup silently misses.
export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin assistant",
  collector: "Collector",
  sales_agent: "Sales agent",
  delivery: "Delivery",
  bookkeeper: "Bookkeeper",
  staff: "Staff (legacy)",
};
