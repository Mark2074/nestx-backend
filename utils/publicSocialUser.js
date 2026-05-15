function publicActiveUserQuery(extra = {}) {
  return {
    ...extra,
    accountType: { $ne: "admin" },
    emailVerifiedAt: { $ne: null },
    isBanned: { $ne: true },
    isSuspended: { $ne: true },
    isDeleted: { $ne: true },
    deletedAt: null,
  };
}

function isPublicActiveUser(user) {
  if (!user) return false;
  return (
    user.accountType !== "admin" &&
    !!user.emailVerifiedAt &&
    user.isBanned !== true &&
    user.isSuspended !== true &&
    user.isDeleted !== true &&
    !user.deletedAt
  );
}

function shouldHidePublicSocialUser(user, viewerUser, ownerId = null) {
  const isAdminViewer = viewerUser?.accountType === "admin";
  const isOwner =
    ownerId && user?._id && String(ownerId) === String(user._id);

  if (isAdminViewer || isOwner) return false;
  return !isPublicActiveUser(user);
}

module.exports = {
  publicActiveUserQuery,
  isPublicActiveUser,
  shouldHidePublicSocialUser,
};
