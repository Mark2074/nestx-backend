const { getInternalTestUserConditions } = require("./internalTestAccounts");

function getMetricEnvironment(req) {
  const env = String(req?.query?.environment || req?.query?.env || "real").trim().toLowerCase();
  return env === "test" ? "test" : "real";
}

function getEnvironmentUserMatch(environment = "real") {
  const internalTestConditions = getInternalTestUserConditions();
  return environment === "test"
    ? { $or: internalTestConditions }
    : { $nor: internalTestConditions };
}

function getValidUserMetricMatch(environment = "real") {
  return {
    $and: [
      { emailVerifiedAt: { $ne: null } },
      { isDeleted: { $ne: true } },
      { isBanned: { $ne: true } },
      getEnvironmentUserMatch(environment),
    ],
  };
}

function prefixConditionKeys(condition, prefix) {
  const out = {};

  for (const [key, value] of Object.entries(condition || {})) {
    if (key === "$and" || key === "$or" || key === "$nor") {
      out[key] = Array.isArray(value)
        ? value.map((item) => prefixConditionKeys(item, prefix))
        : value;
      continue;
    }

    out[`${prefix}.${key}`] = value;
  }

  return out;
}

function getValidJoinedUserMetricMatch(joinAlias, environment = "real") {
  return prefixConditionKeys(getValidUserMetricMatch(environment), joinAlias);
}

module.exports = {
  getMetricEnvironment,
  getValidUserMetricMatch,
  getValidJoinedUserMetricMatch,
};
