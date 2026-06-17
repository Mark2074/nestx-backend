function getDiscoveryAvailabilityStages() {
  const freeEventHasRunningPrivate = {
    $and: [
      { $eq: ["$status", "live"] },
      { $ne: ["$accessScope", "private"] },
      { $lte: [{ $ifNull: ["$ticketPriceTokens", 0] }, 0] },
      { $eq: ["$privateSession.status", "running"] },
    ],
  };

  const nativePrivateIsSoldOut = {
    $and: [
      { $eq: ["$accessScope", "private"] },
      { $gt: ["$_discoveryNativePrivateSeats", 0] },
      {
        $gte: [
          "$_discoveryNativePrivateSoldCount",
          "$_discoveryNativePrivateSeats",
        ],
      },
    ],
  };

  const isUnavailableForDiscovery = {
    $or: [freeEventHasRunningPrivate, nativePrivateIsSoldOut],
  };

  return [
    {
      $lookup: {
        from: "tickets",
        let: { eventId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$eventId", "$$eventId"] },
                  { $eq: ["$scope", "private"] },
                  { $eq: ["$status", "active"] },
                ],
              },
            },
          },
          { $count: "count" },
        ],
        as: "_discoveryPrivateTickets",
      },
    },
    {
      $addFields: {
        _discoveryNativePrivateSeats: {
          $cond: [
            { $gt: [{ $ifNull: ["$privateSession.seats", 0] }, 0] },
            { $ifNull: ["$privateSession.seats", 0] },
            { $ifNull: ["$maxSeats", 0] },
          ],
        },
        _discoveryNativePrivateTicketCount: {
          $ifNull: [
            { $arrayElemAt: ["$_discoveryPrivateTickets.count", 0] },
            0,
          ],
        },
      },
    },
    {
      $addFields: {
        _discoveryNativePrivateSoldCount: {
          $max: [
            { $ifNull: ["$ticketsSoldCount", 0] },
            "$_discoveryNativePrivateTicketCount",
          ],
        },
      },
    },
    {
      $match: {
        $expr: {
          $not: [isUnavailableForDiscovery],
        },
      },
    },
  ];
}

function getDiscoveryAvailabilityProjection() {
  return {
    _discoveryPrivateTickets: 0,
    _discoveryNativePrivateSeats: 0,
    _discoveryNativePrivateTicketCount: 0,
    _discoveryNativePrivateSoldCount: 0,
  };
}

module.exports = {
  getDiscoveryAvailabilityStages,
  getDiscoveryAvailabilityProjection,
};
