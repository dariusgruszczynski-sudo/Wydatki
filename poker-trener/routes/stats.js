const express = require('express');
const A = require('../lib/analytics');
const { h } = require('./util');

const router = express.Router();

function range(req) {
  const days = Number(req.query.days);
  if (Number.isFinite(days) && days > 0) return { from: new Date(Date.now() - days * 86400000).toISOString() };
  return {};
}

router.get('/stats/overview', h((req) => A.overview(req.profile.id, range(req))));
router.get('/stats/matrix', h((req) => A.matrix(req.profile.id, range(req))));
router.get('/stats/timer', h((req) => A.timerComparison(req.profile.id, range(req))));
router.get('/stats/trends', h((req) => A.trends(req.profile.id)));
router.get('/stats/top-errors', h((req) => A.topErrors(req.profile.id, 10, range(req))));
router.get('/stats/leaks', h((req) => A.leaks(req.profile.id, range(req))));
router.get('/stats/tilt', h((req) => A.tilt(req.profile.id, range(req))));
router.get('/stats/calibration', h((req) => A.calibration(req.profile.id, range(req))));
router.get('/stats/heatmap', h((req) => A.heatmap(req.profile.id, range(req))));
router.get('/stats/drills', h((req) => A.drillStats(req.profile.id)));
router.get('/stats/report', h((req) => A.monthReport(req.profile.id, req.query.month)));

module.exports = router;
