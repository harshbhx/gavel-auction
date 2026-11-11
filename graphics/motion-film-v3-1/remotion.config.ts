import { Config } from '@remotion/cli/config';

// Frames are captured as JPEG at a high quality (the final H.264 is 4:2:0 anyway) because PNG
// capture is the slow step of a 60 fps render. Overwrite is on so a re-render replaces the file.
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(94);
Config.setOverwriteOutput(true);
Config.setPublicDir('./public');
Config.setEntryPoint('./src/index.ts');
