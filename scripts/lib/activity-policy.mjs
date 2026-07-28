export const createActivityPublicationPolicy = (
  profile,
  mode = profile?.mode
) => {
  const activityTypes = profile?.activityTypes;
  const minimumDistance = Number(profile?.publication?.minDistanceMeters);
  const excludeRunIds = profile?.publication?.excludeRunIds;
  const excludeSubtypes = profile?.publication?.excludeSubtypes;

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
    !Array.isArray(excludeRunIds) ||
    !Array.isArray(excludeSubtypes) ||
    !excludeSubtypes.every(
      (subtype) => typeof subtype === 'string' && subtype.trim().length > 0
    )
  ) {
    throw new Error(`Invalid activity profile: ${mode}`);
  }

  return {
    mode,
    activityTypes: new Set(activityTypes),
    minDistanceMeters: minimumDistance,
    excludeRunIds: new Set(excludeRunIds.map(String)),
    excludeSubtypes: new Set(
      excludeSubtypes.map((subtype) => subtype.trim().toLowerCase())
    ),
  };
};

export const assertPublishedActivitiesMatchPolicy = ({
  activities,
  expectedCount,
  policy,
}) => {
  const {
    mode,
    activityTypes,
    minDistanceMeters,
    excludeRunIds,
    excludeSubtypes,
  } = policy;
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
    const subtype = String(activity?.subtype ?? '')
      .trim()
      .toLowerCase();
    if (
      !runId ||
      runIds.has(runId) ||
      !activityTypes.has(activity?.type) ||
      activity?.distance === '' ||
      activity?.distance === null ||
      !Number.isFinite(distance) ||
      distance <= minDistanceMeters ||
      excludeRunIds.has(runId) ||
      excludeSubtypes.has(subtype)
    ) {
      throw new Error(
        `${mode} metadata violates publication policy at activity ${runId || '(missing id)'}`
      );
    }
    runIds.add(runId);
  }
};
