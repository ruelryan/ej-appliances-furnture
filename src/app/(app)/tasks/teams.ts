// The teams a task can be assigned to (tasks.assignee_role), with their
// display labels. Read by both the server pages that render a task and the
// client dialogs that create or reassign one, so it deliberately lives in a
// module with no "use client": a constant exported from a client module comes
// back as a client-reference proxy on the server, not as an array.
export const TEAM_OPTIONS: { value: string; label: string }[] = [
  { value: "collector", label: "Collectors" },
  { value: "admin", label: "Admin" },
  { value: "delivery", label: "Delivery" },
  { value: "sales_agent", label: "Sales agents" },
  { value: "owner", label: "Owner" },
];

/** Label for a team, falling back to the raw role for anything unlisted. */
export const teamLabel = (role: string) =>
  TEAM_OPTIONS.find((t) => t.value === role)?.label ?? role;
