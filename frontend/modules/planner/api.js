const env = require('./config.json');

async function processRequest(url, req, res) {
    res.send(true);
}

module.exports = { processRequest, env }