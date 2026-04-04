const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const Block = require("../models/block");
const Follow = require("../models/Follow");

/**
 * POST /api/block/:id
 * Blocca un utente (id = utente da bloccare)
 */
router.post("/:id", auth, async (req, res) => {
  try {
    const blockerId = req.user._id;
    const blockedId = req.params.id;

    if (!blockedId || blockedId.toString() === blockerId.toString()) {
      return res.status(400).json({
        status: "error",
        message: "Invalid user ID to block",
      });
    }

    // Prova a creare il blocco
    try {
      await Block.create({ blockerId, blockedId });

      // ✅ FIX #1: se blocco, devo eliminare qualsiasi follow/pending tra i due (2 direzioni)
      await Follow.deleteMany({
        $or: [
          { followerId: blockerId, followingId: blockedId },
          { followerId: blockedId, followingId: blockerId },
        ],
      });

      return res.status(201).json({
        status: "success",
        message: "User blocked successfully",
      });
    } catch (err) {
      // Duplicato (blocco già esistente)
      if (err.code === 11000) {
        // rete di sicurezza: anche se il blocco esiste già, pulisco follow/pending rimasti incoerenti
        await Follow.deleteMany({
          $or: [
            { followerId: blockerId, followingId: blockedId },
            { followerId: blockedId, followingId: blockerId },
          ],
        });

        return res.status(200).json({
          status: "success",
          message: "User already blocked",
        });
      }

      console.error("Error while locking user:", err);
      return res.status(500).json({
        status: "error",
        message: "Internal error while blocking user",
      });
    }
  } catch (err) {
    console.error("Error while blocking user:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while blocking user",
    });
  }
});

/**
 * DELETE /api/block/:id
 * Sblocca un utente (id = utente da sbloccare)
 */
router.delete("/:id", auth, async (req, res) => {
  try {
    const blockerId = req.user._id;
    const blockedId = req.params.id;

    const deleted = await Block.findOneAndDelete({ blockerId, blockedId });

    if (!deleted) {
      return res.status(404).json({
        status: "error",
        message: "No block exists for this user",
      });
    }

    return res.status(200).json({
      status: "success",
      message: "User unblocked successfully",
    });
  } catch (err) {
    console.error("Error while unblocking user:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while unblocking user",
    });
  }
});

/**
 * GET /api/block/me
 * Elenco utenti che HO bloccato
 */
router.get("/me", auth, async (req, res) => {
  try {
    const blockerId = req.user._id;

    const blocks = await Block.find({ blockerId })
      .populate("blockedId", "displayName email profileType")
      .lean();

    return res.status(200).json({
      status: "success",
      data: blocks.map((b) => ({
        id: b.blockedId._id,
        displayName: b.blockedId.displayName,
        email: b.blockedId.email,
        profileType: b.blockedId.profileType,
        blockedAt: b.createdAt,
      })),
    });
  } catch (err) {
    console.error("Errore recupero lista bloccati:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while retrieving the block list",
    });
  }
});

module.exports = router;
