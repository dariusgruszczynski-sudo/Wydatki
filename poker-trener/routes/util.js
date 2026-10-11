function h(fn) {
  return (req, res) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .then((out) => {
        if (out !== undefined && !res.headersSent) res.json(out);
      })
      .catch((e) => {
        if (res.headersSent) return;
        const status = e.status || 400;
        if (status >= 500 && status !== 503) console.error(e);
        res.status(status).json({ error: e.message || 'Błąd' });
      });
  };
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function num(v, def = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

module.exports = { h, httpError, num };
