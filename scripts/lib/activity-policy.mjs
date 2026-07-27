export const createActivityPublicationPolicy = (
  profile,
  mode = profile?.mode
) => {
  const activityTypes = profile?.activityTypes;
  const minimumDistance = Number(profile?.publication?.minDistanceMeters);
  const excludeRunIds = profile?.publication?.excludeRunIds;

  if (
    !profile ||
    profile.mode !== mode ||
    !Array.isArray(activityTypes) ||
    activityTypes.length === 0 ||
    !activityTypes.every(
      (activityType) =>
        typeof activityType === 'string' && activityType.length > 0
    ) ||
    !Number.isFinite(minimumDistance) ||
    minimumDistance < 0 ||
    !Array.isArray(excludeRunIds)
  ) {
    throw new Error(`Invalid activity profile: ${mode}`);
  }

  return {
    mode,
    activityTypes: new Set(activityTypes),
    minDistanceMeters: minimumDistance,
    excludeRunIds: new Set(excludeRunIds.map(String)),
  };
};

export const assertPublishedActivitiesMatchPolicy = ({
  activities,
  expectedCount,
  policy,
}) => {
  const { mode, activityTypes, minDistanceMeters, excludeRunIds } = policy;
  if (
    !Array.isArray(activities) ||
    (expectedCount !== undefined && activities.length !== expectedCount)
  ) {
    throw new Error(
      `${mode} metadata violates publication policy: expected ${expectedCount} activities`
    );
  }

  const runIds = new Set();
  for (const activity of activities) {
    const runId =
      typeof activity?.run_id === 'string' ||
      typeof activity?.run_id === 'number'
        ? String(activity.run_id)
        : '';
    const distance = Number(activity?.distance);
    if (
      !runId ||
      runIds.has(runId) ||
      !activityTypes.has(activity?.type) ||
      activity?.distance === '' ||
      activity?.distance === null ||
      !Number.isFinite(distance) ||
      distance <= minDistanceMeters ||
      excludeRunIds.has(runId)
    ) {
      throw new Error(
        `${mode} metadata violates publication policy at activity ${runId || '(missing id)'}`
      );
    }
    runIds.add(runId);
  }
};
