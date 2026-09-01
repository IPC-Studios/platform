/**
 * Which dashboard sections are worth showing a studio that has not started yet.
 *
 * A brand-new studio saw four tiles reading 0 / 0 / 1 / ₹0 and an empty
 * "Recent projects" card sitting directly under a setup step telling them to
 * create their first project — the same instruction twice, with a wall of
 * zeros in between.
 *
 * The rule is: hide a section only while the setup journey is still guiding
 * someone AND that section has nothing of its own to say. Once anything is
 * real, everything comes back — a zero next to real numbers is information,
 * and hiding it would be the harder thing to explain.
 */
export interface DashboardCounts {
  activeProjects: number
  clients: number
  /** Includes the owner, who exists from registration — so 1 means "nobody yet". */
  teamMembers: number
  outstanding: number
  recentProjects: number
}

export function dashboardSections(counts: DashboardCounts, journeyShowing: boolean) {
  const nothingYet =
    counts.activeProjects === 0 &&
    counts.clients === 0 &&
    counts.teamMembers <= 1 &&
    counts.outstanding === 0

  return {
    /** The tile row. */
    stats: !(journeyShowing && nothingYet),
    /**
     * The recent-projects card. Its empty state duplicates the journey's
     * "create your first project" step, button and all.
     */
    recentProjects: !(journeyShowing && counts.recentProjects === 0),
  }
}
