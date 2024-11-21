const setEnv = () => {
    const fs = require('fs');
    const writeFile = fs.writeFile;

    const targetPath = './src/environments/environment.production.ts';

    require('dotenv').config({
      path: '.env'
    });

    const envConfigFile = `export const environment = {
        apiUrl: '/lissy/api/',
        apiKey: '${process.env['BE_API_MODULE_TOKEN']}',
        production: true,
        mapCenter: '${process.env['FE_MAP_CENTER']}',
        mapZoom: '${process.env['FE_MAP_ZOOM']}'
    };`;
    
    writeFile(targetPath, envConfigFile, () => {});
  };
  
  setEnv();