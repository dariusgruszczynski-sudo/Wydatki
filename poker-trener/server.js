const path = require('path');
const express = require('express');

require('./lib/db');
const Auth = require('./lib/auth');
const Push = require('./lib/push');
const R = require('./lib/ranges');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '60mb' }));
app.use(Auth.attachProfile);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api', require('./routes/profiles'));
app.use('/api', Auth.requireProfile);
app.use('/api', require('./routes/trainer'));
app.use('/api', require('./routes/learn'));
app.use('/api', require('./routes/tools'));
app.use('/api', require('./routes/journal'));
app.use('/api', require('./routes/stats'));
app.use('/api', require('./routes/me'));
app.use('/api', require('./routes/coach'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Nie ma takiego endpointu.' }));

app.use((req, res, next) => {
  if (req.path === '/sw.js' || req.path.endsWith('.html') || req.path === '/') res.setHeader('Cache-Control', 'no-cache');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

R.buildStrengthRanking();
R.buildPlayabilityRanking();
Push.startScheduler();

const PORT = process.env.PORT || 3000;
const BIND = process.env.BIND_HOST || '0.0.0.0';
app.listen(PORT, BIND, () => console.log(`poker-trener listening on ${BIND}:${PORT}`));
