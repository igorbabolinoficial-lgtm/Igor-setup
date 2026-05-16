const express = require('express');
const briefing = require('../briefing');
const router = express.Router();

router.get('/', async (_req, res, next) => {
    try { res.json(await briefing.gerarBriefing()); } catch (e) { next(e); }
});
router.post('/agora', async (_req, res, next) => {
    try { res.json(await briefing.gerarBriefing()); } catch (e) { next(e); }
});

module.exports = router;
