/*
 * Log service function file
 */

const dotenv = require('dotenv');

// .env file include
dotenv.config();

// Default terminal color
const defColor = "\x1b[37m";

// Module settings
const modules = [
    {
        name: process.env.BE_PROCESSING_MODULE_NAME,
        label: process.env.BE_PROCESSING_MODULE_LABEL,
        color: "\x1b[33m"
    },
    {
        name: process.env.DB_POSTGIS_MODULE_NAME,
        label: process.env.DB_POSTGIS_MODULE_LABEL,
        color: "\x1b[36m"
    },
    {
        name: process.env.DB_STATS_MODULE_NAME,
        label: process.env.DB_STATS_MODULE_LABEL,
        color: "\x1b[36m"
    },
    {
        name: process.env.BE_OP_DATA_PROCESSING_MODULE_NAME,
        label: process.env.BE_OP_DATA_PROCESSING_MODULE_LABEL,
        color: "\x1b[34m"
    },
    {
        name: process.env.BE_API_MODULE_NAME,
        label: process.env.BE_API_MODULE_LABEL,
        color: "\x1b[35m"
    },
    {
        name: process.env.FE_MODULE_NAME,
        label: process.env.FE_MODULE_LABEL,
        color: "\x1b[30m"
    }
]

// Function for writing intro log
function write(sourceModuleName, type, message) {
    const date = new Date();

    let terColor = defColor;
    let header = "";
    let msgToDisplay = "";

    switch (type) {
        case 'success': terColor = "\x1b[92m"; header = "SUCCESS"; break;
        case 'warning': terColor = "\x1b[33m"; header = "WARNING"; break;
        case 'error': terColor = "\x1b[91m"; header = "ERROR"; break;
        case 'info': terColor = defColor; header = "INFO"; break;
        default: return;
    }

    const sourceModule = modules.find((module) => { return module.name === sourceModuleName});

    if (sourceModule === undefined) {
        msgToDisplay = `${defColor}${date.toLocaleString('en')}${terColor} ${header}\t${defColor}UNKNOWN SERVICE ${message}`;
    } else {
        msgToDisplay = `${defColor}${date.toLocaleString('en')}${terColor} ${header}\t${sourceModule.color}${sourceModule.label}${defColor} ${message}`;
    }

    console.log(msgToDisplay);
}

module.exports = { write }