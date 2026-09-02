/*
 * File: fetchWithRetry.js
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Utility function wrapping fetch in a retry loop with custom delay.
 */

const logService = require('../log.js');

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.BE_PROCESSING_MODULE_NAME, type, msg)
}

// Function executing a HTTP request with fetch with 'retries' number of retries with
// 'delayMs' delay between retries
async function fetchWithRetry(url, options, retries, delayMs) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok)
                log("warning", `HTTP error: ${response.status}`);
            else
                return response;
        }
        catch (_) {
            log("warning", `Fetch failed (attempt ${attempt})`);
        }

        if (attempt < retries)
            await new Promise(res => setTimeout(res, delayMs));
    }

    return null;
}

module.exports = { fetchWithRetry };